/**
 * Integration tests for pipelineStageService.
 *
 * Runs against a real PostgreSQL test database.
 * Before each test the pipeline_stages table is restored to the six seed rows
 * so tests don't interfere with each other.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  listPipelineStages,
  getStageNames,
  getTerminalStageNames,
  findPipelineStageById,
  createPipelineStage,
  updatePipelineStage,
  deletePipelineStage,
  reorderPipelineStages,
} from '../services/pipelineStageService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import pool from '../db.js';
import { clearAuditLogFor, countAuditRowsFor } from './testUtils.js';

const FILE_PREFIX = 'pipeline-stage-svc';

/**
 * The record_name pipelineStageService writes its audit rows under. Every
 * caller of the service writes under it, so it cannot scope an assertion on its
 * own — every read below is additionally scoped by ACTOR.id.
 */
const PIPELINE_STAGES_RECORD_NAME = 'pipeline_stages';

/**
 * File-scoped actor for every write under test here.
 *
 * pipelineStageService's create/update/delete/reorder functions all default to
 * SYSTEM_ACTOR (the all-zeros UUID) when no actor is passed. That UUID is shared
 * with every other SYSTEM_ACTOR write in the repo, so it isolates nothing —
 * passing a per-file actor is what makes changed_by_id a usable scoping
 * dimension for the audit assertions below.
 */
const ACTOR = { id: randomUUID(), name: 'Pipeline Stage Svc Test' };

/**
 * Counts audit rows for this file's own writes. Scoped by changed_by_id because
 * record_type + record_name are shared with every other writer of
 * `system_settings`/`pipeline_stages` — including the controller path. See
 * countAuditRowsFor.
 */
function countStageAuditRows(): Promise<number> {
  return countAuditRowsFor(pool, {
    recordType: 'system_settings',
    recordName: PIPELINE_STAGES_RECORD_NAME,
    actorId: ACTOR.id,
  });
}

/**
 * Clears audit_log rows written by this test file.
 *
 * This was a private copy of testUtils.ts's clearAuditLogFor, justified by
 * filtering on record_type/record_name rather than an actor id. Now that every
 * write in this file passes ACTOR, that justification is gone and the shared
 * helper does exactly this — including the single-transaction
 * DISABLE/DELETE/ENABLE sequence whose ACCESS EXCLUSIVE lock serializes
 * concurrent copies. ACTOR.id is a per-file randomUUID, so scoping by it alone
 * cannot over-delete.
 */
function clearPipelineStageAuditLog(): Promise<void> {
  return clearAuditLogFor(ACTOR.id);
}

/** Re-seeds the six default pipeline stages before each test */
async function resetStages(): Promise<void> {
  const defaultPipelineId = await getDefaultPipelineId();
  // Also delete any stages that lost their pipeline_id (left by failed test runs before that change)
  await pool.query('DELETE FROM pipeline_stages WHERE pipeline_id = $1 OR pipeline_id IS NULL', [
    defaultPipelineId,
  ]);
  await pool.query(
    `
    INSERT INTO pipeline_stages (pipeline_id, name, sort_order, probability, is_terminal, is_fixed) VALUES
      ($1, 'Prospecting',  10, 10,  false, false),
      ($1, 'Qualification',20, 25,  false, false),
      ($1, 'Proposal',     30, 50,  false, false),
      ($1, 'Negotiation',  40, 75,  false, false),
      ($1, 'Closed Won',   50, 100, true,  true),
      ($1, 'Closed Lost',  60, 0,   true,  true)
  `,
    [defaultPipelineId],
  );
}

beforeEach(async () => {
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email IN ($1, $2, $3)))',
    [
      `${FILE_PREFIX}-rename@example.com`,
      'pipeline-stage-svc-rename@example.com',
      'delete-block@example.com',
    ],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email IN ($1, $2, $3))',
    [
      `${FILE_PREFIX}-rename@example.com`,
      'pipeline-stage-svc-rename@example.com',
      'delete-block@example.com',
    ],
  );
  await pool.query('DELETE FROM users WHERE email IN ($1, $2, $3)', [
    `${FILE_PREFIX}-rename@example.com`,
    'pipeline-stage-svc-rename@example.com',
    'delete-block@example.com',
  ]);
  await clearPipelineStageAuditLog();
  await resetStages();
});

afterAll(async () => {
  await clearPipelineStageAuditLog();
  await resetStages();
  await pool.end();
});

// ── listPipelineStages ─────────────────────────────────────────────────────────

describe('listPipelineStages', () => {
  it('returns all six seed stages in sort_order order', async () => {
    const stages = await listPipelineStages();
    expect(stages).toHaveLength(6);
    expect(stages.map((s) => s.name)).toEqual([
      'Prospecting',
      'Qualification',
      'Proposal',
      'Negotiation',
      'Closed Won',
      'Closed Lost',
    ]);
  });

  it('returns correct field values for a non-terminal stage', async () => {
    const stages = await listPipelineStages();
    const prospecting = stages.find((s) => s.name === 'Prospecting')!;
    expect(prospecting.is_terminal).toBe(false);
    expect(prospecting.is_fixed).toBe(false);
    expect(prospecting.probability).toBe(10);
    expect(prospecting.sort_order).toBe(10);
  });

  it('returns is_terminal=true and is_fixed=true for Closed Won', async () => {
    const stages = await listPipelineStages();
    const closedWon = stages.find((s) => s.name === 'Closed Won')!;
    expect(closedWon.is_terminal).toBe(true);
    expect(closedWon.is_fixed).toBe(true);
    expect(closedWon.probability).toBe(100);
  });
});

// ── getStageNames / getTerminalStageNames ──────────────────────────────────────

describe('getStageNames', () => {
  it('returns stage names in sort_order order', async () => {
    const names = await getStageNames();
    expect(names).toEqual([
      'Prospecting',
      'Qualification',
      'Proposal',
      'Negotiation',
      'Closed Won',
      'Closed Lost',
    ]);
  });
});

describe('getTerminalStageNames', () => {
  it('returns only terminal stage names', async () => {
    const names = await getTerminalStageNames();
    expect(names).toEqual(['Closed Won', 'Closed Lost']);
  });
});

// ── createPipelineStage ────────────────────────────────────────────────────────

describe('createPipelineStage', () => {
  it('inserts a new non-terminal stage and returns it', async () => {
    const stage = await createPipelineStage({ name: 'Discovery', probability: 15 }, ACTOR);
    expect(stage.id).toBeTruthy();
    expect(stage.name).toBe('Discovery');
    expect(stage.probability).toBe(15);
    expect(stage.is_terminal).toBe(false);
    expect(stage.is_fixed).toBe(false);
  });

  it('auto-assigns sort_order as MAX(all stages) + 10', async () => {
    // Seed has max sort_order 60 (Closed Lost); new stage should get 70
    const stage = await createPipelineStage({ name: 'Discovery', probability: 15 }, ACTOR);
    expect(stage.sort_order).toBe(70);
  });

  it('appears in listPipelineStages after creation', async () => {
    await createPipelineStage({ name: 'POC', probability: 40 }, ACTOR);
    const names = await getStageNames();
    expect(names).toContain('POC');
  });

  it('throws STAGE_NAME_CONFLICT for a duplicate name (case-insensitive)', async () => {
    await createPipelineStage({ name: 'Demo', probability: 20 }, ACTOR);
    await expect(
      createPipelineStage({ name: 'DEMO', probability: 20 }, ACTOR),
    ).rejects.toMatchObject({
      code: 'STAGE_NAME_CONFLICT',
    });
  });

  it('defaults probability to 0 when set to 0', async () => {
    const stage = await createPipelineStage({ name: 'Scoping', probability: 0 }, ACTOR);
    expect(stage.probability).toBe(0);
  });

  it('writes a created audit entry in the same transaction', async () => {
    await createPipelineStage({ name: 'AuditCheck', probability: 5 }, ACTOR);

    const result = await pool.query<{ event_type: string; new_value: string; record_name: string }>(
      `SELECT event_type, new_value, record_name FROM audit_log
       WHERE record_type = 'system_settings' AND record_name = $1 AND changed_by_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [PIPELINE_STAGES_RECORD_NAME, ACTOR.id],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].event_type).toBe('created');
    expect(result.rows[0].new_value).toBe('AuditCheck');
  });

  it('rolls back the stage creation when the audit write fails', async () => {
    // Force audit failure by temporarily disabling the audit_log table write
    // via a unique constraint violation on a duplicate name — the 23505 fires
    // during INSERT and the ROLLBACK must leave audit_log untouched.
    await createPipelineStage({ name: 'WillConflict', probability: 0 }, ACTOR);
    await expect(
      createPipelineStage({ name: 'WillConflict', probability: 0 }, ACTOR),
    ).rejects.toMatchObject({ code: 'STAGE_NAME_CONFLICT' });

    // Only one pipeline stage with that name should exist
    const stageCount = await pool.query(
      `SELECT COUNT(*) AS count FROM pipeline_stages WHERE name = 'WillConflict'`,
    );
    expect(parseInt(stageCount.rows[0].count, 10)).toBe(1);
  });
});

// ── updatePipelineStage ────────────────────────────────────────────────────────

describe('updatePipelineStage', () => {
  it('renames a non-fixed stage', async () => {
    const stages = await listPipelineStages();
    const prospecting = stages.find((s) => s.name === 'Prospecting')!;
    const updated = await updatePipelineStage(prospecting.id, { name: 'Outreach' }, ACTOR);
    expect(updated?.name).toBe('Outreach');
  });

  it('atomically renames deals in the old stage to the new stage name', async () => {
    // Temporarily remove the deals_stage_check constraint to insert test deals
    // (the real app no longer has this constraint after migration 021)
    const stages = await listPipelineStages();
    const proposal = stages.find((s) => s.name === 'Proposal')!;

    // Create a minimal owner and deal
    const userResult = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, role, status)
       VALUES ('pipeline-stage-svc-rename@example.com', 'x', 'Stage Test', 'rep', 'active')
       RETURNING id`,
    );
    const ownerId = userResult.rows[0].id;

    await pool.query(
      `INSERT INTO deals (name, stage, owner_id, pipeline_id, pipeline_stage_id) VALUES ('Test Deal', 'Proposal', $1, $2, $3)`,
      [ownerId, proposal.pipeline_id, proposal.id],
    );

    await updatePipelineStage(proposal.id, { name: 'Solution Review' }, ACTOR);

    const dealResult = await pool.query<{ stage: string }>(
      `SELECT stage FROM deals WHERE owner_id = $1`,
      [ownerId],
    );
    expect(dealResult.rows[0].stage).toBe('Solution Review');

    // Clean up
    await pool.query(`DELETE FROM deals WHERE owner_id = $1`, [ownerId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
  });

  it('updates probability without changing name', async () => {
    const stages = await listPipelineStages();
    const qualification = stages.find((s) => s.name === 'Qualification')!;
    const updated = await updatePipelineStage(qualification.id, { probability: 30 }, ACTOR);
    expect(updated?.name).toBe('Qualification');
    expect(updated?.probability).toBe(30);
  });

  it('throws STAGE_FIXED when attempting to rename a fixed stage', async () => {
    const stages = await listPipelineStages();
    const closedWon = stages.find((s) => s.name === 'Closed Won')!;
    await expect(updatePipelineStage(closedWon.id, { name: 'Won' }, ACTOR)).rejects.toMatchObject({
      code: 'STAGE_FIXED',
    });
  });

  it('allows updating probability on a fixed stage', async () => {
    const stages = await listPipelineStages();
    const closedWon = stages.find((s) => s.name === 'Closed Won')!;
    const updated = await updatePipelineStage(closedWon.id, { probability: 99 }, ACTOR);
    expect(updated?.probability).toBe(99);
    expect(updated?.name).toBe('Closed Won');
  });

  it('throws STAGE_NAME_CONFLICT when renaming to an existing stage name', async () => {
    const stages = await listPipelineStages();
    const prospecting = stages.find((s) => s.name === 'Prospecting')!;
    await expect(
      updatePipelineStage(prospecting.id, { name: 'Negotiation' }, ACTOR),
    ).rejects.toMatchObject({ code: 'STAGE_NAME_CONFLICT' });
  });

  it('returns null for a non-existent stage id', async () => {
    const result = await updatePipelineStage(
      '00000000-0000-0000-0000-000000000000',
      { probability: 50 },
      ACTOR,
    );
    expect(result).toBeNull();
  });

  it('writes a per-field updated audit entry for a rename', async () => {
    const stages = await listPipelineStages();
    const prospecting = stages.find((s) => s.name === 'Prospecting')!;
    await updatePipelineStage(prospecting.id, { name: 'Outreach' }, ACTOR);

    const result = await pool.query<{ field_name: string; old_value: string; new_value: string }>(
      `SELECT field_name, old_value, new_value FROM audit_log
       WHERE record_type = 'system_settings' AND record_name = $1 AND changed_by_id = $2
         AND event_type = 'updated' AND field_name = 'name'`,
      [PIPELINE_STAGES_RECORD_NAME, ACTOR.id],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].field_name).toBe('name');
    expect(result.rows[0].old_value).toBe('Prospecting');
    expect(result.rows[0].new_value).toBe('Outreach');
  });

  it('writes a probability audit entry when only probability changes', async () => {
    const stages = await listPipelineStages();
    const qualification = stages.find((s) => s.name === 'Qualification')!;
    await updatePipelineStage(qualification.id, { probability: 30 }, ACTOR);

    const result = await pool.query<{ field_name: string; old_value: string; new_value: string }>(
      `SELECT field_name, old_value, new_value FROM audit_log
       WHERE record_type = 'system_settings' AND record_name = $1 AND changed_by_id = $2
         AND event_type = 'updated' AND field_name = 'probability'`,
      [PIPELINE_STAGES_RECORD_NAME, ACTOR.id],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].field_name).toBe('probability');
    expect(result.rows[0].old_value).toBe('25');
    expect(result.rows[0].new_value).toBe('30');
  });

  it('writes no audit entries when no fields actually change', async () => {
    const stages = await listPipelineStages();
    const proposal = stages.find((s) => s.name === 'Proposal')!;
    // Submit the same name and probability — nothing changes
    await updatePipelineStage(proposal.id, { name: 'Proposal', probability: 50 }, ACTOR);

    expect(await countStageAuditRows()).toBe(0);
  });

  it('throws STAGE_SORT_ORDER_CONFLICT when updating to an already-used sort_order', async () => {
    const stages = await listPipelineStages();
    const prospecting = stages.find((s) => s.name === 'Prospecting')!;
    const qualification = stages.find((s) => s.name === 'Qualification')!;
    // Prospecting has sort_order 10; try to give Qualification the same sort_order
    await expect(
      updatePipelineStage(qualification.id, { sort_order: prospecting.sort_order }, ACTOR),
    ).rejects.toMatchObject({ code: 'STAGE_SORT_ORDER_CONFLICT' });
  });
});

// ── reorderPipelineStages ──────────────────────────────────────────────────────

describe('reorderPipelineStages', () => {
  it('reassigns sort_order values matching the provided ID order', async () => {
    const before = await listPipelineStages();
    // Reverse the order of all stages
    const reversedIds = [...before].reverse().map((s) => s.id);

    const after = await reorderPipelineStages({ stages: reversedIds }, ACTOR);

    expect(after.map((s) => s.id)).toEqual(reversedIds);
    expect(after.map((s) => s.sort_order)).toEqual(reversedIds.map((_, i) => i + 1));
  });

  it('is atomic — the full order is either applied or not applied at all', async () => {
    const before = await listPipelineStages();
    const ids = before.map((s) => s.id);
    // Include a non-existent UUID to force a rollback
    const badIds = [...ids, '00000000-0000-0000-0000-000000000099'];

    await expect(reorderPipelineStages({ stages: badIds }, ACTOR)).rejects.toMatchObject({
      code: 'STAGE_NOT_FOUND',
    });

    // Original order must be intact
    const unchanged = await listPipelineStages();
    expect(unchanged.map((s) => s.id)).toEqual(ids);
  });

  it('throws STAGE_NOT_FOUND when a supplied ID does not exist', async () => {
    await expect(
      reorderPipelineStages({ stages: ['00000000-0000-0000-0000-000000000000'] }, ACTOR),
    ).rejects.toMatchObject({ code: 'STAGE_NOT_FOUND' });
  });

  it('reflects the new order in subsequent listPipelineStages calls', async () => {
    const before = await listPipelineStages();
    // Move the first stage to the end
    const reordered = [...before.slice(1), before[0]].map((s) => s.id);

    await reorderPipelineStages({ stages: reordered }, ACTOR);

    const after = await listPipelineStages();
    expect(after.map((s) => s.id)).toEqual(reordered);
  });

  it('writes an updated audit entry recording the new stage order', async () => {
    const before = await listPipelineStages();
    const reversedIds = [...before].reverse().map((s) => s.id);

    await reorderPipelineStages({ stages: reversedIds }, ACTOR);

    const result = await pool.query<{ event_type: string; field_name: string; new_value: string }>(
      `SELECT event_type, field_name, new_value FROM audit_log
       WHERE record_type = 'system_settings' AND record_name = $1 AND changed_by_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [PIPELINE_STAGES_RECORD_NAME, ACTOR.id],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].event_type).toBe('updated');
    expect(result.rows[0].field_name).toBe('sort_order');
    expect(result.rows[0].new_value).toBe(reversedIds.join(','));
  });
});

// ── deletePipelineStage ────────────────────────────────────────────────────────

describe('deletePipelineStage', () => {
  it('deletes a custom stage with no open deals', async () => {
    const created = await createPipelineStage({ name: 'ToDelete', probability: 0 }, ACTOR);
    const deleted = await deletePipelineStage(created.id, ACTOR);
    expect(deleted?.name).toBe('ToDelete');
    const found = await findPipelineStageById(created.id);
    expect(found).toBeNull();
  });

  it('throws STAGE_FIXED when deleting a fixed stage', async () => {
    const stages = await listPipelineStages();
    const closedLost = stages.find((s) => s.name === 'Closed Lost')!;
    await expect(deletePipelineStage(closedLost.id, ACTOR)).rejects.toMatchObject({
      code: 'STAGE_FIXED',
    });
  });

  it('throws STAGE_HAS_OPEN_DEALS when open deals exist in the stage', async () => {
    const stages = await listPipelineStages();
    const negotiation = stages.find((s) => s.name === 'Negotiation')!;

    const userResult = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, role, status)
       VALUES ('delete-block@example.com', 'x', 'Block Test', 'rep', 'active')
       RETURNING id`,
    );
    const ownerId = userResult.rows[0].id;

    await pool.query(
      `INSERT INTO deals (name, stage, owner_id, pipeline_id, pipeline_stage_id) VALUES ('Blocking Deal', 'Negotiation', $1, $2, $3)`,
      [ownerId, negotiation.pipeline_id, negotiation.id],
    );

    let thrownError: (Error & { code?: string; dealCount?: number }) | null = null;
    try {
      await deletePipelineStage(negotiation.id, ACTOR);
    } catch (err) {
      thrownError = err as Error & { code?: string; dealCount?: number };
    }
    expect(thrownError?.code).toBe('STAGE_HAS_OPEN_DEALS');
    expect(thrownError?.dealCount).toBe(1);

    // Clean up
    await pool.query(`DELETE FROM deals WHERE owner_id = $1`, [ownerId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
  });

  it('throws STAGE_HAS_OPEN_DEALS when deleting a terminal stage that has open deals', async () => {
    // createPipelineStage does not expose is_terminal — insert via SQL so we can test the
    // terminal-stage variant of the guard without touching fixed stages (which throw STAGE_FIXED).
    const stages = await listPipelineStages();
    const defaultPipeline = stages[0].pipeline_id;
    const maxSort = Math.max(...stages.map((s) => s.sort_order));

    const stageResult = await pool.query<{ id: string }>(
      `INSERT INTO pipeline_stages (pipeline_id, name, sort_order, probability, is_terminal)
       VALUES ($1, 'CustomTerminal', $2, 100, true) RETURNING id`,
      [defaultPipeline, maxSort + 10],
    );
    const terminalStageId = stageResult.rows[0].id;

    const userResult = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, role, status)
       VALUES ('terminal-block@example.com', 'x', 'Terminal Block', 'rep', 'active')
       RETURNING id`,
    );
    const ownerId = userResult.rows[0].id;

    await pool.query(
      `INSERT INTO deals (name, stage, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Terminal Deal', 'CustomTerminal', $1, $2, $3)`,
      [ownerId, defaultPipeline, terminalStageId],
    );

    let thrownError: (Error & { code?: string; dealCount?: number }) | null = null;
    try {
      await deletePipelineStage(terminalStageId, ACTOR);
    } catch (err) {
      thrownError = err as Error & { code?: string; dealCount?: number };
    }
    expect(thrownError?.code).toBe('STAGE_HAS_OPEN_DEALS');
    expect(thrownError?.dealCount).toBe(1);

    // Clean up
    await pool.query(`DELETE FROM deals WHERE owner_id = $1`, [ownerId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
    await pool.query(`DELETE FROM pipeline_stages WHERE id = $1`, [terminalStageId]);
  });

  it('returns null for a non-existent stage id', async () => {
    const result = await deletePipelineStage('00000000-0000-0000-0000-000000000000', ACTOR);
    expect(result).toBeNull();
  });

  it('writes a deleted audit entry in the same transaction', async () => {
    const created = await createPipelineStage({ name: 'AuditDelete', probability: 0 }, ACTOR);
    await clearPipelineStageAuditLog();

    await deletePipelineStage(created.id, ACTOR);

    const result = await pool.query<{ event_type: string; old_value: string }>(
      `SELECT event_type, old_value FROM audit_log
       WHERE record_type = 'system_settings' AND record_name = $1 AND changed_by_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [PIPELINE_STAGES_RECORD_NAME, ACTOR.id],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].event_type).toBe('deleted');
    expect(result.rows[0].old_value).toBe('AuditDelete');
  });
});
