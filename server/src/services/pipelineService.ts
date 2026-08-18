/**
 * Pipeline service — business logic for pipeline CRUD.
 * All database access for the pipelines table goes through this module.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CreatePipelineInput,
  UpdatePipelineInput,
  PipelineResponse,
} from '@minicrm/shared/schemas/pipelineSchema.js';
import { writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';
import { withRlsQuery } from './rlsContextService.js';

export const SYSTEM_ACTOR: AuditActor = {
  id: '00000000-0000-0000-0000-000000000000',
  name: 'System',
};

/** Shape of a pipelines row as stored in the database */
export interface PipelineRow {
  id: string;
  name: string;
  is_default: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const PIPELINE_SELECT = 'id, name, is_default, created_by, created_at, updated_at';

/**
 * Maps a PipelineRow to the API response shape.
 */
export function toPipelineResponse(row: PipelineRow): PipelineResponse {
  return {
    id: row.id,
    name: row.name,
    is_default: row.is_default,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Returns the UUID of the default pipeline. Throws if none exists (should never
 * happen after migration 056 seeds it).
 */
export async function getDefaultPipelineId(db: typeof pool | PoolClient = pool): Promise<string> {
  const result = await db.query<{ id: string }>(
    'SELECT id FROM pipelines WHERE is_default = true LIMIT 1',
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('No default pipeline found — migration 056 may not have run');
  }
  return row.id;
}

/**
 * Returns all pipelines ordered by name.
 */
export async function listPipelines(): Promise<PipelineRow[]> {
  const result = await pool.query<PipelineRow>(
    `SELECT ${PIPELINE_SELECT} FROM pipelines ORDER BY is_default DESC, name ASC`,
  );
  return result.rows;
}

/**
 * Finds a pipeline by its UUID.
 */
export async function findPipelineById(id: string): Promise<PipelineRow | null> {
  const result = await pool.query<PipelineRow>(
    `SELECT ${PIPELINE_SELECT} FROM pipelines WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Creates a new (non-default) pipeline.
 *
 * @throws Error with code PIPELINE_NAME_CONFLICT if the name is already in use
 */
export async function createPipeline(
  params: CreatePipelineInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<PipelineRow> {
  const { name } = params;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<PipelineRow>(
      `INSERT INTO pipelines (name, is_default, created_by)
       VALUES ($1, false, $2)
       RETURNING ${PIPELINE_SELECT}`,
      [name, actor.id === SYSTEM_ACTOR.id ? null : actor.id],
    );
    const pipeline = result.rows[0];

    await writeAuditEntry(client, {
      recordType: 'system_settings',
      recordName: 'pipelines',
      eventType: 'created',
      newValue: pipeline.name,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return pipeline;
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as NodeJS.ErrnoException).code === '23505') {
      const e = new Error(`A pipeline named "${name}" already exists`);
      (e as NodeJS.ErrnoException).code = 'PIPELINE_NAME_CONFLICT';
      throw e;
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Renames a pipeline. The default pipeline may be renamed.
 *
 * @returns The updated pipeline row, or null if not found
 * @throws Error with code PIPELINE_NAME_CONFLICT if the new name is already in use
 */
export async function updatePipeline(
  id: string,
  params: UpdatePipelineInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<PipelineRow | null> {
  const existing = await findPipelineById(id);
  if (!existing) return null;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const setClauses: string[] = ['updated_at = now()'];
    const values: unknown[] = [id];
    if (params.name !== undefined) {
      values.push(params.name);
      setClauses.push(`name = $${values.length}`);
    }

    const result = await client.query<PipelineRow>(
      `UPDATE pipelines SET ${setClauses.join(', ')} WHERE id = $1 RETURNING ${PIPELINE_SELECT}`,
      values,
    );
    const updated = result.rows[0] ?? null;

    if (updated && params.name !== undefined && params.name !== existing.name) {
      await writeAuditEntry(client, {
        recordType: 'system_settings',
        recordName: 'pipelines',
        eventType: 'updated',
        fieldName: 'name',
        oldValue: existing.name,
        newValue: params.name,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as NodeJS.ErrnoException).code === '23505') {
      const e = new Error(`A pipeline named "${params.name}" already exists`);
      (e as NodeJS.ErrnoException).code = 'PIPELINE_NAME_CONFLICT';
      throw e;
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deletes a non-default pipeline and its associated stages (CASCADE).
 * Deletion is blocked when any deals reference this pipeline.
 *
 * @throws Error with code PIPELINE_DEFAULT if attempting to delete the default pipeline
 * @throws Error with code PIPELINE_HAS_DEALS if deals exist in this pipeline
 */
export async function deletePipeline(
  id: string,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<PipelineRow | null> {
  const existing = await findPipelineById(id);
  if (!existing) return null;

  if (existing.is_default) {
    const err = new Error('The default pipeline cannot be deleted');
    (err as NodeJS.ErrnoException).code = 'PIPELINE_DEFAULT';
    throw err;
  }

  // Block deletion if any deals are still assigned to this pipeline.
  // Uses withRlsQuery so the deal count is accurate under RLS (avoids a
  // false-zero that would let admins delete pipelines that still have deals).
  const dealCountResult = await withRlsQuery<{ count: string }>((client) =>
    client.query('SELECT COUNT(*) AS count FROM deals WHERE pipeline_id = $1', [id]),
  );
  const dealCount = parseInt(dealCountResult.rows[0].count, 10);
  if (dealCount > 0) {
    const err = new Error(
      `Cannot delete pipeline "${existing.name}" — ${dealCount} deal(s) must be moved first`,
    );
    (err as NodeJS.ErrnoException).code = 'PIPELINE_HAS_DEALS';
    (err as Error & { dealCount: number }).dealCount = dealCount;
    throw err;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // pipeline_stages rows are removed via ON DELETE CASCADE
    const result = await client.query<PipelineRow>(
      `DELETE FROM pipelines WHERE id = $1 RETURNING ${PIPELINE_SELECT}`,
      [id],
    );
    const deleted = result.rows[0];

    if (deleted) {
      await writeAuditEntry(client, {
        recordType: 'system_settings',
        recordName: 'pipelines',
        eventType: 'deleted',
        oldValue: deleted.name,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    await client.query('COMMIT');
    return deleted ?? null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
