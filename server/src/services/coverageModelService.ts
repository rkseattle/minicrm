/**
 * Coverage/TIA version-anchored coverage model & storage service. (MINCRM-616)
 *
 * Owns all DB access for coverage_units and coverage_ingested_dumps (see
 * migration 158) — no pool.query() outside this module, per repo
 * convention. Populated by coverageIngestionService after
 * coverageSymbolicationService has resolved a raw dump into
 * NormalizedCoverageUnit rows; this module's job is purely the storage
 * model: upsert/merge, dedup, and retention.
 *
 * Not wrapped in the audit-log + AuditActor pattern used elsewhere in the
 * codebase (see dealService.ts) — coverage_units is derived, system-internal
 * telemetry with no owning user and no user-facing mutation surface,
 * mirroring how coverageSessionService.recordCoverageSessionDump is
 * likewise unaudited high-frequency data.
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import type { CoverageDumpSource } from '../coverageAgent/CoverageAgent.js';
import type { NormalizedCoverageUnit } from '../coverageAgent/pipeline/normalizedCoverageUnit.js';
import type { CoverageUnit } from '@minicrm/shared/schemas/coveragePipelineSchema.js';

interface CoverageUnitRow {
  id: string;
  commit_sha: string;
  file_path: string;
  unit_key: string;
  branch_id: string | null;
  granularity: 'branch' | 'function';
  agent: CoverageDumpSource;
  hit_count: number;
  resolved: boolean;
  unresolved_reason: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
}

function toCoverageUnit(row: CoverageUnitRow): CoverageUnit {
  return {
    id: row.id,
    commitSha: row.commit_sha,
    filePath: row.file_path,
    unitKey: row.unit_key,
    branchId: row.branch_id,
    granularity: row.granularity,
    agent: row.agent,
    hitCount: row.hit_count,
    resolved: row.resolved,
    unresolvedReason: row.unresolved_reason,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}

/** True if the given dumpId has already been normalized into coverage_units. */
export async function isDumpAlreadyIngested(dumpId: string): Promise<boolean> {
  const result = await pool.query<{ dump_id: string }>(
    'SELECT dump_id FROM coverage_ingested_dumps WHERE dump_id = $1',
    [dumpId],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Merges a set of normalized units for one dump into coverage_units and
 * records the dump as ingested, in a single transaction. Idempotent AND
 * race-safe on its own — safe to call concurrently for the same dumpId with
 * no caller-side guard required.
 *
 * Race safety: coverage_ingested_dumps is claimed FIRST via
 * `INSERT ... ON CONFLICT (dump_id) DO NOTHING RETURNING dump_id`, inside
 * the same transaction that applies the coverage_units upserts below it.
 * If the RETURNING clause yields no row, a concurrent call already claimed
 * this dumpId (or a prior call already completed it) — this call skips the
 * coverage_units writes entirely and returns immediately, rather than
 * racing another in-flight upsert loop and double-counting hit_count. A
 * caller-side "check isDumpAlreadyIngested, then separately call this
 * function" pattern would have a TOCTOU gap between the two round-trips;
 * doing the claim and the writes in one transaction closes it.
 *
 * Dedup/compaction (MINCRM-616): each unit's identity is
 * (commit_sha, file_path, unit_key, branch_id) — see the
 * coverage_units_identity_idx unique index in migration 158. A conflicting
 * insert merges by accumulating hit_count and advancing last_seen_at,
 * rather than inserting a duplicate row, so repeated ingestion of the same
 * commit's coverage compacts instead of growing unboundedly.
 */
export async function upsertCoverageUnits(
  dumpId: string,
  commitSha: string,
  agent: CoverageDumpSource,
  units: readonly NormalizedCoverageUnit[],
): Promise<{ alreadyIngested: boolean; unitCount: number; unresolvedCount: number }> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const claim = await client.query<{ dump_id: string }>(
      `INSERT INTO coverage_ingested_dumps (dump_id, commit_sha, unit_count)
       VALUES ($1, $2, $3)
       ON CONFLICT (dump_id) DO NOTHING
       RETURNING dump_id`,
      [dumpId, commitSha, units.length],
    );

    if (claim.rowCount === 0) {
      await client.query('COMMIT');
      return { alreadyIngested: true, unitCount: 0, unresolvedCount: 0 };
    }

    // Batched as one multi-row INSERT rather than one round-trip per unit —
    // a real dump can carry thousands of units, and looping individual
    // client.query() calls inside a held transaction would serialize that
    // many network round-trips against a single connection.
    if (units.length > 0) {
      const values: unknown[] = [];
      const rowPlaceholders = units.map((unit, index) => {
        const base = index * 9;
        values.push(
          commitSha,
          unit.filePath,
          unit.unitKey,
          unit.branchId,
          unit.granularity,
          agent,
          unit.hitCount,
          unit.resolved,
          unit.unresolvedReason,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
      });

      await client.query(
        `INSERT INTO coverage_units
           (commit_sha, file_path, unit_key, branch_id, granularity, agent, hit_count, resolved, unresolved_reason)
         VALUES ${rowPlaceholders.join(', ')}
         ON CONFLICT (commit_sha, file_path, unit_key, COALESCE(branch_id, ''))
         DO UPDATE SET
           hit_count = coverage_units.hit_count + EXCLUDED.hit_count,
           resolved = EXCLUDED.resolved,
           unresolved_reason = EXCLUDED.unresolved_reason,
           last_seen_at = now()`,
        values,
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const unresolvedCount = units.filter((unit) => !unit.resolved).length;
  return { alreadyIngested: false, unitCount: units.length, unresolvedCount };
}

/** Lists coverage_units rows for a given commit SHA, for tests/debugging and future reporting consumers. */
export async function findCoverageUnitsByCommitSha(commitSha: string): Promise<CoverageUnit[]> {
  const result = await pool.query<CoverageUnitRow>(
    `SELECT id, commit_sha, file_path, unit_key, branch_id, granularity, agent, hit_count, resolved, unresolved_reason, first_seen_at, last_seen_at
     FROM coverage_units WHERE commit_sha = $1
     ORDER BY file_path, unit_key, branch_id`,
    [commitSha],
  );
  return result.rows.map(toCoverageUnit);
}

/**
 * Prunes coverage_units rows not touched in more than `retentionDays` days
 * (MINCRM-616's configurable retention policy). Not scheduled by this
 * module — callable on demand (e.g. from a future CI/CD job, pr-tia-7) or
 * directly by an operator; wiring an automatic schedule is out of this
 * epic's scope (Coverage Data Pipeline & Storage) and belongs to the CI/CD
 * Integration epic (MINCRM-632).
 */
export async function pruneCoverageUnits(retentionDays: number): Promise<number> {
  const result = await pool.query(
    `DELETE FROM coverage_units WHERE last_seen_at < now() - ($1 || ' days')::interval`,
    [retentionDays],
  );
  return result.rowCount ?? 0;
}
