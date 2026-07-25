/**
 * Coverage/TIA reporting & gap-analysis query service. (MINCRM-629/630/631)
 *
 * Read-only aggregate queries over coverage_build_summary, coverage_units,
 * and coverage_test_links, backing the standalone coverage-dashboard app's
 * reporting query API. Owns no writes of its own — coverage_build_summary
 * is maintained by coverageBuildSummaryService as part of ingestion;
 * coverage_units/coverage_test_links are maintained by coverageModelService/
 * coverageMappingService respectively. Only coverageDb.query() calls here,
 * no client.query() inside a held transaction — every function in this
 * module is a pure read.
 */

import coverageDb from '../coverageDb.js';
import {
  findBuildSummaryByCommitSha,
  findRecentBuildSummaries,
} from './coverageBuildSummaryService.js';
import type { CoverageBuildSummary } from './coverageBuildSummaryService.js';
import { parseGitDiff } from '../coverageAgent/testSelection/diffParser.js';
import { resolveChangedUnits } from '../coverageAgent/testSelection/changeUnitResolver.js';

/** Overall + per-tier coverage percentage for a single build. */
export interface CoverageSummary {
  commitSha: string;
  overallUnitCount: number;
  overallCoveredUnitCount: number;
  overallCoveragePercent: number;
  apiUnitCount: number;
  apiCoveredUnitCount: number;
  apiCoveragePercent: number;
  frontendUnitCount: number;
  frontendCoveredUnitCount: number;
  frontendCoveragePercent: number;
  automatedCoveredUnitCount: number;
  manualCoveredUnitCount: number;
  lastUpdatedAt: string;
}

/** Rounds to 2 decimal places; 0/0 is reported as 0, never NaN. */
function toPercent(covered: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((covered / total) * 10_000) / 100;
}

function toCoverageSummary(summary: CoverageBuildSummary): CoverageSummary {
  const overallUnitCount = summary.apiUnitCount + summary.frontendUnitCount;
  const overallCoveredUnitCount = summary.apiCoveredUnitCount + summary.frontendCoveredUnitCount;
  return {
    commitSha: summary.commitSha,
    overallUnitCount,
    overallCoveredUnitCount,
    overallCoveragePercent: toPercent(overallCoveredUnitCount, overallUnitCount),
    apiUnitCount: summary.apiUnitCount,
    apiCoveredUnitCount: summary.apiCoveredUnitCount,
    apiCoveragePercent: toPercent(summary.apiCoveredUnitCount, summary.apiUnitCount),
    frontendUnitCount: summary.frontendUnitCount,
    frontendCoveredUnitCount: summary.frontendCoveredUnitCount,
    frontendCoveragePercent: toPercent(summary.frontendCoveredUnitCount, summary.frontendUnitCount),
    automatedCoveredUnitCount: summary.automatedCoveredUnitCount,
    manualCoveredUnitCount: summary.manualCoveredUnitCount,
    lastUpdatedAt: summary.lastUpdatedAt,
  };
}

/** Raised when the requested commitSha has no coverage_build_summary row (never ingested). */
export class CoverageBuildNotFoundError extends Error {
  readonly code = 'COVERAGE_BUILD_NOT_FOUND';
  constructor(commitSha: string) {
    super(`No coverage build summary found for commit ${commitSha}`);
    this.name = 'CoverageBuildNotFoundError';
  }
}

/** Overall + per-tier coverage summary for a single build (MINCRM-629). */
export async function getCoverageSummary(commitSha: string): Promise<CoverageSummary> {
  const summary = await findBuildSummaryByCommitSha(commitSha);
  if (!summary) {
    throw new CoverageBuildNotFoundError(commitSha);
  }
  return toCoverageSummary(summary);
}

/** Coverage summaries for the most recent builds, most recent first (MINCRM-629's trend view). */
export async function getCoverageTrend(limit: number): Promise<CoverageSummary[]> {
  const summaries = await findRecentBuildSummaries(limit);
  return summaries.map(toCoverageSummary);
}

// ── Gap analysis (MINCRM-630) ──────────────────────────────────────────────

/** A code unit no functional/manual test currently exercises. */
export interface DeadZoneUnit {
  filePath: string;
  unitKey: string;
  branchId: string | null;
  granularity: 'branch' | 'function';
  resolved: boolean;
}

const DEAD_ZONE_RESULT_LIMIT_MAX = 5000;

/**
 * Finds every unit at a commit with hit_count = 0 — code no test of any
 * kind (automated or manual) has ever exercised at this commit ("dead
 * zones", MINCRM-630's first AC). resolved=false units (e.g. eval()'d
 * code, node: builtins) are included with resolved:false rather than
 * filtered out — they are still a real gap, just one the caller may want
 * to visually distinguish since it has no meaningful filePath/unitKey.
 */
export async function findDeadZoneUnits(
  commitSha: string,
  limit: number = DEAD_ZONE_RESULT_LIMIT_MAX,
): Promise<DeadZoneUnit[]> {
  const clampedLimit = Math.min(Math.max(limit, 1), DEAD_ZONE_RESULT_LIMIT_MAX);
  const result = await coverageDb.query<{
    file_path: string;
    unit_key: string;
    branch_id: string | null;
    granularity: 'branch' | 'function';
    resolved: boolean;
  }>(
    `SELECT file_path, unit_key, branch_id, granularity, resolved
     FROM coverage_units
     WHERE commit_sha = $1 AND hit_count = 0
     ORDER BY file_path, unit_key, branch_id
     LIMIT $2`,
    [commitSha, clampedLimit],
  );
  return result.rows.map((row) => ({
    filePath: row.file_path,
    unitKey: row.unit_key,
    branchId: row.branch_id,
    granularity: row.granularity,
    resolved: row.resolved,
  }));
}

/**
 * Branch-granularity units with hit_count = 0 specifically — a subset of
 * findDeadZoneUnits, surfaced separately per MINCRM-630's AC to
 * "distinguish never-taken branches (data-dependent paths needing new test
 * data)" from function-level dead zones, which usually mean "nothing calls
 * this at all" rather than "this IS called, but one of its branches never
 * is."
 */
export async function findNeverTakenBranches(
  commitSha: string,
  limit: number = DEAD_ZONE_RESULT_LIMIT_MAX,
): Promise<DeadZoneUnit[]> {
  const clampedLimit = Math.min(Math.max(limit, 1), DEAD_ZONE_RESULT_LIMIT_MAX);
  const result = await coverageDb.query<{
    file_path: string;
    unit_key: string;
    branch_id: string | null;
    granularity: 'branch' | 'function';
    resolved: boolean;
  }>(
    `SELECT file_path, unit_key, branch_id, granularity, resolved
     FROM coverage_units
     WHERE commit_sha = $1 AND hit_count = 0 AND granularity = 'branch'
     ORDER BY file_path, unit_key, branch_id
     LIMIT $2`,
    [commitSha, clampedLimit],
  );
  return result.rows.map((row) => ({
    filePath: row.file_path,
    unitKey: row.unit_key,
    branchId: row.branch_id,
    granularity: row.granularity,
    resolved: row.resolved,
  }));
}

/** A changed unit (base..head) with no covering test at headSha. */
export interface ChangedUntestedUnit {
  filePath: string;
  unitKey: string;
  changeKind: 'new' | 'deleted' | 'in-line' | 'refactor' | 'ambiguous';
}

/**
 * Diffs baseSha..headSha, resolves the changed units the same way test
 * selection does (changeUnitResolver — MINCRM-623), then reports which of
 * those changed units have NO row in coverage_test_links at headSha
 * (MINCRM-630's "changed-but-untested code for a given baseline..head
 * range" AC). A 'deleted' unit is excluded — there is no code left to test.
 * cwd defaults to process.cwd(), matching testSelectionService's own
 * assumption that the running process's checked-out working tree is
 * headRef's content.
 */
export async function findChangedUntestedUnits(
  baseSha: string,
  headSha: string,
  cwd: string = process.cwd(),
): Promise<ChangedUntestedUnit[]> {
  const fileDiffs = await parseGitDiff(baseSha, headSha, cwd);
  const { changedUnits } = await resolveChangedUnits(fileDiffs, cwd, baseSha, headSha);

  const testableUnits = changedUnits.filter((unit) => unit.changeKind !== 'deleted');
  if (testableUnits.length === 0) return [];

  const identityValues: unknown[] = [headSha];
  const identityPlaceholders = testableUnits.map((unit, index) => {
    const base = index * 2;
    identityValues.push(unit.filePath, unit.unitKey);
    return `($${base + 2}, $${base + 3})`;
  });

  const result = await coverageDb.query<{ file_path: string; unit_key: string }>(
    `SELECT DISTINCT file_path, unit_key
     FROM coverage_test_links
     WHERE commit_sha = $1 AND (file_path, unit_key) IN (${identityPlaceholders.join(', ')})`,
    identityValues,
  );
  const testedIdentities = new Set(result.rows.map((row) => `${row.file_path}::${row.unit_key}`));

  return testableUnits
    .filter((unit) => !testedIdentities.has(`${unit.filePath}::${unit.unitKey}`))
    .map((unit) => ({
      filePath: unit.filePath,
      unitKey: unit.unitKey,
      changeKind: unit.changeKind,
    }));
}

// ── Per-issue traceability & TIA value metrics (MINCRM-631) ────────────────

/** Coverage rollup for a single MiniCRM issue key. */
export interface IssueCoverage {
  issueKey: string;
  sessionCount: number;
  coveredUnitCount: number;
  testIds: string[];
}

/**
 * Maps coverage back to a MiniCRM issue key via
 * coverage_sessions.issue_key (stamped at session check-in time) ->
 * coverage_session_dumps (dump/test attribution) -> coverage_test_links
 * (the units that test's dumps actually hit) — the traceability join
 * chain flagged as needed in docs/dev/coverage.md (issue_key exists only
 * on coverage_sessions today, not on coverage_units/coverage_test_links
 * directly). Scoped to a single commitSha, matching every other query in
 * this module and the mapping API's own scoping convention — an issue's
 * coverage is only meaningful relative to a specific build.
 */
export async function getIssueCoverage(
  issueKey: string,
  commitSha: string,
): Promise<IssueCoverage> {
  const sessionRows = await coverageDb.query<{ session_count: string }>(
    `SELECT COUNT(*) AS session_count FROM coverage_sessions WHERE issue_key = $1`,
    [issueKey],
  );

  const linkRows = await coverageDb.query<{ test_id: string; unit_key: string; file_path: string }>(
    `SELECT DISTINCT l.test_id, l.unit_key, l.file_path
     FROM coverage_test_links l
     JOIN coverage_session_dumps d ON d.test_id = l.test_id
     JOIN coverage_sessions s ON s.id = d.session_id
     WHERE s.issue_key = $1 AND l.commit_sha = $2 AND l.hit_count > 0`,
    [issueKey, commitSha],
  );

  const distinctUnits = new Set(linkRows.rows.map((row) => `${row.file_path}::${row.unit_key}`));
  const distinctTestIds = Array.from(new Set(linkRows.rows.map((row) => row.test_id))).sort();

  return {
    issueKey,
    sessionCount: Number(sessionRows.rows[0].session_count),
    coveredUnitCount: distinctUnits.size,
    testIds: distinctTestIds,
  };
}

/** TIA selection value metrics over a commit range. */
export interface TiaValueMetrics {
  fromSha: string;
  toSha: string;
  totalBuilds: number;
  averageApiCoveragePercent: number;
  averageFrontendCoveragePercent: number;
}

/**
 * Reports coverage trend stats across a build range as a proxy for TIA
 * selection quality over time (MINCRM-631's "report misses caught by the
 * safety net" / "selection quality over time" AC). This module does not
 * have access to CI's own test-selection run log (wiring selection output
 * into CI is explicitly out of scope for this epic — see
 * docs/dev/coverage.md's "Deferred to later phases": pr-tia-8,
 * MINCRM-633/634/660) — so "tests skipped" / "CI time saved" cannot be
 * computed from data available in the coverage database alone yet. This
 * function reports what IS derivable today (per-tier coverage trend across
 * the range) as the value-metrics view's initial, honest scope; a
 * follow-up story in pr-tia-8 that persists CI's own selection decisions
 * can extend this once that data exists.
 */
export async function getTiaValueMetrics(fromSha: string, toSha: string): Promise<TiaValueMetrics> {
  const result = await coverageDb.query<{
    commit_sha: string;
    api_unit_count: number;
    api_covered_unit_count: number;
    frontend_unit_count: number;
    frontend_covered_unit_count: number;
  }>(
    `SELECT commit_sha, api_unit_count, api_covered_unit_count, frontend_unit_count, frontend_covered_unit_count
     FROM coverage_build_summary
     WHERE first_ingested_at >= (
       SELECT first_ingested_at FROM coverage_build_summary WHERE commit_sha = $1
     )
     AND first_ingested_at <= (
       SELECT first_ingested_at FROM coverage_build_summary WHERE commit_sha = $2
     )`,
    [fromSha, toSha],
  );

  const rows = result.rows;
  const totalBuilds = rows.length;
  const averageApiCoveragePercent =
    totalBuilds === 0
      ? 0
      : Math.round(
          (rows.reduce(
            (sum, row) => sum + toPercent(row.api_covered_unit_count, row.api_unit_count),
            0,
          ) /
            totalBuilds) *
            100,
        ) / 100;
  const averageFrontendCoveragePercent =
    totalBuilds === 0
      ? 0
      : Math.round(
          (rows.reduce(
            (sum, row) => sum + toPercent(row.frontend_covered_unit_count, row.frontend_unit_count),
            0,
          ) /
            totalBuilds) *
            100,
        ) / 100;

  return {
    fromSha,
    toSha,
    totalBuilds,
    averageApiCoveragePercent,
    averageFrontendCoveragePercent,
  };
}
