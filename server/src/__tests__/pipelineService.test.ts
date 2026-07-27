/**
 * Integration tests for pipelineService (MINCRM-397).
 *
 * Runs against a real PostgreSQL test database.
 * The default pipeline is guaranteed to exist after migration 056.
 * Each test creates pipelines via the service and cleans up in afterEach so the
 * single-default-pipeline constraint is never violated.
 *
 * This file mutates the pipelines table globally and is listed in SERIAL_FILES
 * so it runs sequentially alongside pipelineStageService.test.ts.
 */

import 'dotenv/config';
import {
  listPipelines,
  findPipelineById,
  createPipeline,
  updatePipeline,
  deletePipeline,
  getDefaultPipelineId,
} from '../services/pipelineService.js';
import pool from '../db.js';

const FILE_PREFIX = 'pipeline-svc';

/** Removes non-default pipelines created by this test file. */
async function cleanupTestPipelines(): Promise<void> {
  await pool.query(`DELETE FROM pipelines WHERE is_default = false AND name LIKE $1`, [
    `${FILE_PREFIX}-%`,
  ]);
}

/**
 * Clears audit entries written by this file. Disables the append-only
 * trigger temporarily. Filters by record_type/record_name, not an actor
 * ID, so this can't share testUtils.ts's clearAuditLogFor helper directly
 * — same underlying fix though: all three statements run in one
 * transaction on a single client, since ALTER TABLE ... DISABLE/ENABLE
 * TRIGGER is catalog-level (visible to every concurrent connection, not
 * session-scoped) but takes an ACCESS EXCLUSIVE lock on the table held
 * until COMMIT — that lock serializes any other caller of this same
 * disable/delete/enable sequence (including this file's own sibling,
 * pipelineStageService.test.ts, run alongside it per SERIAL_FILES) behind
 * this one. See clearAuditLogFor's own docblock for the two claims
 * verified directly against a real Postgres session pair.
 */
async function clearPipelineAuditLog(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_modify');
    await client.query(
      `DELETE FROM audit_log WHERE record_type = 'system_settings' AND record_name = 'pipelines'`,
    );
    await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_modify');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ACTOR.id must reference a real user row because pipelines.created_by is a FK.
const ACTOR_EMAIL = `${FILE_PREFIX}-actor@example.com`;
const ACTOR = { id: '', name: 'Test Actor' };

beforeAll(async () => {
  // Upsert a real user so the FK on pipelines.created_by is satisfied.
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, role, status)
     VALUES ($1, 'x', 'Test Actor', 'admin', 'active')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [ACTOR_EMAIL],
  );
  ACTOR.id = rows[0].id;
});

beforeEach(async () => {
  await cleanupTestPipelines();
  await clearPipelineAuditLog();
});

afterAll(async () => {
  await cleanupTestPipelines();
  await clearPipelineAuditLog();
  await pool.query('DELETE FROM users WHERE email = $1', [ACTOR_EMAIL]);
  await pool.end();
});

// ── getDefaultPipelineId ──────────────────────────────────────────────────────

describe('getDefaultPipelineId', () => {
  it('returns a UUID string for the seeded default pipeline', async () => {
    const id = await getDefaultPipelineId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ── listPipelines ─────────────────────────────────────────────────────────────

describe('listPipelines', () => {
  it('includes the default pipeline', async () => {
    const pipelines = await listPipelines();
    const defaultPipeline = pipelines.find((p) => p.is_default);
    expect(defaultPipeline).toBeDefined();
  });

  it('returns newly created pipeline in the list', async () => {
    const name = `${FILE_PREFIX}-list-${Date.now()}`;
    await createPipeline({ name }, ACTOR);
    const pipelines = await listPipelines();
    expect(pipelines.some((p) => p.name === name)).toBe(true);
  });

  it('returns default pipeline first (sorted is_default DESC)', async () => {
    const name = `${FILE_PREFIX}-aaa-first-alpha-${Date.now()}`;
    await createPipeline({ name }, ACTOR);
    const pipelines = await listPipelines();
    expect(pipelines[0].is_default).toBe(true);
  });
});

// ── findPipelineById ──────────────────────────────────────────────────────────

describe('findPipelineById', () => {
  it('returns the pipeline when it exists', async () => {
    const name = `${FILE_PREFIX}-find-${Date.now()}`;
    const created = await createPipeline({ name }, ACTOR);
    const found = await findPipelineById(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe(name);
  });

  it('returns null when the pipeline does not exist', async () => {
    const found = await findPipelineById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });
});

// ── createPipeline ────────────────────────────────────────────────────────────

describe('createPipeline', () => {
  it('creates a pipeline with the correct name and is_default=false', async () => {
    const name = `${FILE_PREFIX}-create-${Date.now()}`;
    const pipeline = await createPipeline({ name }, ACTOR);
    expect(pipeline.name).toBe(name);
    expect(pipeline.is_default).toBe(false);
    expect(typeof pipeline.id).toBe('string');
  });

  it('stores the name exactly as provided (trimming is the controller schema responsibility)', async () => {
    const name = `${FILE_PREFIX}-trim-${Date.now()}`;
    const pipeline = await createPipeline({ name }, ACTOR);
    expect(pipeline.name).toBe(name);
  });

  it('writes an audit entry in the same transaction', async () => {
    const name = `${FILE_PREFIX}-audit-${Date.now()}`;
    await createPipeline({ name }, ACTOR);
    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'system_settings' AND record_name = 'pipelines' AND event_type = 'created' AND new_value = $1`,
      [name],
    );
    expect(rows.length).toBe(1);
  });

  it('throws PIPELINE_NAME_CONFLICT on duplicate name (23505)', async () => {
    const name = `${FILE_PREFIX}-dup-${Date.now()}`;
    await createPipeline({ name }, ACTOR);

    await expect(createPipeline({ name }, ACTOR)).rejects.toMatchObject({
      code: 'PIPELINE_NAME_CONFLICT',
    });
  });

  it('is case-insensitive for name uniqueness', async () => {
    const name = `${FILE_PREFIX}-case-${Date.now()}`;
    await createPipeline({ name: name.toLowerCase() }, ACTOR);

    await expect(createPipeline({ name: name.toUpperCase() }, ACTOR)).rejects.toMatchObject({
      code: 'PIPELINE_NAME_CONFLICT',
    });
  });
});

// ── updatePipeline ────────────────────────────────────────────────────────────

describe('updatePipeline', () => {
  it('renames a pipeline and returns the updated row', async () => {
    const original = `${FILE_PREFIX}-upd-orig-${Date.now()}`;
    const created = await createPipeline({ name: original }, ACTOR);

    const newName = `${FILE_PREFIX}-upd-new-${Date.now()}`;
    const updated = await updatePipeline(created.id, { name: newName }, ACTOR);

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe(newName);
    expect(updated!.id).toBe(created.id);
  });

  it('writes an audit entry for the rename', async () => {
    const original = `${FILE_PREFIX}-upd-audit-orig-${Date.now()}`;
    const created = await createPipeline({ name: original }, ACTOR);
    const newName = `${FILE_PREFIX}-upd-audit-new-${Date.now()}`;

    await updatePipeline(created.id, { name: newName }, ACTOR);

    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'system_settings' AND record_name = 'pipelines' AND event_type = 'updated' AND old_value = $1 AND new_value = $2`,
      [original, newName],
    );
    expect(rows.length).toBe(1);
  });

  it('returns null when the pipeline does not exist', async () => {
    const result = await updatePipeline(
      '00000000-0000-0000-0000-000000000000',
      { name: `${FILE_PREFIX}-ghost` },
      ACTOR,
    );
    expect(result).toBeNull();
  });

  it('throws PIPELINE_NAME_CONFLICT when renaming to an existing name', async () => {
    const nameA = `${FILE_PREFIX}-conflict-a-${Date.now()}`;
    const nameB = `${FILE_PREFIX}-conflict-b-${Date.now()}`;
    await createPipeline({ name: nameA }, ACTOR);
    const pipelineB = await createPipeline({ name: nameB }, ACTOR);

    await expect(updatePipeline(pipelineB.id, { name: nameA }, ACTOR)).rejects.toMatchObject({
      code: 'PIPELINE_NAME_CONFLICT',
    });
  });

  it('allows renaming the default pipeline', async () => {
    const defaultId = await getDefaultPipelineId();
    const originalDefault = await findPipelineById(defaultId);
    const newName = `${FILE_PREFIX}-default-rename-${Date.now()}`;

    try {
      const updated = await updatePipeline(defaultId, { name: newName }, ACTOR);
      expect(updated).not.toBeNull();
      expect(updated!.is_default).toBe(true);
    } finally {
      // Restore original name so other tests that assume a "Default" pipeline are unaffected
      if (originalDefault) {
        await updatePipeline(defaultId, { name: originalDefault.name }, ACTOR);
      }
    }
  });
});

// ── deletePipeline ────────────────────────────────────────────────────────────

describe('deletePipeline', () => {
  it('deletes a non-default pipeline with no deals and returns the deleted row', async () => {
    const name = `${FILE_PREFIX}-del-${Date.now()}`;
    const created = await createPipeline({ name }, ACTOR);

    const deleted = await deletePipeline(created.id, ACTOR);

    expect(deleted).not.toBeNull();
    expect(deleted!.id).toBe(created.id);
    expect(await findPipelineById(created.id)).toBeNull();
  });

  it('returns null when the pipeline does not exist', async () => {
    const result = await deletePipeline('00000000-0000-0000-0000-000000000000', ACTOR);
    expect(result).toBeNull();
  });

  it('writes an audit entry for the deletion', async () => {
    const name = `${FILE_PREFIX}-del-audit-${Date.now()}`;
    const created = await createPipeline({ name }, ACTOR);
    await deletePipeline(created.id, ACTOR);

    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'system_settings' AND record_name = 'pipelines' AND event_type = 'deleted' AND old_value = $1`,
      [name],
    );
    expect(rows.length).toBe(1);
  });

  it('throws PIPELINE_DEFAULT when attempting to delete the default pipeline', async () => {
    const defaultId = await getDefaultPipelineId();
    await expect(deletePipeline(defaultId, ACTOR)).rejects.toMatchObject({
      code: 'PIPELINE_DEFAULT',
    });
  });

  it('throws PIPELINE_HAS_DEALS when the pipeline has deals and includes dealCount', async () => {
    const name = `${FILE_PREFIX}-del-deals-${Date.now()}`;
    const created = await createPipeline({ name }, ACTOR);

    // Insert a stage into the new pipeline so a deal can be created in it
    const { rows: stageRows } = await pool.query<{ id: string }>(
      `INSERT INTO pipeline_stages (pipeline_id, name, sort_order, probability, is_terminal, is_fixed)
       VALUES ($1, $2, 10, 50, false, false) RETURNING id`,
      [created.id, `${FILE_PREFIX}-stage-${Date.now()}`],
    );
    const stageName = (
      await pool.query<{ name: string }>('SELECT name FROM pipeline_stages WHERE id = $1', [
        stageRows[0].id,
      ])
    ).rows[0].name;

    // Use a real user to satisfy the FK on deals.owner_id
    const { rows: userRows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, role, status) VALUES ($1, 'x', 'Test', 'rep', 'active') RETURNING id`,
      [`${FILE_PREFIX}-del-deals-user-${Date.now()}@example.com`],
    );
    const userId = userRows[0].id;

    try {
      await pool.query(
        `INSERT INTO deals (pipeline_id, name, stage, currency, owner_id, pipeline_stage_id) VALUES ($1, $2, $3, 'USD', $4, $5)`,
        [created.id, `${FILE_PREFIX}-deal`, stageName, userId, stageRows[0].id],
      );

      await expect(deletePipeline(created.id, ACTOR)).rejects.toMatchObject({
        code: 'PIPELINE_HAS_DEALS',
        dealCount: 1,
      });
    } finally {
      await pool.query('DELETE FROM deals WHERE pipeline_id = $1', [created.id]);
      await pool.query('DELETE FROM pipeline_stages WHERE pipeline_id = $1', [created.id]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.query('DELETE FROM pipelines WHERE id = $1', [created.id]);
    }
  });

  it('cascades deletion to pipeline_stages rows', async () => {
    const name = `${FILE_PREFIX}-cascade-${Date.now()}`;
    const created = await createPipeline({ name }, ACTOR);

    await pool.query(
      `INSERT INTO pipeline_stages (pipeline_id, name, sort_order, probability, is_terminal, is_fixed)
       VALUES ($1, $2, 10, 0, false, false)`,
      [created.id, `${FILE_PREFIX}-stage-cascade-${Date.now()}`],
    );

    await deletePipeline(created.id, ACTOR);

    const { rows } = await pool.query('SELECT id FROM pipeline_stages WHERE pipeline_id = $1', [
      created.id,
    ]);
    expect(rows).toHaveLength(0);
  });
});
