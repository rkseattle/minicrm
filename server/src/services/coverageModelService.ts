/**
 * Coverage/TIA version-anchored coverage model & storage service. (MINCRM-616)
 *
 * Owns all DB access for coverage_units and coverage_ingested_dumps (see
 * migration 158) — no coverageDb.query() outside this module, per repo
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
import coverageDb from '../coverageDb.js';
import type { CoverageDumpSource } from '../coverageAgent/sdk/CoverageAgentPlugin.js';
import type { NormalizedCoverageUnit } from '../coverageAgent/pipeline/normalizedCoverageUnit.js';
import type { CoverageUnit } from '@minicrm/shared/schemas/coveragePipelineSchema.js';

const COVERAGE_UNIT_INSERT_COLUMN_COUNT = 9;

// PostgreSQL's wire protocol caps bind parameters per statement at 65535
// (a 16-bit index) — a single multi-row INSERT with more rows than this
// would throw at runtime ("bind message supplies X parameters, but
// prepared statement requires Y"). Real V8 block-level coverage for a
// medium-to-large codebase can produce far more than this many units in
// one dump, so the insert below is chunked rather than assuming it always
// fits in one statement.
const MAX_UNITS_PER_INSERT_BATCH = Math.floor(65535 / COVERAGE_UNIT_INSERT_COLUMN_COUNT);

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
  confidence_score: string;
  last_reconciled_at: Date | null;
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
    // pg returns NUMERIC as a string to avoid float-precision loss; parsed
    // back to a number here since confidence_score's own [0,1] range never
    // needs arbitrary precision, only the Zod schema's number type.
    confidenceScore: Number(row.confidence_score),
    lastReconciledAt: row.last_reconciled_at ? row.last_reconciled_at.toISOString() : null,
  };
}

/** True if the given dumpId has already been normalized into coverage_units. */
export async function isDumpAlreadyIngested(dumpId: string): Promise<boolean> {
  const result = await coverageDb.query<{ dump_id: string }>(
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
/**
 * Collapses units sharing the same (file_path, unit_key, branch_id)
 * identity within a single batch by summing hit counts and keeping the
 * last-seen resolved/unresolvedReason, keyed on the same
 * COALESCE(branch_id, '') identity the DB's own unique index uses.
 *
 * Required because a single dump can legitimately symbolicate more than
 * one NormalizedCoverageUnit row for the same identity (e.g. the same
 * function reached via more than one V8 script, or repeated branch
 * entries) — PostgreSQL's ON CONFLICT DO UPDATE rejects a multi-row INSERT
 * that would update the same conflict-target row twice within a single
 * statement ("ON CONFLICT DO UPDATE command cannot affect row a second
 * time"), a real, previously-latent bug this pre-aggregation closes
 * (found via coverageMappingService's own equivalent fix — see that
 * module's collapseDuplicateIdentities docblock for the full mechanism).
 */
function collapseDuplicateIdentities(
  units: readonly NormalizedCoverageUnit[],
): NormalizedCoverageUnit[] {
  const byIdentity = new Map<string, NormalizedCoverageUnit>();
  for (const unit of units) {
    // JSON-encoded array, not a delimited string — see
    // coverageMappingService's collapseDuplicateIdentities for why a plain
    // space-joined key lets two distinct tuples collide (found via Greptile
    // PR review).
    const identityKey = JSON.stringify([unit.filePath, unit.unitKey, unit.branchId ?? '']);
    const existing = byIdentity.get(identityKey);
    if (existing) {
      existing.hitCount += unit.hitCount;
      existing.resolved = unit.resolved;
      existing.unresolvedReason = unit.unresolvedReason;
    } else {
      byIdentity.set(identityKey, { ...unit });
    }
  }
  return Array.from(byIdentity.values());
}

/**
 * Inserts one batch of units (already sized to fit under the
 * bind-parameter ceiling by the caller) as a single multi-row
 * INSERT ... ON CONFLICT DO UPDATE.
 */
async function insertCoverageUnitBatch(
  client: PoolClient,
  commitSha: string,
  agent: CoverageDumpSource,
  unitsInput: readonly NormalizedCoverageUnit[],
): Promise<void> {
  if (unitsInput.length === 0) return;
  const units = collapseDuplicateIdentities(unitsInput);

  const values: unknown[] = [];
  const rowPlaceholders = units.map((unit, index) => {
    const base = index * COVERAGE_UNIT_INSERT_COLUMN_COUNT;
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

export async function upsertCoverageUnits(
  dumpId: string,
  commitSha: string,
  agent: CoverageDumpSource,
  units: readonly NormalizedCoverageUnit[],
  // Invoked with the SAME transaction client, after the coverage_units
  // writes but before COMMIT — lets a caller (coverageIngestionService,
  // MINCRM-618) attribute this dump's units to a test in
  // coverage_test_links atomically alongside the coverage_units upsert,
  // without this module needing to know anything about test attribution
  // itself. Never invoked when the claim above finds the dump already
  // ingested (alreadyIngested=true) — a repeat call must stay a true no-op,
  // including for whatever side effect this callback performs.
  onUnitsUpserted?: (client: PoolClient) => Promise<void>,
): Promise<{ alreadyIngested: boolean; unitCount: number; unresolvedCount: number }> {
  const client: PoolClient = await coverageDb.connect();
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

    // Batched as multi-row INSERTs rather than one round-trip per unit — a
    // real dump can carry thousands of units, and looping individual
    // client.query() calls inside a held transaction would serialize that
    // many network round-trips against a single connection. Chunked to
    // MAX_UNITS_PER_INSERT_BATCH rows per statement so no single INSERT
    // exceeds PostgreSQL's 65535 bind-parameter ceiling (see that
    // constant's docblock).
    for (let start = 0; start < units.length; start += MAX_UNITS_PER_INSERT_BATCH) {
      const batch = units.slice(start, start + MAX_UNITS_PER_INSERT_BATCH);
      await insertCoverageUnitBatch(client, commitSha, agent, batch);
    }

    if (onUnitsUpserted) {
      await onUnitsUpserted(client);
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

const COVERAGE_UNIT_SELECT_COLUMNS =
  'id, commit_sha, file_path, unit_key, branch_id, granularity, agent, hit_count, resolved, unresolved_reason, first_seen_at, last_seen_at, confidence_score, last_reconciled_at';

/** Lists coverage_units rows for a given commit SHA, for tests/debugging and future reporting consumers. */
export async function findCoverageUnitsByCommitSha(commitSha: string): Promise<CoverageUnit[]> {
  const result = await coverageDb.query<CoverageUnitRow>(
    `SELECT ${COVERAGE_UNIT_SELECT_COLUMNS}
     FROM coverage_units WHERE commit_sha = $1
     ORDER BY file_path, unit_key, branch_id`,
    [commitSha],
  );
  return result.rows.map(toCoverageUnit);
}

/**
 * Deletes a single coverage_units row by ID — used by
 * coverageReconciliationService to prune units whose code no longer exists
 * in the current source tree (MINCRM-620's "units absent from the source
 * tree are pruned" AC). Unlike pruneCoverageUnits (retention-window based),
 * this targets a specific row already identified as dead by reconciliation.
 */
export async function deleteCoverageUnitById(id: string): Promise<void> {
  await coverageDb.query('DELETE FROM coverage_units WHERE id = $1', [id]);
}

/**
 * Updates a unit's file_path and/or unit_key in place — used by
 * coverageReconciliationService to carry a mapping forward when
 * reconciliation determines the underlying code moved/renamed (MINCRM-620's
 * "renames carried over via body-hash / VCS signals rather than dropped"
 * AC / MINCRM-619's rename-carry requirement). Carrying a mapping forward
 * this way (UPDATE in place) rather than delete-old + insert-new preserves
 * the row's accumulated hit_count, first_seen_at, and confidence_score
 * history across the rename — exactly the continuity a rename-carry is
 * meant to provide.
 *
 * Handles the rare case where the destination identity
 * (commit_sha, newFilePath, newUnitKey, branch_id) already has its OWN
 * coverage_units row (e.g. the rename target was already ingested
 * separately under the same commit, perhaps from a file merge) — a plain
 * UPDATE would violate coverage_units_identity_idx in that case. Instead:
 * merge the moving row's hit_count into the existing destination row (same
 * accumulate-don't-duplicate semantics as insertCoverageUnitBatch's own
 * ON CONFLICT), then delete the row being relocated, so no history is lost
 * and no unique-constraint error surfaces to the caller.
 */
/**
 * @returns The id of the row that survives the relocation — the original
 *   `id` in the common case, or the pre-existing destination row's id when
 *   a merge occurred. Callers that need to act on the unit again afterward
 *   (e.g. coverageReconciliationService scoring confidence next) MUST use
 *   this returned id, not the original `id` parameter — in the merge case
 *   the original row no longer exists, and continuing to reference it would
 *   silently no-op (an UPDATE ... WHERE id = <deleted-id> matches zero rows
 *   without erroring).
 */
export async function relocateCoverageUnit(
  id: string,
  newFilePath: string,
  newUnitKey: string,
): Promise<string> {
  const client = await coverageDb.connect();
  try {
    await client.query('BEGIN');

    const moving = await client.query<{
      commit_sha: string;
      branch_id: string | null;
      hit_count: number;
    }>('SELECT commit_sha, branch_id, hit_count FROM coverage_units WHERE id = $1', [id]);
    if (moving.rowCount === 0) {
      await client.query('COMMIT');
      return id;
    }
    const { commit_sha: commitSha, branch_id: branchId, hit_count: hitCount } = moving.rows[0];

    const destination = await client.query<{ id: string }>(
      `SELECT id FROM coverage_units
       WHERE commit_sha = $1 AND file_path = $2 AND unit_key = $3 AND COALESCE(branch_id, '') = COALESCE($4, '')
         AND id <> $5`,
      [commitSha, newFilePath, newUnitKey, branchId, id],
    );

    let survivingId = id;
    if (destination.rowCount && destination.rowCount > 0) {
      survivingId = destination.rows[0].id;
      await client.query(
        `UPDATE coverage_units
         SET hit_count = hit_count + $2, last_seen_at = now()
         WHERE id = $1`,
        [survivingId, hitCount],
      );
      await client.query('DELETE FROM coverage_units WHERE id = $1', [id]);
    } else {
      await client.query('UPDATE coverage_units SET file_path = $2, unit_key = $3 WHERE id = $1', [
        id,
        newFilePath,
        newUnitKey,
      ]);
    }

    await client.query('COMMIT');
    return survivingId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Sets a unit's confidence_score and stamps last_reconciled_at = now() —
 * the write coverageReconciliationService performs after computing a
 * fresh recency-decayed score for a row it has just validated against the
 * current symbol table (MINCRM-620's "each mapping carries a recency/
 * confidence score" AC).
 */
export async function updateCoverageUnitConfidence(
  id: string,
  confidenceScore: number,
): Promise<void> {
  await coverageDb.query(
    'UPDATE coverage_units SET confidence_score = $2, last_reconciled_at = now() WHERE id = $1',
    [id, confidenceScore],
  );
}

/** Result of a retention prune: rows removed from each table. */
export interface PruneCoverageUnitsResult {
  /** coverage_units rows deleted for being older than the retention window. */
  prunedUnitCount: number;
  /**
   * coverage_test_links rows deleted because they were both outside the
   * SAME retention window as the coverage_units prune above AND had no
   * matching coverage_units row at the time. coverage_test_links has no FK
   * to coverage_units (cross-database FKs are impossible in PostgreSQL, and
   * both tables live in the same coverage database but were never given
   * one) — pruning coverage_units alone would eventually leave these
   * orphaned, which silently weakens the safety net: MAPPING_RESULT_SELECT's
   * LEFT JOIN would then return confidence_score: null for an orphaned
   * link, and safetyNetPolicy.hasLowConfidenceMatch treats null as "no
   * signal to check" (`confidenceScore !== null && confidenceScore <
   * threshold`) rather than "below threshold" — the exact full-suite
   * fallback retention pruning must not weaken (MINCRM-637).
   *
   * The retention-window predicate on l.last_seen_at is required, not just
   * defensive: loadCoverageTestLinksForCommit (coverageMappingService.ts)
   * writes coverage_test_links rows from a committed qa/coverage-map.json
   * with NO corresponding coverage_units rows at all — that map load is the
   * normal way select-tests.ts gets a coverage index in CI and via
   * pre-push-tia.ts locally. Without the time bound, a plain NOT EXISTS
   * would delete that entire freshly-loaded map on the very next scheduled
   * prune tick, degrading TIA to full-suite-forever with no error (found
   * via Greptile branch review).
   *
   * This does NOT mean a persistent deployment's map goes stale between
   * loads and gets silently pruned out from under an active selection run
   * (a concern raised in a later branch-review round) — verified against
   * both real invocation paths:
   *   - ci.yml's tia-selection job gets a fresh, empty coverageDb every run
   *     (see load-coverage-map.ts's own docblock), so pruning never
   *     observes stale rows there at all.
   *   - pre-push-tia.ts unconditionally re-runs load-coverage-map.ts for
   *     baseRef's tip SHA immediately before every local select-tests.ts
   *     invocation (see pre-push-tia.ts's runLoadCoverageMap/runSelectTests
   *     call order) — loadCoverageTestLinksForCommit's ON CONFLICT ... DO
   *     UPDATE SET last_seen_at = now() means the SHA actually being
   *     queried is always refreshed to "just now" immediately before every
   *     query, never more than seconds stale.
   * A coverage_test_links row can only ever fall outside the retention
   * window for a commit_sha that is no longer being loaded/queried at
   * all — main's tip has moved on and old PR base SHAs are no longer
   * relevant — which is exactly the retention behavior this policy exists
   * to provide, not a gap.
   */
  prunedLinkCount: number;
}

/**
 * Prunes coverage_units rows not touched in more than `retentionDays` days
 * (MINCRM-616's configurable retention policy), then deletes
 * coverage_test_links rows that are BOTH outside that same retention
 * window AND left orphaned by that prune, in the same transaction.
 * Scheduled daily via coverageRetentionScheduler.ts (MINCRM-637); also
 * callable on demand by an operator.
 */
export async function pruneCoverageUnits(retentionDays: number): Promise<PruneCoverageUnitsResult> {
  const client: PoolClient = await coverageDb.connect();
  try {
    await client.query('BEGIN');

    const prunedUnits = await client.query(
      // Multiplying an interval literal by the parameter (rather than
      // string concatenation into an ::interval cast) lets PostgreSQL
      // handle the numeric coercion directly — no risk of producing an
      // invalid interval string for an unexpected input.
      `DELETE FROM coverage_units WHERE last_seen_at < now() - ($1 * interval '1 day')`,
      [retentionDays],
    );

    // COALESCE(branch_id, '') matches coverage_units_identity_idx and
    // coverage_test_links_identity_idx's own dedup convention — NULL <>
    // NULL in SQL, so a plain equality would never match two NULL
    // branch_id rows for the same otherwise-identical identity.
    //
    // l.last_seen_at < the SAME retention cutoff as the coverage_units
    // delete above is required so a link row loaded moments ago by
    // loadCoverageTestLinksForCommit — which intentionally writes no
    // coverage_units row at all — is never in scope just because its unit
    // row doesn't exist. Only a link that is itself stale AND unmatched is
    // a genuine orphan of this prune.
    const prunedLinks = await client.query(
      `DELETE FROM coverage_test_links l
       WHERE l.last_seen_at < now() - ($1 * interval '1 day')
         AND NOT EXISTS (
           SELECT 1 FROM coverage_units u
           WHERE u.commit_sha = l.commit_sha
             AND u.file_path = l.file_path
             AND u.unit_key = l.unit_key
             AND COALESCE(u.branch_id, '') = COALESCE(l.branch_id, '')
         )`,
      [retentionDays],
    );

    await client.query('COMMIT');
    return {
      prunedUnitCount: prunedUnits.rowCount ?? 0,
      prunedLinkCount: prunedLinks.rowCount ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
