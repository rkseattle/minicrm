/**
 * Pipeline stage service — business logic for pipeline stage configuration (MINCRM-180).
 * All database access for pipeline_stages goes through this module.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CreatePipelineStageInput,
  UpdatePipelineStageInput,
  PipelineStageResponse,
} from '@minicrm/shared/schemas/pipelineStageSchema.js';

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
 * Rejects if the name already exists (case-insensitive).
 *
 * @param params - Stage fields from the validated request
 * @returns The inserted stage row
 * @throws Error with code STAGE_NAME_CONFLICT if the name is already in use
 */
export async function createPipelineStage(
  params: CreatePipelineStageInput,
): Promise<PipelineStageRow> {
  const { name, sort_order, probability } = params;

  // Check for name collision (case-insensitive)
  const collision = await pool.query<{ id: string }>(
    'SELECT id FROM pipeline_stages WHERE lower(name) = lower($1) LIMIT 1',
    [name],
  );
  if (collision.rows.length > 0) {
    const err = new Error(`A stage named "${name}" already exists`);
    (err as NodeJS.ErrnoException).code = 'STAGE_NAME_CONFLICT';
    throw err;
  }

  const result = await pool.query<PipelineStageRow>(
    `INSERT INTO pipeline_stages (name, sort_order, probability)
     VALUES ($1, $2, $3)
     RETURNING ${STAGE_SELECT}`,
    [name, sort_order, probability ?? 0],
  );
  return result.rows[0];
}

/**
 * Updates an existing pipeline stage.
 *
 * When the name changes, all deals currently in the old stage name are updated to
 * the new name atomically in the same transaction (MINCRM-180: rename is atomic).
 *
 * Fixed stages (is_fixed = true) may not have their name changed.
 *
 * @param id - Stage UUID
 * @param params - Fields to update
 * @returns The updated stage row, or null if not found
 * @throws Error with code STAGE_FIXED if attempting to rename a fixed stage
 * @throws Error with code STAGE_NAME_CONFLICT if the new name is already in use
 */
export async function updatePipelineStage(
  id: string,
  params: UpdatePipelineStageInput,
): Promise<PipelineStageRow | null> {
  const existing = await findPipelineStageById(id);
  if (!existing) return null;

  if (params.name !== undefined && params.name !== existing.name) {
    if (existing.is_fixed) {
      const err = new Error('Fixed stages cannot be renamed');
      (err as NodeJS.ErrnoException).code = 'STAGE_FIXED';
      throw err;
    }

    // Check for name collision with another stage
    const collision = await pool.query<{ id: string }>(
      'SELECT id FROM pipeline_stages WHERE lower(name) = lower($1) AND id <> $2 LIMIT 1',
      [params.name, id],
    );
    if (collision.rows.length > 0) {
      const err = new Error(`A stage named "${params.name}" already exists`);
      (err as NodeJS.ErrnoException).code = 'STAGE_NAME_CONFLICT';
      throw err;
    }
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

    await client.query('COMMIT');
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
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
 * @param id - Stage UUID
 * @returns The deleted stage row, or null if not found
 * @throws Error with code STAGE_FIXED if the stage is fixed
 * @throws Error with code STAGE_HAS_OPEN_DEALS if open deals block deletion;
 *   the error has a `dealCount` property with the count
 */
export async function deletePipelineStage(id: string): Promise<PipelineStageRow | null> {
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

  const result = await pool.query<PipelineStageRow>(
    `DELETE FROM pipeline_stages WHERE id = $1 RETURNING ${STAGE_SELECT}`,
    [id],
  );
  return result.rows[0] ?? null;
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
