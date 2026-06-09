/**
 * Pipeline stage service — business logic for pipeline stage configuration (MINCRM-180).
 * All operations are scoped to a specific pipeline (MINCRM-397).
 * All database access for pipeline_stages goes through this module.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CreatePipelineStageInput,
  UpdatePipelineStageInput,
  ReorderPipelineStagesInput,
  PipelineStageResponse,
  StageExitRequirements,
} from '@minicrm/shared/schemas/pipelineStageSchema.js';
import { writeAuditEntry, writeAuditEntries, SYSTEM_ACTOR } from './auditService.js';
import { withRlsQuery } from './rlsContextService.js';
import type { AuditActor, AuditEntryInput } from './auditService.js';
import { getDefaultPipelineId } from './pipelineService.js';

/** Shape of a pipeline_stages row as stored in the database */
export interface PipelineStageRow {
  id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
  probability: number;
  is_terminal: boolean;
  is_fixed: boolean;
  /** Configurable data quality gates for stage transitions (MINCRM-527) */
  stage_exit_requirements: StageExitRequirements;
  created_at: Date;
  updated_at: Date;
}

/** Columns to SELECT for stage list queries */
const STAGE_SELECT =
  'id, pipeline_id, name, sort_order, probability, is_terminal, is_fixed, stage_exit_requirements, created_at, updated_at';

/**
 * Resolves a pipeline_id, falling back to the default pipeline when not supplied.
 */
async function resolvePipelineId(pipelineId?: string): Promise<string> {
  return pipelineId ?? getDefaultPipelineId();
}

/**
 * Ensures stage_exit_requirements always has both arrays, even when the DB stores
 * the column default `{}` (which has no keys). Rows created before MINCRM-527 or
 * stages that never had requirements set are safely normalised here. (MINCRM-527)
 */
function normaliseRow(row: PipelineStageRow): PipelineStageRow {
  const raw = row.stage_exit_requirements as Partial<StageExitRequirements> | null | undefined;
  return {
    ...row,
    stage_exit_requirements: {
      required_fields: raw?.required_fields ?? [],
      warning_fields: raw?.warning_fields ?? [],
    },
  };
}

/**
 * Returns all pipeline stages for the given pipeline, ordered by sort_order ASC.
 */
export async function listPipelineStages(pipelineId?: string): Promise<PipelineStageRow[]> {
  const pid = await resolvePipelineId(pipelineId);
  const result = await pool.query<PipelineStageRow>(
    `SELECT ${STAGE_SELECT} FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY sort_order ASC`,
    [pid],
  );
  return result.rows.map(normaliseRow);
}

/**
 * Returns the stage names in pipeline order for the given pipeline.
 * Used by the deal controller to validate submitted stage values.
 */
export async function getStageNames(pipelineId?: string): Promise<string[]> {
  const pid = await resolvePipelineId(pipelineId);
  const result = await pool.query<{ name: string }>(
    'SELECT name FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY sort_order ASC',
    [pid],
  );
  return result.rows.map((r) => r.name);
}

/**
 * Returns the terminal stage names (is_terminal = true) for the given pipeline.
 */
export async function getTerminalStageNames(pipelineId?: string): Promise<string[]> {
  const pid = await resolvePipelineId(pipelineId);
  const result = await pool.query<{ name: string }>(
    'SELECT name FROM pipeline_stages WHERE pipeline_id = $1 AND is_terminal = true ORDER BY sort_order ASC',
    [pid],
  );
  return result.rows.map((r) => r.name);
}

/**
 * Finds a single pipeline stage by its UUID (pipeline-agnostic lookup).
 */
export async function findPipelineStageById(id: string): Promise<PipelineStageRow | null> {
  const result = await pool.query<PipelineStageRow>(
    `SELECT ${STAGE_SELECT} FROM pipeline_stages WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ? normaliseRow(result.rows[0]) : null;
}

/**
 * Finds a single pipeline stage by its name within a specific pipeline.
 * Used by dealService to resolve a stage name to its UUID on deal create/update.
 * (MINCRM-499)
 */
export async function findPipelineStageByNameAndPipeline(
  name: string,
  pipelineId: string,
): Promise<PipelineStageRow | null> {
  const result = await pool.query<PipelineStageRow>(
    `SELECT ${STAGE_SELECT} FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1`,
    [name, pipelineId],
  );
  return result.rows[0] ? normaliseRow(result.rows[0]) : null;
}

/**
 * Creates a new pipeline stage within the specified pipeline.
 *
 * sort_order is auto-assigned as MAX(sort_order within that pipeline) + 10.
 * Name uniqueness is enforced per-pipeline by the DB unique index.
 * A 23505 violation is caught and re-thrown as STAGE_NAME_CONFLICT.
 */
export async function createPipelineStage(
  params: CreatePipelineStageInput & { pipeline_id?: string },
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<PipelineStageRow> {
  const { name, probability, pipeline_id: pipelineIdParam } = params;
  const pipelineId = await resolvePipelineId(pipelineIdParam);

  const maxResult = await pool.query<{ max: number | null }>(
    'SELECT MAX(sort_order) AS max FROM pipeline_stages WHERE pipeline_id = $1',
    [pipelineId],
  );
  const sortOrder = (maxResult.rows[0].max ?? 0) + 10;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<PipelineStageRow>(
      `INSERT INTO pipeline_stages (pipeline_id, name, sort_order, probability)
       VALUES ($1, $2, $3, $4)
       RETURNING ${STAGE_SELECT}`,
      [pipelineId, name, sortOrder, probability ?? 0],
    );
    const stage = result.rows[0];

    await writeAuditEntry(client, {
      recordType: 'system_settings',
      recordName: 'pipeline_stages',
      eventType: 'created',
      newValue: stage.name,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return normaliseRow(stage);
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as NodeJS.ErrnoException).code === '23505') {
      const e = new Error(`A stage named "${name}" already exists in this pipeline`);
      (e as NodeJS.ErrnoException).code = 'STAGE_NAME_CONFLICT';
      throw e;
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Updates an existing pipeline stage.
 *
 * When the name changes, all deals in the same pipeline currently at the old
 * stage name are updated atomically in the same transaction.
 *
 * Fixed stages (is_fixed = true) may not have their name changed.
 */
export async function updatePipelineStage(
  id: string,
  params: UpdatePipelineStageInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<PipelineStageRow | null> {
  const existing = await findPipelineStageById(id);
  if (!existing) return null;

  if (params.name !== undefined && params.name !== existing.name && existing.is_fixed) {
    const err = new Error('Fixed stages cannot be renamed');
    (err as NodeJS.ErrnoException).code = 'STAGE_FIXED';
    throw err;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // If renaming, atomically update all deals in the same pipeline at the old stage
    if (params.name !== undefined && params.name !== existing.name) {
      await client.query('UPDATE deals SET stage = $1 WHERE stage = $2 AND pipeline_id = $3', [
        params.name,
        existing.name,
        existing.pipeline_id,
      ]);
    }

    // Build dynamic SET clause
    const setClauses: string[] = [];
    const values: unknown[] = [id];

    if (params.name !== undefined) {
      values.push(params.name);
      setClauses.push(`name = $${values.length}`);
    }
    if (params.sort_order !== undefined) {
      values.push(params.sort_order);
      setClauses.push(`sort_order = $${values.length}`);
    }
    if (params.probability !== undefined) {
      values.push(params.probability);
      setClauses.push(`probability = $${values.length}`);
    }
    if (params.stage_exit_requirements !== undefined) {
      values.push(JSON.stringify(params.stage_exit_requirements));
      setClauses.push(`stage_exit_requirements = $${values.length}`);
    }

    setClauses.push('updated_at = now()');

    const result = await client.query<PipelineStageRow>(
      `UPDATE pipeline_stages
       SET ${setClauses.join(', ')}
       WHERE id = $1
       RETURNING ${STAGE_SELECT}`,
      values,
    );

    const updated = result.rows[0];
    if (updated) {
      const auditBase = {
        recordType: 'system_settings' as const,
        recordName: 'pipeline_stages',
        changedById: actor.id,
        changedByName: actor.name,
      };
      const entries: AuditEntryInput[] = [];
      if (params.name !== undefined && params.name !== existing.name) {
        entries.push({
          ...auditBase,
          eventType: 'updated',
          fieldName: 'name',
          oldValue: existing.name,
          newValue: params.name,
        });
      }
      if (params.sort_order !== undefined && params.sort_order !== existing.sort_order) {
        entries.push({
          ...auditBase,
          eventType: 'updated',
          fieldName: 'sort_order',
          oldValue: String(existing.sort_order),
          newValue: String(params.sort_order),
        });
      }
      if (params.probability !== undefined && params.probability !== existing.probability) {
        entries.push({
          ...auditBase,
          eventType: 'updated',
          fieldName: 'probability',
          oldValue: String(existing.probability),
          newValue: String(params.probability),
        });
      }
      if (
        params.stage_exit_requirements !== undefined &&
        JSON.stringify(params.stage_exit_requirements) !==
          JSON.stringify(existing.stage_exit_requirements)
      ) {
        entries.push({
          ...auditBase,
          eventType: 'updated',
          fieldName: 'stage_exit_requirements',
          oldValue: JSON.stringify(existing.stage_exit_requirements),
          newValue: JSON.stringify(params.stage_exit_requirements),
        });
      }
      if (entries.length > 0) {
        await writeAuditEntries(client, entries);
      }
    }

    await client.query('COMMIT');
    return updated ? normaliseRow(updated) : null;
  } catch (error) {
    await client.query('ROLLBACK');
    const pgCode = (error as NodeJS.ErrnoException).code;
    if (pgCode === '23505') {
      const constraint =
        (error as NodeJS.ErrnoException & { constraint?: string }).constraint ?? '';
      if (constraint.includes('sort_order') || params.name === undefined) {
        const e = new Error('That sort order is already in use by another stage');
        (e as NodeJS.ErrnoException).code = 'STAGE_SORT_ORDER_CONFLICT';
        throw e;
      }
      const e = new Error(`A stage named "${params.name}" already exists in this pipeline`);
      (e as NodeJS.ErrnoException).code = 'STAGE_NAME_CONFLICT';
      throw e;
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Deletes a pipeline stage.
 *
 * Deletion is blocked if:
 * - The stage is fixed (is_fixed = true)
 * - Any open deals within the same pipeline are currently in this stage
 */
export async function deletePipelineStage(
  id: string,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<PipelineStageRow | null> {
  const existing = await findPipelineStageById(id);
  if (!existing) return null;

  if (existing.is_fixed) {
    const err = new Error('Fixed stages cannot be deleted');
    (err as NodeJS.ErrnoException).code = 'STAGE_FIXED';
    throw err;
  }

  // Count open (non-terminal) deals currently in this stage, using the FK for correctness. (MINCRM-499)
  const terminalResult = await pool.query<{ id: string }>(
    'SELECT id FROM pipeline_stages WHERE pipeline_id = $1 AND is_terminal = true',
    [existing.pipeline_id],
  );
  const terminalIds = terminalResult.rows.map((r) => r.id);

  // Exclude the stage being deleted from the NOT IN list. If the stage is itself terminal,
  // leaving its id in would cancel the pipeline_stage_id = $1 condition (always false),
  // returning a count of 0 and bypassing the open-deal guard entirely.
  const otherTerminalIds = terminalIds.filter((tid) => tid !== existing.id);

  // When there are no other terminal stages, "NOT IN ()" is invalid SQL — omit the clause.
  // Uses withRlsQuery so the count reflects all deals regardless of owner under RLS.
  const dealCountResult =
    otherTerminalIds.length === 0
      ? await withRlsQuery<{ count: string }>((client) =>
          client.query(`SELECT COUNT(*) AS count FROM deals WHERE pipeline_stage_id = $1`, [
            existing.id,
          ]),
        )
      : await withRlsQuery<{ count: string }>((client) =>
          client.query(
            `SELECT COUNT(*) AS count FROM deals
             WHERE pipeline_stage_id = $1
               AND pipeline_stage_id NOT IN (${otherTerminalIds.map((_, i) => `$${i + 2}`).join(', ')})`,
            [existing.id, ...otherTerminalIds],
          ),
        );
  const openDealCount = parseInt(dealCountResult.rows[0].count, 10);

  if (openDealCount > 0) {
    const err = new Error(
      `Cannot delete stage "${existing.name}" — ${openDealCount} open deal(s) must be moved first`,
    );
    (err as NodeJS.ErrnoException).code = 'STAGE_HAS_OPEN_DEALS';
    (err as Error & { dealCount: number }).dealCount = openDealCount;
    throw err;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<PipelineStageRow>(
      `DELETE FROM pipeline_stages WHERE id = $1 RETURNING ${STAGE_SELECT}`,
      [id],
    );
    const deleted = result.rows[0];

    if (deleted) {
      await writeAuditEntry(client, {
        recordType: 'system_settings',
        recordName: 'pipeline_stages',
        eventType: 'deleted',
        oldValue: deleted.name,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    await client.query('COMMIT');
    return deleted ? normaliseRow(deleted) : null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Atomically reorders all pipeline stages within the specified pipeline by assigning
 * sort_order 1..N in the provided ID order (MINCRM-381).
 *
 * All IDs must reference stages within the same pipeline.
 */
export async function reorderPipelineStages(
  params: ReorderPipelineStagesInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<PipelineStageRow[]> {
  const { stages: orderedIds } = params;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Serialize concurrent reorders with a transaction-scoped advisory lock (MINCRM-387)
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pipeline_stages_reorder'))");

    // Temporarily set all sort_orders to large negative values to vacate unique index slots
    for (let i = 0; i < orderedIds.length; i++) {
      const tempOrder = -(i + 1);
      const res = await client.query<{ id: string }>(
        'UPDATE pipeline_stages SET sort_order = $1, updated_at = now() WHERE id = $2 RETURNING id',
        [tempOrder, orderedIds[i]],
      );
      if (res.rowCount === 0) {
        const err = new Error(`Pipeline stage not found: ${orderedIds[i]}`);
        (err as NodeJS.ErrnoException).code = 'STAGE_NOT_FOUND';
        throw err;
      }
    }

    // Assign the final 1-based sort orders
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        'UPDATE pipeline_stages SET sort_order = $1, updated_at = now() WHERE id = $2',
        [i + 1, orderedIds[i]],
      );
    }

    // Determine the pipeline_id from the first stage to scope the SELECT
    const firstStage = await client.query<{ pipeline_id: string }>(
      'SELECT pipeline_id FROM pipeline_stages WHERE id = $1',
      [orderedIds[0]],
    );
    const pipelineId = firstStage.rows[0]?.pipeline_id;

    const result = await client.query<PipelineStageRow>(
      `SELECT ${STAGE_SELECT} FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY sort_order ASC`,
      [pipelineId],
    );

    await writeAuditEntry(client, {
      recordType: 'system_settings',
      recordName: 'pipeline_stages',
      eventType: 'updated',
      fieldName: 'sort_order',
      newValue: orderedIds.join(','),
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    return result.rows.map(normaliseRow);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Maps a PipelineStageRow to the API response shape.
 */
export function toStageResponse(row: PipelineStageRow): PipelineStageResponse {
  return {
    id: row.id,
    pipeline_id: row.pipeline_id,
    name: row.name,
    sort_order: row.sort_order,
    probability: row.probability,
    is_terminal: row.is_terminal,
    is_fixed: row.is_fixed,
    stage_exit_requirements: row.stage_exit_requirements,
  };
}
