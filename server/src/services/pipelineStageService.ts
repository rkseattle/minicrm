/**
 * Pipeline stage service — business logic for pipeline stage configuration (MINCRM-180).
 * All database access for pipeline_stages goes through this module.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CreatePipelineStageInput,
  UpdatePipelineStageInput,
  ReorderPipelineStagesInput,
  PipelineStageResponse,
} from '@minicrm/shared/schemas/pipelineStageSchema.js';
import { writeAuditEntry, writeAuditEntries, SYSTEM_ACTOR } from './auditService.js';
import type { AuditActor, AuditEntryInput } from './auditService.js';

/** Shape of a pipeline_stages row as stored in the database */
export interface PipelineStageRow {
  id: string;
  name: string;
  sort_order: number;
  probability: number;
  is_terminal: boolean;
  is_fixed: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Columns to SELECT for stage list queries */
const STAGE_SELECT =
  'id, name, sort_order, probability, is_terminal, is_fixed, created_at, updated_at';

/**
 * Returns all pipeline stages ordered by sort_order ascending.
 *
 * @returns Array of stage rows
 */
export async function listPipelineStages(): Promise<PipelineStageRow[]> {
  const result = await pool.query<PipelineStageRow>(
    `SELECT ${STAGE_SELECT} FROM pipeline_stages ORDER BY sort_order ASC`,
  );
  return result.rows;
}

/**
 * Returns just the stage names in pipeline order. Used by the deal controller
 * to validate that a submitted stage value is in the live stage list.
 *
 * @returns Array of stage name strings, ordered by sort_order ASC
 */
export async function getStageNames(): Promise<string[]> {
  const result = await pool.query<{ name: string }>(
    'SELECT name FROM pipeline_stages ORDER BY sort_order ASC',
  );
  return result.rows.map((r) => r.name);
}

/**
 * Returns the terminal stage names (is_terminal = true) in pipeline order.
 * Used by the deal controller to enforce close-date requirements.
 *
 * @returns Array of terminal stage name strings
 */
export async function getTerminalStageNames(): Promise<string[]> {
  const result = await pool.query<{ name: string }>(
    'SELECT name FROM pipeline_stages WHERE is_terminal = true ORDER BY sort_order ASC',
  );
  return result.rows.map((r) => r.name);
}

/**
 * Finds a single pipeline stage by its UUID.
 *
 * @param id - Stage UUID
 * @returns The stage row, or null if not found
 */
export async function findPipelineStageById(id: string): Promise<PipelineStageRow | null> {
  const result = await pool.query<PipelineStageRow>(
    `SELECT ${STAGE_SELECT} FROM pipeline_stages WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Creates a new pipeline stage.
 *
 * sort_order is auto-assigned as MAX(sort_order) + 10, appending after all
 * existing stages. The INSERT and audit entry are written in the same
 * transaction so a failed audit write rolls back the stage creation.
 *
 * Name uniqueness is enforced by the DB unique index (case-insensitive). A 23505
 * violation is caught and re-thrown as STAGE_NAME_CONFLICT.
 *
 * @param params - Stage fields from the validated request (no sort_order)
 * @param actor - User performing the create (for audit log)
 * @returns The inserted stage row
 * @throws Error with code STAGE_NAME_CONFLICT if the name is already in use
 */
export async function createPipelineStage(
  params: CreatePipelineStageInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<PipelineStageRow> {
  const { name, probability } = params;

  // Auto-assign sort_order: append after all existing stages (admin can reorder afterward)
  const maxResult = await pool.query<{ max: number | null }>(
    'SELECT MAX(sort_order) AS max FROM pipeline_stages',
  );
  const sortOrder = (maxResult.rows[0].max ?? 0) + 10;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<PipelineStageRow>(
      `INSERT INTO pipeline_stages (name, sort_order, probability)
       VALUES ($1, $2, $3)
       RETURNING ${STAGE_SELECT}`,
      [name, sortOrder, probability ?? 0],
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
    return stage;
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as NodeJS.ErrnoException).code === '23505') {
      const e = new Error(`A stage named "${name}" already exists`);
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
 * When the name changes, all deals currently in the old stage name are updated to
 * the new name atomically in the same transaction (MINCRM-180: rename is atomic).
 *
 * Fixed stages (is_fixed = true) may not have their name changed.
 *
 * Name and sort_order uniqueness are enforced by DB unique indexes. A 23505
 * violation is caught and re-thrown as STAGE_NAME_CONFLICT or
 * STAGE_SORT_ORDER_CONFLICT depending on which constraint fired.
 *
 * Per-field audit entries are written inside the same transaction.
 *
 * @param id - Stage UUID
 * @param params - Fields to update
 * @param actor - User performing the update (for audit log)
 * @returns The updated stage row, or null if not found
 * @throws Error with code STAGE_FIXED if attempting to rename a fixed stage
 * @throws Error with code STAGE_NAME_CONFLICT if the new name is already in use
 * @throws Error with code STAGE_SORT_ORDER_CONFLICT if the sort_order is already in use
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

    // If renaming, atomically update all deals in the old stage
    if (params.name !== undefined && params.name !== existing.name) {
      await client.query('UPDATE deals SET stage = $1 WHERE stage = $2', [
        params.name,
        existing.name,
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
      if (entries.length > 0) {
        await writeAuditEntries(client, entries);
      }
    }

    await client.query('COMMIT');
    return updated ?? null;
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
      const e = new Error(`A stage named "${params.name}" already exists`);
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
 * - Any deals with a non-terminal stage currently reference this stage name
 *   (open deals must be moved first)
 *
 * The DELETE and audit entry are written in the same transaction.
 *
 * @param id - Stage UUID
 * @param actor - User performing the delete (for audit log)
 * @returns The deleted stage row, or null if not found
 * @throws Error with code STAGE_FIXED if the stage is fixed
 * @throws Error with code STAGE_HAS_OPEN_DEALS if open deals block deletion;
 *   the error has a `dealCount` property with the count
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

  // Count open deals (not in a terminal stage) currently in this stage
  const terminalResult = await pool.query<{ name: string }>(
    'SELECT name FROM pipeline_stages WHERE is_terminal = true',
  );
  const terminalNames = terminalResult.rows.map((r) => r.name);

  const dealCountResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM deals
     WHERE stage = $1
       AND stage NOT IN (${terminalNames.map((_, i) => `$${i + 2}`).join(', ')})`,
    [existing.name, ...terminalNames],
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
    return deleted ?? null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Atomically reorders all pipeline stages by assigning sort_order 1..N in the
 * provided ID order, all within a single transaction (MINCRM-381).
 *
 * All IDs must reference existing stages; if any ID is unknown the transaction
 * is rolled back and an error with code STAGE_NOT_FOUND is thrown.
 *
 * @param params - Ordered array of stage UUIDs
 * @param actor - User performing the reorder (for audit log)
 * @returns Updated stages in the new order
 * @throws Error with code STAGE_NOT_FOUND if any supplied ID does not exist
 */
export async function reorderPipelineStages(
  params: ReorderPipelineStagesInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<PipelineStageRow[]> {
  const { stages: orderedIds } = params;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Temporarily set all sort_orders to large negative values to vacate the
    // unique index slots before writing the final values.
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

    // Assign the final 1-based sort orders and read back the updated rows.
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        'UPDATE pipeline_stages SET sort_order = $1, updated_at = now() WHERE id = $2',
        [i + 1, orderedIds[i]],
      );
    }

    const result = await client.query<PipelineStageRow>(
      `SELECT ${STAGE_SELECT} FROM pipeline_stages ORDER BY sort_order ASC`,
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

    return result.rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Maps a PipelineStageRow to the API response shape.
 *
 * @param row - Database row
 * @returns API-safe stage object
 */
export function toStageResponse(row: PipelineStageRow): PipelineStageResponse {
  return {
    id: row.id,
    name: row.name,
    sort_order: row.sort_order,
    probability: row.probability,
    is_terminal: row.is_terminal,
    is_fixed: row.is_fixed,
  };
}
