/**
 * Coverage/TIA per-build rollup.
 *
 * Owns all DB access for coverage_build_summary (see
 * qa/migrations/002_coverage_build_summary.js) — no coverageDb.query()
 * outside this module, per repo convention. Maintained incrementally by
 * coverageIngestionService as an onUnitsUpserted callback, in the SAME
 * transaction as the coverage_units writes it summarizes, so this table can
 * never drift out of sync with coverage_units.
 *
 * Not wrapped in the audit-log + AuditActor pattern — like coverage_units
 * itself (see coverageModelService.ts's own docblock), this is derived,
 * system-internal telemetry with no owning user and no user-facing
 * mutation surface.
 */

import type { PoolClient } from 'pg';
import coverageDb from '../coverageDb.js';

export interface CoverageBuildSummary {
  commitSha: string;
  apiUnitCount: number;
  apiCoveredUnitCount: number;
  frontendUnitCount: number;
  frontendCoveredUnitCount: number;
  automatedCoveredUnitCount: number;
  manualCoveredUnitCount: number;
  firstIngestedAt: string;
  lastUpdatedAt: string;
}

interface CoverageBuildSummaryRow {
  commit_sha: string;
  api_unit_count: number;
  api_covered_unit_count: number;
  frontend_unit_count: number;
  frontend_covered_unit_count: number;
  automated_covered_unit_count: number;
  manual_covered_unit_count: number;
  first_ingested_at: Date;
  last_updated_at: Date;
}

function toCoverageBuildSummary(row: CoverageBuildSummaryRow): CoverageBuildSummary {
  return {
    commitSha: row.commit_sha,
    apiUnitCount: row.api_unit_count,
    apiCoveredUnitCount: row.api_covered_unit_count,
    frontendUnitCount: row.frontend_unit_count,
    frontendCoveredUnitCount: row.frontend_covered_unit_count,
    automatedCoveredUnitCount: row.automated_covered_unit_count,
    manualCoveredUnitCount: row.manual_covered_unit_count,
    firstIngestedAt: row.first_ingested_at.toISOString(),
    lastUpdatedAt: row.last_updated_at.toISOString(),
  };
}

/**
 * Re-derives and upserts the full coverage_build_summary row for one
 * commit_sha by aggregating coverage_units directly — NOT an incremental
 * add-the-new-dump's-counts operation. Recomputing from the full
 * coverage_units state for this commit on every call is idempotent under
 * re-ingestion (a repeat dump for an already-ingested commit is a no-op at
 * the coverage_units layer too, per upsertCoverageUnits' claim-then-write
 * guard) and avoids the double-counting a true increment would risk if
 * this callback ever ran more than once for the same unit change.
 *
 * automatedCoveredUnitCount/manualCoveredUnitCount come from a join against
 * coverage_test_links (for per-test attribution) -> coverage_session_dumps
 * (dump -> session) -> coverage_sessions (session.source), NOT from
 * coverage_units directly, since coverage_units carries no test/session
 * attribution of its own (see coverage_test_links' own docblock in
 * 001_coverage_baseline.js). A unit hit by both an automated and a manual
 * session at this commit counts toward BOTH counters — this is a
 * coverage-BY-test-type breakdown,
 * not a mutually-exclusive partition of units.
 *
 * Must be invoked with the SAME transaction client the caller (
 * coverageIngestionService) is already holding, so this write commits
 * atomically with the coverage_units upsert it summarizes.
 */
export async function upsertBuildSummaryForCommit(
  client: PoolClient,
  commitSha: string,
): Promise<void> {
  const unitCounts = await client.query<{
    api_unit_count: string;
    api_covered_unit_count: string;
    frontend_unit_count: string;
    frontend_covered_unit_count: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE agent = 'node-v8') AS api_unit_count,
       COUNT(*) FILTER (WHERE agent = 'node-v8' AND hit_count > 0) AS api_covered_unit_count,
       COUNT(*) FILTER (WHERE agent = 'browser-istanbul') AS frontend_unit_count,
       COUNT(*) FILTER (WHERE agent = 'browser-istanbul' AND hit_count > 0) AS frontend_covered_unit_count
     FROM coverage_units
     WHERE commit_sha = $1`,
    [commitSha],
  );

  const testTypeCounts = await client.query<{
    automated_covered_unit_count: string;
    manual_covered_unit_count: string;
  }>(
    `SELECT
       COUNT(DISTINCT (l.file_path, l.unit_key, COALESCE(l.branch_id, ''))) FILTER (
         WHERE s.source = 'automated-e2e'
       ) AS automated_covered_unit_count,
       COUNT(DISTINCT (l.file_path, l.unit_key, COALESCE(l.branch_id, ''))) FILTER (
         WHERE s.source = 'manual'
       ) AS manual_covered_unit_count
     FROM coverage_test_links l
     JOIN coverage_session_dumps d ON d.test_id = l.test_id
     JOIN coverage_sessions s ON s.id = d.session_id
     WHERE l.commit_sha = $1 AND l.hit_count > 0`,
    [commitSha],
  );

  const counts = unitCounts.rows[0];
  const testTypes = testTypeCounts.rows[0];

  await client.query(
    `INSERT INTO coverage_build_summary
       (commit_sha, api_unit_count, api_covered_unit_count, frontend_unit_count,
        frontend_covered_unit_count, automated_covered_unit_count, manual_covered_unit_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (commit_sha)
     DO UPDATE SET
       api_unit_count = EXCLUDED.api_unit_count,
       api_covered_unit_count = EXCLUDED.api_covered_unit_count,
       frontend_unit_count = EXCLUDED.frontend_unit_count,
       frontend_covered_unit_count = EXCLUDED.frontend_covered_unit_count,
       automated_covered_unit_count = EXCLUDED.automated_covered_unit_count,
       manual_covered_unit_count = EXCLUDED.manual_covered_unit_count,
       last_updated_at = now()`,
    [
      commitSha,
      counts.api_unit_count,
      counts.api_covered_unit_count,
      counts.frontend_unit_count,
      counts.frontend_covered_unit_count,
      testTypes.automated_covered_unit_count,
      testTypes.manual_covered_unit_count,
    ],
  );
}

/** Finds the build summary for a single commit, or null if never ingested. */
export async function findBuildSummaryByCommitSha(
  commitSha: string,
): Promise<CoverageBuildSummary | null> {
  const result = await coverageDb.query<CoverageBuildSummaryRow>(
    `SELECT commit_sha, api_unit_count, api_covered_unit_count, frontend_unit_count,
            frontend_covered_unit_count, automated_covered_unit_count, manual_covered_unit_count,
            first_ingested_at, last_updated_at
     FROM coverage_build_summary
     WHERE commit_sha = $1`,
    [commitSha],
  );
  return result.rows.length > 0 ? toCoverageBuildSummary(result.rows[0]) : null;
}

const TREND_RESULT_LIMIT_MAX = 500;

/**
 * Finds build summaries ordered by ingestion recency, most recent first,
 * for the trend-over-time view. `limit` is clamped to
 * TREND_RESULT_LIMIT_MAX to bound response size — a dashboard trend chart
 * has no legitimate reason to plot more points than that in one request.
 */
export async function findRecentBuildSummaries(limit: number): Promise<CoverageBuildSummary[]> {
  const clampedLimit = Math.min(Math.max(limit, 1), TREND_RESULT_LIMIT_MAX);
  const result = await coverageDb.query<CoverageBuildSummaryRow>(
    `SELECT commit_sha, api_unit_count, api_covered_unit_count, frontend_unit_count,
            frontend_covered_unit_count, automated_covered_unit_count, manual_covered_unit_count,
            first_ingested_at, last_updated_at
     FROM coverage_build_summary
     ORDER BY first_ingested_at DESC
     LIMIT $1`,
    [clampedLimit],
  );
  return result.rows.map(toCoverageBuildSummary);
}
