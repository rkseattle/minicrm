/**
 * Coverage/TIA bidirectional code<->test index. (MINCRM-618)
 *
 * Owns all DB access for coverage_test_links (see migration 159) — no
 * coverageDb.query() outside this module, per repo convention. Populated by
 * coverageIngestionService as a side effect of ingesting a dump that has
 * session-level test attribution (a coverage_session_dumps row with a
 * non-null test_id); a dump ingested with no such attribution simply
 * produces no coverage_test_links rows, which is a normal case, not an
 * error.
 *
 * Not wrapped in the audit-log + AuditActor pattern — like coverage_units
 * (see coverageModelService.ts's own docblock), this is derived,
 * system-internal telemetry with no owning user and no user-facing
 * mutation surface.
 */

import type { PoolClient } from 'pg';
import coverageDb from '../coverageDb.js';
import logger from '../logger.js';

const TEST_LINK_INSERT_COLUMN_COUNT = 6;

// Same bind-parameter-ceiling rationale as coverageModelService's own
// MAX_UNITS_PER_INSERT_BATCH — PostgreSQL's wire protocol caps bind
// parameters per statement at 65535.
const MAX_LINKS_PER_INSERT_BATCH = Math.floor(65535 / TEST_LINK_INSERT_COLUMN_COUNT);

// findTestsForUnitsAcrossBranches' own chunk size (MINCRM-637) — NOT a
// bind-parameter-ceiling concern like MAX_LINKS_PER_INSERT_BATCH above
// (a `unit_key = ANY($2)` array is one bind parameter regardless of the
// array's own length). The actual constraint is result-set size: a single
// unit_key can fan out to many coverage_test_links rows (every test that
// ever covered it, across every branch), so the row count returned is not
// proportional to the number of input units alone. Chunking bounds one
// query's result set and round-trip cost for an arbitrarily large diff,
// rather than issuing a single unbounded query for hundreds of changed units.
const MAX_UNITS_PER_MAPPING_LOOKUP_BATCH = 200;

/** One unit's hit attributed to a specific test, for linking at ingestion time. */
export interface CoverageTestLinkInput {
  unitKey: string;
  branchId: string | null;
  filePath: string;
  hitCount: number;
}

export interface CoverageTestLink {
  id: string;
  commitSha: string;
  unitKey: string;
  branchId: string | null;
  filePath: string;
  testId: string;
  testName: string | null;
  testFile: string | null;
  hitCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface CoverageTestLinkRow {
  id: string;
  commit_sha: string;
  unit_key: string;
  branch_id: string | null;
  file_path: string;
  test_id: string;
  test_name: string | null;
  test_file: string | null;
  hit_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
}

function toCoverageTestLink(row: CoverageTestLinkRow): CoverageTestLink {
  return {
    id: row.id,
    commitSha: row.commit_sha,
    unitKey: row.unit_key,
    branchId: row.branch_id,
    filePath: row.file_path,
    testId: row.test_id,
    testName: row.test_name,
    testFile: row.test_file,
    hitCount: row.hit_count,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}

/**
 * Collapses links sharing the same (filePath, unitKey, branchId) identity
 * within a single batch by summing their hit counts, keyed on the SAME
 * (file_path, unit_key, COALESCE(branch_id, '')) identity the DB's own
 * unique index uses.
 *
 * file_path IS part of this identity, not just unitKey/branchId — omitting
 * it (a bug found via Greptile PR review) would let two DIFFERENT files
 * that happen to share the same structural unitKey (e.g. two trivially-
 * identical one-line functions in different files) collapse into one
 * link, silently dropping one file's coverage relationship.
 *
 * Required because a single dump's NormalizedCoverageUnit list can
 * legitimately contain more than one row for the same identity (e.g. a
 * function symbolicated from more than one V8 script, or repeated branch
 * entries) — PostgreSQL's ON CONFLICT DO UPDATE rejects a multi-row INSERT
 * that would update the same conflict-target row twice within one
 * statement ("ON CONFLICT DO UPDATE command cannot affect row a second
 * time"). Pre-aggregating within the batch, rather than only relying on
 * the DB's own dedup across separate calls, avoids that error while
 * preserving the same total hit_count the per-row inserts would have
 * produced.
 */
function collapseDuplicateIdentities(
  links: readonly CoverageTestLinkInput[],
): CoverageTestLinkInput[] {
  const byIdentity = new Map<string, CoverageTestLinkInput>();
  for (const link of links) {
    // JSON-encoded array, not a delimited string: a plain
    // `${filePath} ${unitKey} ${branchId}` join lets two distinct tuples
    // collide whenever a delimiter character is also a field's own content
    // (e.g. filePath "a b" + unitKey "c" serializes identically to filePath
    // "a" + unitKey "b c") — found live via Greptile PR review.
    const identityKey = JSON.stringify([link.filePath, link.unitKey, link.branchId ?? '']);
    const existing = byIdentity.get(identityKey);
    if (existing) {
      existing.hitCount += link.hitCount;
    } else {
      byIdentity.set(identityKey, { ...link });
    }
  }
  return Array.from(byIdentity.values());
}

/**
 * Inserts one batch of test links (already sized to fit under the
 * bind-parameter ceiling by the caller) as a single multi-row
 * INSERT ... ON CONFLICT DO UPDATE, merging hit_count on repeat ingestion
 * of the same (commit_sha, file_path, unit_key, branch_id, test_id)
 * identity — mirrors coverageModelService.insertCoverageUnitBatch's own
 * dedup shape (which likewise keys on file_path, not just unit_key/branch_id).
 */
async function insertTestLinkBatch(
  client: PoolClient,
  commitSha: string,
  testId: string,
  testName: string | null,
  testFile: string | null,
  links: readonly CoverageTestLinkInput[],
): Promise<void> {
  if (links.length === 0) return;

  const values: unknown[] = [];
  const rowPlaceholders = links.map((link, index) => {
    const base = index * TEST_LINK_INSERT_COLUMN_COUNT;
    values.push(commitSha, link.unitKey, link.branchId, link.filePath, testId, link.hitCount);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
  });

  await client.query(
    `INSERT INTO coverage_test_links
       (commit_sha, unit_key, branch_id, file_path, test_id, hit_count)
     VALUES ${rowPlaceholders.join(', ')}
     ON CONFLICT (commit_sha, file_path, unit_key, COALESCE(branch_id, ''), test_id)
     DO UPDATE SET
       hit_count = coverage_test_links.hit_count + EXCLUDED.hit_count,
       last_seen_at = now()`,
    values,
  );

  // Neither test_name nor test_file is part of the identity/conflict target
  // (a test's display name and spec file are metadata, not identity —
  // test_id is the stable key), but both should stay current on repeat
  // ingestion in case a test was renamed or moved. Separate statements
  // (rather than folding into the DO UPDATE above) keep the hot path's
  // conflict clause simple; each only runs when its value is actually known.
  if (testName !== null) {
    await client.query(
      `UPDATE coverage_test_links
       SET test_name = $1
       WHERE commit_sha = $2 AND test_id = $3 AND (test_name IS DISTINCT FROM $1)`,
      [testName, commitSha, testId],
    );
  }
  if (testFile !== null) {
    await client.query(
      `UPDATE coverage_test_links
       SET test_file = $1
       WHERE commit_sha = $2 AND test_id = $3 AND (test_file IS DISTINCT FROM $1)`,
      [testFile, commitSha, testId],
    );
  }
}

/**
 * Links a set of units ingested from one dump to the test that produced
 * them, using the SAME transaction client the caller is already holding
 * (see coverageIngestionService) so this write commits atomically with the
 * coverage_units upsert it accompanies.
 */
export async function linkCoverageUnitsToTest(
  client: PoolClient,
  commitSha: string,
  testId: string,
  testName: string | null,
  testFile: string | null,
  linksInput: readonly CoverageTestLinkInput[],
): Promise<void> {
  // Collapsed ONCE, globally, before chunking — a duplicate identity split
  // across two separate batches would just mean two sequential UPDATEs
  // (harmless), but a duplicate WITHIN one batch's own INSERT statement is
  // what PostgreSQL rejects (see collapseDuplicateIdentities' docblock).
  // Collapsing up front also means chunk sizing reflects the true row
  // count that will actually reach the DB.
  const links = collapseDuplicateIdentities(linksInput);
  for (let start = 0; start < links.length; start += MAX_LINKS_PER_INSERT_BATCH) {
    const batch = links.slice(start, start + MAX_LINKS_PER_INSERT_BATCH);
    await insertTestLinkBatch(client, commitSha, testId, testName, testFile, batch);
  }
}

/** Finds every test known to cover a given code unit, at a given commit. */
export async function findTestsForUnit(
  commitSha: string,
  unitKey: string,
  branchId: string | null,
): Promise<CoverageTestLink[]> {
  const result = await coverageDb.query<CoverageTestLinkRow>(
    `SELECT id, commit_sha, unit_key, branch_id, file_path, test_id, test_name, test_file, hit_count, first_seen_at, last_seen_at
     FROM coverage_test_links
     WHERE commit_sha = $1 AND unit_key = $2 AND COALESCE(branch_id, '') = COALESCE($3, '')
     ORDER BY test_id`,
    [commitSha, unitKey, branchId],
  );
  return result.rows.map(toCoverageTestLink);
}

/** Finds every code unit a given test is known to cover, at a given commit. */
export async function findUnitsForTest(
  commitSha: string,
  testId: string,
): Promise<CoverageTestLink[]> {
  const result = await coverageDb.query<CoverageTestLinkRow>(
    `SELECT id, commit_sha, unit_key, branch_id, file_path, test_id, test_name, test_file, hit_count, first_seen_at, last_seen_at
     FROM coverage_test_links
     WHERE commit_sha = $1 AND test_id = $2
     ORDER BY file_path, unit_key, branch_id`,
    [commitSha, testId],
  );
  return result.rows.map(toCoverageTestLink);
}

/**
 * A mapping result carrying confidence/freshness alongside the link itself
 * — the shape the mapping QUERY API (MINCRM-621) returns, distinct from
 * CoverageTestLink (which is purely coverage_test_links' own columns).
 * confidenceScore/lastReconciledAt come from a JOIN against coverage_units
 * on the shared (commit_sha, unit_key, branch_id) identity — both tables
 * live in the SAME coverage database, so this is a normal same-database
 * join, not a cross-database query.
 */
export interface CoverageMappingResult extends CoverageTestLink {
  confidenceScore: number | null;
  lastReconciledAt: string | null;
}

interface CoverageMappingResultRow extends CoverageTestLinkRow {
  confidence_score: string | null;
  last_reconciled_at: Date | null;
}

function toCoverageMappingResult(row: CoverageMappingResultRow): CoverageMappingResult {
  return {
    ...toCoverageTestLink(row),
    // Same string-vs-number NUMERIC coercion coverageModelService.ts does
    // for coverage_units.confidence_score — pg returns NUMERIC as a string.
    // Null when the LEFT JOIN below finds no matching coverage_units row
    // (e.g. reconciliation pruned it, or it was ingested via a path that
    // never populated coverage_units for some reason) — a mapping RESULT
    // should still be returned in that case, just without a score, rather
    // than silently dropped from the response.
    confidenceScore: row.confidence_score !== null ? Number(row.confidence_score) : null,
    lastReconciledAt: row.last_reconciled_at ? row.last_reconciled_at.toISOString() : null,
  };
}

const MAPPING_RESULT_SELECT = `
  SELECT
    l.id, l.commit_sha, l.unit_key, l.branch_id, l.file_path, l.test_id, l.test_name, l.test_file,
    l.hit_count, l.first_seen_at, l.last_seen_at,
    u.confidence_score, u.last_reconciled_at
  FROM coverage_test_links l
  LEFT JOIN coverage_units u
    ON u.commit_sha = l.commit_sha
   AND u.file_path = l.file_path
   AND u.unit_key = l.unit_key
   AND COALESCE(u.branch_id, '') = COALESCE(l.branch_id, '')
`;

/**
 * Finds every test known to cover a given code unit, at a given commit,
 * with confidence/freshness attached — the query API's own read path
 * (MINCRM-621's "returns confidence/freshness alongside results" AC).
 */
export async function findTestsForUnitWithConfidence(
  commitSha: string,
  unitKey: string,
  branchId: string | null,
): Promise<CoverageMappingResult[]> {
  const result = await coverageDb.query<CoverageMappingResultRow>(
    `${MAPPING_RESULT_SELECT}
     WHERE l.commit_sha = $1 AND l.unit_key = $2 AND COALESCE(l.branch_id, '') = COALESCE($3, '')
     ORDER BY l.test_id`,
    [commitSha, unitKey, branchId],
  );
  return result.rows.map(toCoverageMappingResult);
}

/**
 * Finds every test known to cover a given code unit at a given commit,
 * ACROSS EVERY BRANCH — unlike findTestsForUnitWithConfidence, which
 * requires an exact (unitKey, branchId) identity match, this ignores
 * branch_id (but NOT file_path — see below) and matches on (file_path,
 * unit_key) instead.
 *
 * For MINCRM-624's test-selection consumer (testSelectionService.ts):
 * changeUnitResolver resolves a git diff to changed FUNCTIONS, not
 * individual branch arms within a function — it has no way to know which
 * specific branch_id (e.g. an `if` statement's true/false arm) a change
 * touched, only that the enclosing function changed. A branching
 * function's own coverage is stored under one or more NON-null branch_id
 * rows (see coverageSymbolicationService.ts's branch-granularity path) —
 * never under a null-branch_id row — so a lookup requiring branchId: null
 * to exact-match would always return zero results for exactly the
 * functions most likely to have meaningful branch-level test coverage
 * (found via Greptile PR review). This function is test-selection's own
 * query, additive to the mapping query API's existing documented,
 * versioned single-identity contract (MINCRM-621) — that contract's exact-
 * match semantics are unchanged and still used as-is by
 * findTestsForUnit(WithConfidence).
 *
 * filePath IS still part of the match, even though branch_id is dropped:
 * unit_key alone is NOT globally unique — it's derived purely from a
 * function's own qualified name + normalized body hash (see
 * structuralKeyService.ts), with no file path folded in, so two
 * DIFFERENT files at the same commit can legitimately produce the exact
 * same unit_key for two unrelated, coincidentally-identical functions (a
 * real risk — coverage_units_identity_idx's own uniqueness is keyed on
 * (commit_sha, file_path, unit_key, branch_id) for exactly this reason).
 * Matching on unit_key alone here would return coverage links from BOTH
 * files, causing test selection to attribute an unrelated file's tests to
 * the actually-changed one (found via Greptile PR review).
 */
export async function findTestsForUnitAcrossBranches(
  commitSha: string,
  filePath: string,
  unitKey: string,
): Promise<CoverageMappingResult[]> {
  const startedAt = Date.now();
  const result = await coverageDb.query<CoverageMappingResultRow>(
    `${MAPPING_RESULT_SELECT}
     WHERE l.commit_sha = $1 AND l.file_path = $2 AND l.unit_key = $3
     ORDER BY l.branch_id, l.test_id`,
    [commitSha, filePath, unitKey],
  );
  logger.info(
    {
      commitSha,
      filePath,
      unitKey,
      resultCount: result.rows.length,
      durationMs: Date.now() - startedAt,
    },
    'coverageMappingService: findTestsForUnitAcrossBranches',
  );
  return result.rows.map(toCoverageMappingResult);
}

/** One `(filePath, unitKey)` pair's batched lookup result, always present in the returned array even when no matches exist for that pair. */
export interface BatchedCoverageMappingResult {
  filePath: string;
  unitKey: string;
  matches: CoverageMappingResult[];
}

/**
 * `JSON.stringify` key for a (filePath, unitKey) pair — same non-delimiter-
 * collision rationale as collapseDuplicateIdentities' own identityKey above
 * (a plain string join lets two distinct pairs collide when a delimiter
 * character is also a field's own content). Exported as the single shared
 * implementation of this key shape: testSelectionService.ts's own
 * enclosingUnitMapKey used to be a byte-identical, independently-maintained
 * copy of this same function (found during MINCRM-637 commit review) —
 * that module already imports from this one, so this is the correct
 * direction to share it in, not the reverse.
 */
export function unitPairKey(filePath: string, unitKey: string): string {
  return JSON.stringify([filePath, unitKey]);
}

/**
 * Batched form of findTestsForUnitAcrossBranches (MINCRM-637) — resolves
 * every (filePath, unitKey) pair in one call instead of testSelectionService's
 * former per-unit fan-out (up to `ceil(N/MAX_CONCURRENT_MAPPING_LOOKUPS)`
 * sequential round trips for N changed units). Written for
 * testSelectionService's direct-lookup step, the only production caller —
 * select-tests.ts (the CI/local test-selection CLI) invokes it in-process,
 * never over HTTP, so this is a service-layer batch function, not a new
 * route (see docs/plans/MINCRM-636.md's Rejected alternatives for why an
 * earlier draft proposing an HTTP endpoint here was wrong).
 *
 * Drives off coverage_test_links_unit_idx (commit_sha, unit_key) — the
 * only existing index that can serve a multi-unit lookup on this table.
 * No index covers file_path for coverage_test_links, so a query filtering
 * on file_path too could not use a better index than this one regardless;
 * `file_path` is therefore filtered in application code, exactly mirroring
 * the singular findTestsForUnitAcrossBranches' own reliance on
 * (commit_sha, unit_key) selectivity ahead of its file_path equality
 * check — this is the same tradeoff, just applied across a set of
 * unit_keys in one query instead of one unit_key per query.
 *
 * Chunked at MAX_UNITS_PER_MAPPING_LOOKUP_BATCH — see that constant's own
 * docblock for why (result-set size, not the bind-parameter ceiling).
 *
 * Deduplicates input pairs before querying (two changed units can resolve
 * to the same (filePath, unitKey) — e.g. an anonymous callback appearing
 * more than once in a diff) so the same pair is never queried twice within
 * one batch. Every result group is ordered `ORDER BY unit_key, branch_id,
 * test_id` — deterministic, and matching the singular function's own
 * `ORDER BY l.branch_id, l.test_id` once grouped back down to a single
 * unit_key. This matters because testSelectionService's dedupeByTestId
 * primarily tie-breaks by `reason` (direct-hit over inherited) and then by
 * `confidenceScore`, but on a genuine tie (same reason, same confidence —
 * e.g. two links to the same test at the same score) it keeps whichever
 * occurrence it saw FIRST, silently falling through to array order. A
 * non-deterministic result order for a genuine tie would make selection
 * output non-deterministic in exactly that (rare, but real) case; this
 * function's stable `ORDER BY` closes that gap rather than leaving it to
 * whatever order PostgreSQL happens to return unordered rows in.
 */
export async function findTestsForUnitsAcrossBranches(
  commitSha: string,
  units: readonly { filePath: string; unitKey: string }[],
): Promise<BatchedCoverageMappingResult[]> {
  const startedAt = Date.now();
  const uniquePairsByKey = new Map<string, { filePath: string; unitKey: string }>();
  for (const unit of units) {
    uniquePairsByKey.set(unitPairKey(unit.filePath, unit.unitKey), unit);
  }
  const uniquePairs = Array.from(uniquePairsByKey.values());

  const matchesByPairKey = new Map<string, CoverageMappingResult[]>();
  for (const pair of uniquePairs) {
    matchesByPairKey.set(unitPairKey(pair.filePath, pair.unitKey), []);
  }

  for (let start = 0; start < uniquePairs.length; start += MAX_UNITS_PER_MAPPING_LOOKUP_BATCH) {
    const chunk = uniquePairs.slice(start, start + MAX_UNITS_PER_MAPPING_LOOKUP_BATCH);
    const unitKeys = chunk.map((pair) => pair.unitKey);

    const result = await coverageDb.query<CoverageMappingResultRow>(
      `${MAPPING_RESULT_SELECT}
       WHERE l.commit_sha = $1 AND l.unit_key = ANY($2)
       ORDER BY l.unit_key, l.branch_id, l.test_id`,
      [commitSha, unitKeys],
    );

    // unit_key alone is not globally unique across files (see
    // findTestsForUnitAcrossBranches' own docblock) — a row is only a real
    // match for a requested pair when its file_path ALSO matches that
    // pair's file_path, not merely its unit_key. Rows for a coincidentally-
    // identical unit_key in an unrequested file are discarded here, not
    // misattributed to the requested pair.
    const chunkPairKeysByUnitKey = new Map<string, Set<string>>();
    for (const pair of chunk) {
      const existing = chunkPairKeysByUnitKey.get(pair.unitKey);
      const filePathSet = existing ?? new Set<string>();
      filePathSet.add(pair.filePath);
      chunkPairKeysByUnitKey.set(pair.unitKey, filePathSet);
    }

    for (const row of result.rows) {
      const requestedFilePaths = chunkPairKeysByUnitKey.get(row.unit_key);
      if (!requestedFilePaths?.has(row.file_path)) continue;
      const key = unitPairKey(row.file_path, row.unit_key);
      matchesByPairKey.get(key)?.push(toCoverageMappingResult(row));
    }
  }

  const results = uniquePairs.map((pair) => ({
    filePath: pair.filePath,
    unitKey: pair.unitKey,
    matches: matchesByPairKey.get(unitPairKey(pair.filePath, pair.unitKey)) ?? [],
  }));

  const totalMatchCount = results.reduce((sum, r) => sum + r.matches.length, 0);
  const chunkCount = Math.ceil(uniquePairs.length / MAX_UNITS_PER_MAPPING_LOOKUP_BATCH) || 0;
  logger.info(
    {
      commitSha,
      inputUnitCount: units.length,
      uniqueUnitCount: uniquePairs.length,
      chunkCount,
      totalMatchCount,
      durationMs: Date.now() - startedAt,
    },
    'coverageMappingService: findTestsForUnitsAcrossBranches',
  );

  return results;
}

/**
 * Finds every code unit a given test is known to cover, at a given commit,
 * with confidence/freshness attached.
 */
export async function findUnitsForTestWithConfidence(
  commitSha: string,
  testId: string,
): Promise<CoverageMappingResult[]> {
  const result = await coverageDb.query<CoverageMappingResultRow>(
    `${MAPPING_RESULT_SELECT}
     WHERE l.commit_sha = $1 AND l.test_id = $2
     ORDER BY l.file_path, l.unit_key, l.branch_id`,
    [commitSha, testId],
  );
  return result.rows.map(toCoverageMappingResult);
}

// ── Committed-map load/export (pr-tia-8) ────────────────────────────────────
//
// CI has no persistent database — every job's coverageDb is a fresh,
// ephemeral Postgres service container with no memory of any prior run
// (see docs/dev/coverage.md's "Coverage Database" section: the ONE
// long-lived instance is a developer's own local docker-compose db
// service, never present in GitHub Actions). The map therefore has to
// round-trip through a committed file (qa/coverage-map.json), the same
// pattern test-timing-baseline.json already establishes for LPT shard
// timing data. exportCoverageTestLinks reads the live table (called once,
// at the end of tia-record-mode.yml, which has real freshly-ingested
// data); loadCoverageTestLinksForCommit re-populates an otherwise-empty
// table from that file before any selection-time query runs (called by
// load-coverage-map.ts, itself invoked by both the pre-push hook and
// ci.yml's tia-selection job) — every existing query function above
// (findTestsForUnitAcrossBranches, findUnitsForTest, etc.) then works
// completely unchanged against the loaded rows.

const TEST_LINK_EXPORT_COLUMN_COUNT = 7;
const MAX_EXPORT_ROWS_PER_INSERT_BATCH = Math.floor(65535 / TEST_LINK_EXPORT_COLUMN_COUNT);

/** One row of the committed map file — deliberately NOT CoverageTestLink (no id/commitSha/timestamps): those are per-database identity/audit fields that mean nothing once exported to a file rewritten against a different commit_sha on load (see loadCoverageTestLinksForCommit). */
export interface CoverageTestLinkExportEntry {
  unitKey: string;
  branchId: string | null;
  filePath: string;
  testId: string;
  testName: string | null;
  testFile: string | null;
  hitCount: number;
}

/** Reads every coverage_test_links row, for exporting to qa/coverage-map.json. Not scoped to a single commit_sha — the export always represents "every mapping this database currently knows," matching test-timing-baseline.json's own "latest known" (not per-commit) semantics. */
export async function exportAllCoverageTestLinks(): Promise<CoverageTestLinkExportEntry[]> {
  const result = await coverageDb.query<{
    unit_key: string;
    branch_id: string | null;
    file_path: string;
    test_id: string;
    test_name: string | null;
    test_file: string | null;
    hit_count: number;
  }>(
    `SELECT unit_key, branch_id, file_path, test_id, test_name, test_file, hit_count
     FROM coverage_test_links
     ORDER BY unit_key, file_path, test_id`,
  );
  return result.rows.map((row) => ({
    unitKey: row.unit_key,
    branchId: row.branch_id,
    filePath: row.file_path,
    testId: row.test_id,
    testName: row.test_name,
    testFile: row.test_file,
    hitCount: row.hit_count,
  }));
}

/**
 * Replaces every coverage_test_links row for a given commit_sha with the
 * given entries, in a single transaction — a genuine replace (delete then
 * insert), not an upsert: unlike linkCoverageUnitsToTest's per-test
 * accumulation (real ingestion, where hit_count should grow across
 * repeated dumps for the SAME test), a map load represents "this is now
 * the complete, authoritative mapping for this commit," so a stale row
 * from a PRIOR load at the same commitSha (e.g. a test that no longer
 * covers a unit in the freshly-committed map) must not survive.
 *
 * commitSha is caller-supplied, not read from the export file — the
 * committed map carries no commit_sha of its own (see
 * CoverageTestLinkExportEntry's own docblock); the caller (load-coverage-map.ts)
 * decides which commit the loaded rows should answer queries for,
 * ordinarily the SHA select-tests.ts is about to query against.
 */
export async function loadCoverageTestLinksForCommit(
  commitSha: string,
  entries: readonly CoverageTestLinkExportEntry[],
): Promise<void> {
  const client = await coverageDb.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [commitSha]);

    for (let start = 0; start < entries.length; start += MAX_EXPORT_ROWS_PER_INSERT_BATCH) {
      const batch = entries.slice(start, start + MAX_EXPORT_ROWS_PER_INSERT_BATCH);
      if (batch.length === 0) continue;

      const values: unknown[] = [];
      const rowPlaceholders = batch.map((entry, index) => {
        const base = index * TEST_LINK_EXPORT_COLUMN_COUNT;
        values.push(
          commitSha,
          entry.unitKey,
          entry.branchId,
          entry.filePath,
          entry.testId,
          entry.testName,
          entry.hitCount,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
      });

      await client.query(
        `INSERT INTO coverage_test_links
           (commit_sha, unit_key, branch_id, file_path, test_id, test_name, hit_count)
         VALUES ${rowPlaceholders.join(', ')}
         ON CONFLICT (commit_sha, file_path, unit_key, COALESCE(branch_id, ''), test_id)
         DO UPDATE SET
           test_name = EXCLUDED.test_name,
           hit_count = EXCLUDED.hit_count,
           last_seen_at = now()`,
        values,
      );

      // test_file, like test_name in insertTestLinkBatch, sits outside the
      // conflict target — a second pass per batch, only for entries that
      // actually carry one.
      const withTestFile = batch.filter((entry) => entry.testFile !== null);
      for (const entry of withTestFile) {
        await client.query(
          `UPDATE coverage_test_links
           SET test_file = $1
           WHERE commit_sha = $2 AND file_path = $3 AND unit_key = $4 AND COALESCE(branch_id, '') = COALESCE($5, '') AND test_id = $6`,
          [entry.testFile, commitSha, entry.filePath, entry.unitKey, entry.branchId, entry.testId],
        );
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
