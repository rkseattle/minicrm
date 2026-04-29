/**
 * Integration tests for pipelineStageService (MINCRM-180).
 *
 * Runs against a real PostgreSQL test database.
 * Before each test the pipeline_stages table is restored to the six seed rows
 * so tests don't interfere with each other.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import {
  listPipelineStages,
  getStageNames,
  getTerminalStageNames,
  findPipelineStageById,
  createPipelineStage,
  updatePipelineStage,
  deletePipelineStage,
} from '../services/pipelineStageService.js';
import pool from '../db.js';

const FILE_PREFIX = 'pipeline-stage-svc';

/** Re-seeds the six default pipeline stages before each test */
async function resetStages(): Promise<void> {
  await pool.query('DELETE FROM pipeline_stages');
  await pool.query(`
    INSERT INTO pipeline_stages (name, sort_order, probability, is_terminal, is_fixed) VALUES
      ('Prospecting',  10, 10,  false, false),
      ('Qualification',20, 25,  false, false),
      ('Proposal',     30, 50,  false, false),
      ('Negotiation',  40, 75,  false, false),
      ('Closed Won',   50, 100, true,  true),
      ('Closed Lost',  60, 0,   true,  true)
  `);
}

beforeEach(async () => {
  await pool.query(
    "DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))",
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    "DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)",
    [`${FILE_PREFIX}-%`],
  );
  await resetStages();
});

afterAll(async () => {
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
    const stage = await createPipelineStage({ name: 'Discovery', probability: 15 });
    expect(stage.id).toBeTruthy();
    expect(stage.name).toBe('Discovery');
    expect(stage.probability).toBe(15);
    expect(stage.is_terminal).toBe(false);
    expect(stage.is_fixed).toBe(false);
  });

  it('auto-assigns sort_order as MAX(all stages) + 10', async () => {
    // Seed has max sort_order 60 (Closed Lost); new stage should get 70
    const stage = await createPipelineStage({ name: 'Discovery', probability: 15 });
    expect(stage.sort_order).toBe(70);
  });

  it('appears in listPipelineStages after creation', async () => {
    await createPipelineStage({ name: 'POC', probability: 40 });
    const names = await getStageNames();
    expect(names).toContain('POC');
  });

  it('throws STAGE_NAME_CONFLICT for a duplicate name (case-insensitive)', async () => {
    await createPipelineStage({ name: 'Demo', probability: 20 });
    await expect(createPipelineStage({ name: 'DEMO', probability: 20 })).rejects.toMatchObject({
      code: 'STAGE_NAME_CONFLICT',
    });
  });

  it('defaults probability to 0 when set to 0', async () => {
    const stage = await createPipelineStage({ name: 'Scoping', probability: 0 });
    expect(stage.probability).toBe(0);
  });
});

// ── updatePipelineStage ────────────────────────────────────────────────────────

describe('updatePipelineStage', () => {
  it('renames a non-fixed stage', async () => {
    const stages = await listPipelineStages();
    const prospecting = stages.find((s) => s.name === 'Prospecting')!;
    const updated = await updatePipelineStage(prospecting.id, { name: 'Outreach' });
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
      `INSERT INTO deals (name, stage, owner_id) VALUES ('Test Deal', 'Proposal', $1)`,
      [ownerId],
    );

    await updatePipelineStage(proposal.id, { name: 'Solution Review' });

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
    const updated = await updatePipelineStage(qualification.id, { probability: 30 });
    expect(updated?.name).toBe('Qualification');
    expect(updated?.probability).toBe(30);
  });

  it('throws STAGE_FIXED when attempting to rename a fixed stage', async () => {
    const stages = await listPipelineStages();
    const closedWon = stages.find((s) => s.name === 'Closed Won')!;
    await expect(updatePipelineStage(closedWon.id, { name: 'Won' })).rejects.toMatchObject({
      code: 'STAGE_FIXED',
    });
  });

  it('allows updating probability on a fixed stage', async () => {
    const stages = await listPipelineStages();
    const closedWon = stages.find((s) => s.name === 'Closed Won')!;
    const updated = await updatePipelineStage(closedWon.id, { probability: 99 });
    expect(updated?.probability).toBe(99);
    expect(updated?.name).toBe('Closed Won');
  });

  it('throws STAGE_NAME_CONFLICT when renaming to an existing stage name', async () => {
    const stages = await listPipelineStages();
    const prospecting = stages.find((s) => s.name === 'Prospecting')!;
    await expect(
      updatePipelineStage(prospecting.id, { name: 'Negotiation' }),
    ).rejects.toMatchObject({ code: 'STAGE_NAME_CONFLICT' });
  });

  it('returns null for a non-existent stage id', async () => {
    const result = await updatePipelineStage('00000000-0000-0000-0000-000000000000', {
      probability: 50,
    });
    expect(result).toBeNull();
  });

  it('throws STAGE_SORT_ORDER_CONFLICT when updating to an already-used sort_order', async () => {
    const stages = await listPipelineStages();
    const prospecting = stages.find((s) => s.name === 'Prospecting')!;
    const qualification = stages.find((s) => s.name === 'Qualification')!;
    // Prospecting has sort_order 10; try to give Qualification the same sort_order
    await expect(
      updatePipelineStage(qualification.id, { sort_order: prospecting.sort_order }),
    ).rejects.toMatchObject({ code: 'STAGE_SORT_ORDER_CONFLICT' });
  });
});

// ── deletePipelineStage ────────────────────────────────────────────────────────

describe('deletePipelineStage', () => {
  it('deletes a custom stage with no open deals', async () => {
    const created = await createPipelineStage({ name: 'ToDelete', probability: 0 });
    const deleted = await deletePipelineStage(created.id);
    expect(deleted?.name).toBe('ToDelete');
    const found = await findPipelineStageById(created.id);
    expect(found).toBeNull();
  });

  it('throws STAGE_FIXED when deleting a fixed stage', async () => {
    const stages = await listPipelineStages();
    const closedLost = stages.find((s) => s.name === 'Closed Lost')!;
    await expect(deletePipelineStage(closedLost.id)).rejects.toMatchObject({
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
      `INSERT INTO deals (name, stage, owner_id) VALUES ('Blocking Deal', 'Negotiation', $1)`,
      [ownerId],
    );

    let thrownError: (Error & { code?: string; dealCount?: number }) | null = null;
    try {
      await deletePipelineStage(negotiation.id);
    } catch (err) {
      thrownError = err as Error & { code?: string; dealCount?: number };
    }
    expect(thrownError?.code).toBe('STAGE_HAS_OPEN_DEALS');
    expect(thrownError?.dealCount).toBe(1);

    // Clean up
    await pool.query(`DELETE FROM deals WHERE owner_id = $1`, [ownerId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
  });

  it('returns null for a non-existent stage id', async () => {
    const result = await deletePipelineStage('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
