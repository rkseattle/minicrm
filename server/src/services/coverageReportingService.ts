/**
 * Coverage/TIA reporting & gap-analysis query service.
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

/** Overall + per-tier coverage summary for a single build. */
export async function getCoverageSummary(commitSha: string): Promise<CoverageSummary> {
  const summary = await findBuildSummaryByCommitSha(commitSha);
  if (!summary) {
    throw new CoverageBuildNotFoundError(commitSha);
  }
  return toCoverageSummary(summary);
}

/** Coverage summaries for the most recent builds, most recent first. */
export async function getCoverageTrend(limit: number): Promise<CoverageSummary[]> {
  const summaries = await findRecentBuildSummaries(limit);
  return summaries.map(toCoverageSummary);
}

// ── Gap analysis ──────────────────────────────────────────────

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
 * zones", the first AC). resolved=false units (e.g. eval()'d
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
 * findDeadZoneUnits, surfaced separately per the spec's AC to
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
 * selection does (changeUnitResolver —), then reports which of
 * those changed units have NO row in coverage_test_links at headSha
 *. A 'deleted' unit is excluded — there is no code left to test.
 * cwd defaults to process.cwd(), matching testSelectionService's own
 * assumption that the running process's checked-out working tree is
 * headRef's content.
 *
 * baseSha/headSha reach parseGitDiff's assertSafeGitRef guard (rejects any
 * ref starting with '-', preventing git-flag injection) via execFile
 * (array-args, never shell-interpolated, so command injection is not
 * possible regardless). That guard was originally written for CI's own
 * trusted test-selection pipeline; this endpoint is the first path exposing
 * it to live, authenticated-admin-supplied HTTP input rather than a CI
 * runner's own git refs — worth keeping in mind if this endpoint's trust
 * boundary ever changes (e.g. a future non-admin caller).
 *

 * limit is clamped the same way findDeadZoneUnits/findNeverTakenBranches
 * are — the /gaps endpoint's own documented contract ("max units per list")
 * applies to all three lists it returns, and a large base..head range (e.g.
 * a big refactor) can otherwise return an unbounded number of changed units.
 */
export async function findChangedUntestedUnits(
  baseSha: string,
  headSha: string,
  cwd: string = process.cwd(),
  limit: number = DEAD_ZONE_RESULT_LIMIT_MAX,
): Promise<ChangedUntestedUnit[]> {
  const clampedLimit = Math.min(Math.max(limit, 1), DEAD_ZONE_RESULT_LIMIT_MAX);
  const fileDiffs = await parseGitDiff(baseSha, headSha, cwd);
  const { changedUnits } = await resolveChangedUnits(fileDiffs, cwd, baseSha, headSha);

  // Clamped BEFORE building the identity query, not just on the final
  // return — an unbounded diff (e.g. a large refactor) could otherwise
  // generate a bind-parameter list large enough to approach PostgreSQL's
  // 65535 bind-parameter ceiling (same class of concern as
  // coverageModelService's own MAX_UNITS_PER_INSERT_BATCH).
  const testableUnits = changedUnits
    .filter((unit) => unit.changeKind !== 'deleted')
    .slice(0, clampedLimit);
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

// ── Per-issue traceability & TIA value metrics ────────────────

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
  // Scoped by build_sha (coverage_sessions' own name for this identity —
  // NOT commit_sha, that column only exists on coverage_units/
  // coverage_test_links) so this count matches the same single build every
  // other field on this response is scoped to, rather than an issue's
  // entire history across every build it was ever touched on.
  const sessionRows = await coverageDb.query<{ session_count: string }>(
    `SELECT COUNT(*) AS session_count FROM coverage_sessions WHERE issue_key = $1 AND build_sha = $2`,
    [issueKey, commitSha],
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

/**
 * Lists distinct issue keys that have at least one coverage session
 * recorded for a given build — backs the coverage-dashboard app's issue-key
 * picker. Unlike unit-key/test-ID search
 * (coverageModelService.searchUnitKeys / coverageMappingService.searchTestIds),
 * this needs no separate search term: the set of issue keys touched by any
 * one build is small (bounded by how many manual-testing sessions were
 * checked in against it, not by the size of the coverage_units/
 * coverage_test_links tables), so listing all of them for a commit is
 * cheap and a plain dropdown (rather than a typeahead) is the right UI for
 * this one field.
 */
export async function listIssueKeysForCommit(commitSha: string): Promise<string[]> {
  const result = await coverageDb.query<{ issue_key: string }>(
    `SELECT DISTINCT issue_key FROM coverage_sessions
     WHERE build_sha = $1 AND issue_key IS NOT NULL
     ORDER BY issue_key`,
    [commitSha],
  );
  return result.rows.map((row) => row.issue_key);
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
 * selection quality over time. This module does not
 * have access to CI's own test-selection run log (wiring selection output
 * into CI is explicitly out of scope for this epic — see
 * docs/dev/coverage.md's "Deferred to later phases": pr-tia-8,
 *) — so "tests skipped" / "CI time saved" cannot be
 * computed from data available in the coverage database alone yet. This
 * function reports what IS derivable today (per-tier coverage trend across
 * the range) as the value-metrics view's initial, honest scope; a
 * follow-up story in pr-tia-8 that persists CI's own selection decisions
 * can extend this once that data exists.
 *
 * Deliberately does not distinguish "fromSha/toSha unknown" from
 * "a valid range with zero ingested builds" — both return the same
 * zeroed TiaValueMetrics shape (totalBuilds: 0), since the correlated
 * subqueries below resolve to NULL for either case and NULL comparisons
 * short-circuit the range filter to no rows. A caller debugging a typo'd
 * sha sees the same result as a genuinely-empty range; this endpoint
 * favors a simple, always-200 contract over a 404 that would need extra
 * validation queries to distinguish the two cases correctly.
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
