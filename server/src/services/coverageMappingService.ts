/**
 * Coverage/TIA bidirectional code<->test index.
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

// findTestsForUnitsAcrossBranches' secondary ceiling — NOT a
// bind-parameter-ceiling concern like MAX_LINKS_PER_INSERT_BATCH above
// (a `unit_key = ANY($2)` array is one bind parameter regardless of the
// array's own length). It bounds the key array itself, so a diff of
// entirely-unmapped units — every key costing zero rows, contributing
// nothing to the row budget below — still cannot build one enormous query.
const MAX_UNITS_PER_MAPPING_LOOKUP_BATCH = 200;

// The primary bound: rows returned by one batch, not keys requested by it.
//
// Key count is a poor proxy for cost because per-key fan-out spans orders of
// magnitude. Measured against a 36.1M-row coverage database (3,625 distinct
// keys for one commit_sha): median 140 rows per key, p90 939, p99 7,884,
// max 51,200 — a 366x spread, with 2.4% of keys holding 43% of all rows. So a
// 200-key batch holds ~28,000 rows of median keys or 1,375,869 rows of hot ones.
//
// What the ceiling buys is sort headroom, not fetch time. EXPLAIN on that
// 1.37M-row batch shows `Sort Method: external merge Disk: 104832kB` — ORDER BY
// spilling 105MB against work_mem=4MB, on a plan chosen because the planner
// estimates 8,418 rows where 1,375,869 arrive. Its measured cost varies by an
// order of magnitude with cache state: 2.9s warm, 12.3s cold, against a 30s
// statement_timeout. Bounding the batch bounds the sort's input, which is what
// keeps the cold case from approaching that ceiling.
//
// 250,000 sits well below the batch that produced those times while still
// packing typical 140-row keys into one query.
//
// Counting first is what makes that affordable, and it holds on the cold plan
// too. The load path never VACUUMs, so a freshly loaded table has no visibility
// map and the count runs as a bitmap heap scan (65,374 heap blocks) rather than
// the index-only scan it becomes once vacuumed. Measured on the 200 hottest keys
// of an unvacuumed 2.3M-row table: 490ms, against 2,908ms for the fetch it
// bounds. Counting is cheaper than fetching because it never sorts.
const MAX_ROWS_PER_MAPPING_LOOKUP_BATCH = 250_000;

// Key ceiling used when per-key counts are unavailable, so packing has no cost
// signal to work with. Deliberately far below MAX_UNITS_PER_MAPPING_LOOKUP_BATCH:
// counts go missing when the counting query itself fails, and its most likely
// cause is a statement timeout on a large diff against a big table — exactly the
// case where falling back to the full 200-key ceiling would guarantee the fetch
// times out too. Trading more round trips for batches small enough to survive is
// the right side of that bargain when nothing is known about fan-out.
const UNCOUNTED_UNITS_PER_MAPPING_LOOKUP_BATCH = 25;

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
 * — the shape the mapping QUERY API returns, distinct from
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
 * with confidence/freshness attached — the query API's own read path.
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
 * For the test-selection consumer (testSelectionService.ts):
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
 * versioned single-identity contract — that contract's exact-
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
  // debug, not info — this is testSelectionService's per-unit inheritance
  // fan-out (mapWithConcurrencyLimit calls this once per changed unit
  // needing inheritance lookup), unlike the batched
  // findTestsForUnitsAcrossBranches below which runs once per selection
  // run. Logging every call at info would put one line per changed unit on
  // this hot path, making the log itself a measurable share of the latency
  // it's meant to report (found via Greptile branch review).
  logger.debug(
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
 * copy of this same function (found during commit review) —
 * that module already imports from this one, so this is the correct
 * direction to share it in, not the reverse.
 */
export function unitPairKey(filePath: string, unitKey: string): string {
  return JSON.stringify([filePath, unitKey]);
}

/**
 * Row counts per unit_key for one commit, used to pack lookup batches against
 * their real cost. Drives coverage_test_links_unit_idx and costs a fraction of
 * fetching the same rows, because it never sorts — see
 * MAX_ROWS_PER_MAPPING_LOOKUP_BATCH for the measurements, including why the plan
 * is a bitmap heap scan rather than index-only on a freshly loaded table.
 *
 * Returns null if the count fails, which is NOT the same as an empty map: a
 * successful count matching no rows means every key genuinely has zero links and
 * the ordinary ceiling applies, while a failure means cost is unknown. Collapsing
 * the two would put the common all-unmapped diff on the conservative ceiling and
 * multiply its round trips for nothing.
 */
async function countLinksByUnitKey(
  commitSha: string,
  unitKeys: readonly string[],
): Promise<Map<string, number> | null> {
  if (unitKeys.length === 0) return new Map();

  try {
    const counts = new Map<string, number>();
    // Chunked by the same key ceiling the fetch obeys. The count is cheaper per
    // key than the fetch, but its array grows with the diff exactly as the
    // fetch's would, so leaving it unbounded would reintroduce ahead of the
    // bounded queries the very shape they exist to prevent.
    for (let start = 0; start < unitKeys.length; start += MAX_UNITS_PER_MAPPING_LOOKUP_BATCH) {
      const chunk = unitKeys.slice(start, start + MAX_UNITS_PER_MAPPING_LOOKUP_BATCH);
      const result = await coverageDb.query<{ unit_key: string; row_count: string }>(
        `SELECT unit_key, count(*) AS row_count
           FROM coverage_test_links
          WHERE commit_sha = $1 AND unit_key = ANY($2)
          GROUP BY unit_key`,
        [commitSha, chunk],
      );
      for (const row of result.rows) counts.set(row.unit_key, Number(row.row_count));
    }
    return counts;
  } catch (err) {
    logger.warn(
      { commitSha, unitKeyCount: unitKeys.length, err },
      'coverageMappingService: unit-key row count failed, falling back to key-count chunking',
    );
    return null;
  }
}

/**
 * Packs pairs into batches bounded by MAX_ROWS_PER_MAPPING_LOOKUP_BATCH, with
 * MAX_UNITS_PER_MAPPING_LOOKUP_BATCH as a secondary ceiling.
 *
 * Groups by unit_key first: the budget is charged once per distinct key, and
 * every pair sharing a key lands in the same batch, so a pair's matches always
 * come from exactly one query. A key whose own fan-out exceeds the budget gets
 * a batch to itself — it costs what it costs, and splitting it is not possible
 * without splitting a key's rows across queries.
 *
 * A key missing from `rowCountsByUnitKey` contributes zero rows — a genuinely
 * unmapped key. A null map is different: it means the count failed and cost is
 * unknown, which is what selects the conservative ceiling.
 *
 * Exported, with the two bounds overridable, for tests only: the row budget is
 * unreachable at fixture scale, so nothing else could exercise that branch.
 */
export function packPairsIntoBatches(
  uniquePairs: readonly { filePath: string; unitKey: string }[],
  rowCountsByUnitKey: ReadonlyMap<string, number> | null,
  maxRowsPerBatch: number = MAX_ROWS_PER_MAPPING_LOOKUP_BATCH,
  maxKeysPerBatch: number = rowCountsByUnitKey === null
    ? UNCOUNTED_UNITS_PER_MAPPING_LOOKUP_BATCH
    : MAX_UNITS_PER_MAPPING_LOOKUP_BATCH,
): { filePath: string; unitKey: string }[][] {
  const pairsByUnitKey = new Map<string, { filePath: string; unitKey: string }[]>();
  for (const pair of uniquePairs) {
    const existing = pairsByUnitKey.get(pair.unitKey);
    if (existing) existing.push(pair);
    else pairsByUnitKey.set(pair.unitKey, [pair]);
  }

  const batches: { filePath: string; unitKey: string }[][] = [];
  let current: { filePath: string; unitKey: string }[] = [];
  let currentRows = 0;
  let currentKeys = 0;

  for (const [unitKey, pairs] of pairsByUnitKey) {
    const keyRows = rowCountsByUnitKey?.get(unitKey) ?? 0;
    const wouldExceedRows = currentRows + keyRows > maxRowsPerBatch;
    const wouldExceedKeys = currentKeys + 1 > maxKeysPerBatch;

    if (current.length > 0 && (wouldExceedRows || wouldExceedKeys)) {
      batches.push(current);
      current = [];
      currentRows = 0;
      currentKeys = 0;
    }

    current.push(...pairs);
    currentRows += keyRows;
    currentKeys += 1;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Batched form of findTestsForUnitAcrossBranches — resolves
 * every (filePath, unitKey) pair in one call instead of testSelectionService's
 * former per-unit fan-out (up to `ceil(N/MAX_CONCURRENT_MAPPING_LOOKUPS)`
 * sequential round trips for N changed units). Written for
 * testSelectionService's direct-lookup step, the only production caller —
 * select-tests.ts (the CI/local test-selection CLI) invokes it in-process,
 * never over HTTP, so this is a service-layer batch function, not a new
 * route: an HTTP endpoint would add request/response marshaling and an
 * auth/gating surface for a call that only ever crosses an in-process
 * function boundary within the same CLI invocation.
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
 * "AcrossBranches" describes the branch_id handling, not the commit set: this
 * reads exactly one commit_sha and never another commit's rows. Within that
 * one commit it does not filter by branch_id, so links attributed under any
 * branch are returned, and branch_id appears only as an ORDER BY tie-breaker.
 *
 * A counting pass runs first so keys can be packed against their real cost —
 * see MAX_ROWS_PER_MAPPING_LOOKUP_BATCH and packPairsIntoBatches for the
 * bounds and the failure path. The one thing neither of those can say: every
 * pair sharing a unit_key lands in the same batch, which is what lets the
 * ordering guarantee below hold, since a pair's matches then come from exactly
 * one query rather than being merged across two.
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

  const rowCountsByUnitKey = await countLinksByUnitKey(
    commitSha,
    Array.from(new Set(uniquePairs.map((pair) => pair.unitKey))),
  );

  const batches = packPairsIntoBatches(uniquePairs, rowCountsByUnitKey);

  for (const chunk of batches) {
    const unitKeys = Array.from(new Set(chunk.map((pair) => pair.unitKey)));

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
  const chunkCount = batches.length;
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
// round-trip through a committed file (qa/coverage-map.jsonl), the same
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

/** Rows per keyset page when streaming the export. Large enough that page overhead is negligible, small enough that a page is never a memory concern. */
const EXPORT_PAGE_SIZE = 5000;

/**
 * The collapsed projection of coverage_test_links, shared by the count and the
 * paginated read so the two can never describe different row sets.
 *
 * COMMIT-AGNOSTIC BY DESIGN. The table accumulates a row per (mapping,
 * commit_sha) forever, but loadCoverageTestLinksForCommit re-keys every entry
 * to one caller-supplied SHA and its ON CONFLICT target collapses duplicates —
 * so N historical SHAs of the same logical mapping become exactly one row on
 * load. The per-commit copies in the export are therefore pure duplication with
 * no consumer, and grouping them away here is lossless while removing the only
 * unbounded axis. Verified: every other reader of this table filters by a
 * single commit_sha.
 *
 * hit_count uses MAX, not SUM: ingestion already accumulates it across dumps at
 * the same commit, so summing across commits would multiply it by the number of
 * commits and grow without limit — relocating the unbounded axis into the value
 * instead of removing it. MAX means "the most this mapping was ever seen hit at
 * one commit". No consumer ranks on it (selection uses confidence_score); the
 * only readers are the query API's result shape and presence filters, which MAX
 * preserves exactly.
 *
 * test_name and test_file both take the most recent NON-NULL value. Both are
 * nullable, and ingestion fills them in only when the dump carried them, so a
 * newer NULL winning would erase a known value — which the load path cannot
 * restore, since it sets test_file only via a follow-up UPDATE guarded on the
 * value being present. commit_sha is the tiebreaker on equal last_seen_at
 * (now() at insert, so ties are real), making the output byte-stable across
 * runs and the committed file diffable.
 */
const COLLAPSED_EXPORT_PROJECTION = `
  SELECT unit_key,
         branch_id,
         file_path,
         test_id,
         MAX(hit_count) AS hit_count,
         (array_agg(test_name ORDER BY last_seen_at DESC, commit_sha)
            FILTER (WHERE test_name IS NOT NULL))[1] AS test_name,
         (array_agg(test_file ORDER BY last_seen_at DESC, commit_sha)
            FILTER (WHERE test_file IS NOT NULL))[1] AS test_file
  FROM coverage_test_links
`;

const COLLAPSED_EXPORT_GROUP_BY = `
  GROUP BY unit_key, COALESCE(branch_id, ''), branch_id, file_path, test_id
`;

/** A page of export entries plus the cursor needed to fetch the next one. */
interface ExportPage {
  entries: CoverageTestLinkExportEntry[];
  cursor: { unitKey: string; branchId: string; filePath: string; testId: string } | null;
}

/**
 * Reads one keyset page of the collapsed export.
 *
 * The seek tuple is all four grouping columns, with branch_id coalesced exactly
 * as the GROUP BY does. Omitting branch_id from the cursor would let two rows
 * differing only by branch share a cursor value, and the `>` predicate would
 * silently skip one of them at every page boundary — a non-deterministic loss
 * of mappings, which is the failure this whole change exists to prevent.
 *
 * @param client - Client holding the export's REPEATABLE READ snapshot.
 * @param after - Cursor from the previous page, or null for the first page.
 * @returns The page's entries and the cursor to continue from.
 */
async function readCollapsedExportPage(
  client: PoolClient,
  after: ExportPage['cursor'],
): Promise<ExportPage> {
  const where = after
    ? `WHERE (unit_key, COALESCE(branch_id, ''), file_path, test_id) > ($1, $2, $3, $4)`
    : '';
  const params = after ? [after.unitKey, after.branchId, after.filePath, after.testId] : [];

  const result = await client.query<{
    unit_key: string;
    branch_id: string | null;
    file_path: string;
    test_id: string;
    test_name: string | null;
    test_file: string | null;
    hit_count: number;
  }>(
    `${COLLAPSED_EXPORT_PROJECTION}
     ${where}
     ${COLLAPSED_EXPORT_GROUP_BY}
     ORDER BY unit_key, COALESCE(branch_id, ''), file_path, test_id
     LIMIT ${EXPORT_PAGE_SIZE}`,
    params,
  );

  const entries = result.rows.map((row) => ({
    unitKey: row.unit_key,
    branchId: row.branch_id,
    filePath: row.file_path,
    testId: row.test_id,
    testName: row.test_name,
    testFile: row.test_file,
    hitCount: row.hit_count,
  }));

  const last = result.rows[result.rows.length - 1];
  return {
    entries,
    cursor:
      result.rows.length < EXPORT_PAGE_SIZE || !last
        ? null
        : {
            unitKey: last.unit_key,
            branchId: last.branch_id ?? '',
            filePath: last.file_path,
            testId: last.test_id,
          },
  };
}

/**
 * Streams every coverage mapping this database knows, collapsed to one entry
 * per logical mapping, without ever holding the full set in memory.
 *
 * Replaces a buffering export that materialized the whole table, mapped it into
 * a second array, and handed it to JSON.stringify — which died on V8's 512MB
 * max string length once the table grew past it, permanently.
 *
 * The count and every page run on ONE client inside a REPEATABLE READ
 * transaction. Under the pool's default READ COMMITTED each page would be its
 * own snapshot, so a concurrent ingest between pages could make the reported
 * total disagree with the rows actually emitted — and the reader's completeness
 * check would then reject a perfectly good file.
 *
 * @param onBatch - Receives each page in key order. Awaited, so a slow consumer
 *   (writing to disk) applies backpressure rather than queuing pages in memory.
 * @returns The total number of entries emitted.
 */
export async function streamAllCoverageTestLinks(
  onBatch: (entries: CoverageTestLinkExportEntry[]) => Promise<void>,
): Promise<number> {
  const client = await coverageDb.connect();
  let emitted = 0;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

    let cursor: ExportPage['cursor'] = null;
    for (;;) {
      const page: ExportPage = await readCollapsedExportPage(client, cursor);
      if (page.entries.length > 0) {
        emitted += page.entries.length;
        await onBatch(page.entries);
      }
      if (!page.cursor) break;
      cursor = page.cursor;
    }

    await client.query('COMMIT');
    return emitted;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

    await appendCoverageTestLinkBatches(client, commitSha, entries);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Inserts entries for one commit on an already-open transaction, in
 * parameter-limit-sized batches.
 *
 * Split out so both the one-shot load above and the streaming session below
 * share exactly one implementation of the insert, the ON CONFLICT target, and
 * the test_file follow-up.
 *
 * @param client - Client inside an open transaction.
 * @param commitSha - SHA every entry is re-keyed to.
 * @param entries - Entries to insert.
 */
async function appendCoverageTestLinkBatches(
  client: PoolClient,
  commitSha: string,
  entries: readonly CoverageTestLinkExportEntry[],
): Promise<void> {
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

    // test_file sits outside the conflict target, so it needs its own pass.
    // ONE statement per batch via UPDATE ... FROM (VALUES ...), not one per
    // entry: the per-entry loop this replaces issued a round trip for every
    // row with a test_file, linear in map size and dominating the load it was
    // attached to. Mirrors linkCoverageUnitsToTest's own batched update.
    const withTestFile = batch.filter((entry) => entry.testFile !== null);
    if (withTestFile.length > 0) {
      const TEST_FILE_UPDATE_COLUMN_COUNT = 6;
      const updateValues: unknown[] = [];
      const updateRows = withTestFile.map((entry, index) => {
        const base = index * TEST_FILE_UPDATE_COLUMN_COUNT;
        updateValues.push(
          entry.testFile,
          entry.filePath,
          entry.unitKey,
          entry.branchId ?? '',
          entry.testId,
          commitSha,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
      });

      await client.query(
        `UPDATE coverage_test_links l
         SET test_file = v.test_file
         FROM (VALUES ${updateRows.join(', ')})
           AS v(test_file, file_path, unit_key, branch_key, test_id, commit_sha)
         WHERE l.commit_sha = v.commit_sha
           AND l.file_path = v.file_path
           AND l.unit_key = v.unit_key
           AND COALESCE(l.branch_id, '') = v.branch_key
           AND l.test_id = v.test_id`,
        updateValues,
      );
    }
  }
}

/** A load in progress: batches may be appended until commit or rollback. */
export interface CoverageMapLoadSession {
  /** Inserts one batch into the open transaction. */
  appendBatch(entries: readonly CoverageTestLinkExportEntry[]): Promise<void>;
  /** Commits the replace and releases the connection. */
  commit(): Promise<void>;
  /** Discards everything written and releases the connection. */
  rollback(): Promise<void>;
}

/**
 * Begins a streamed replace of one commit's mappings.
 *
 * loadCoverageTestLinksForCommit cannot be called once per streamed batch: it
 * opens its own transaction and starts by deleting the target SHA's rows, so
 * batch N+1 would erase batch N and only the last would survive. It also takes
 * a fully materialized array, which is the thing being eliminated.
 *
 * The whole load stays ONE transaction, preserving the all-or-nothing replace:
 * a failure mid-stream rolls back to the pre-load state rather than leaving a
 * half-replaced map. The caller owns the boundary but never the connection —
 * both commit() and rollback() release it, so no client can leak past this
 * layer.
 *
 * @param commitSha - SHA whose mappings are being replaced.
 * @returns A session accepting batches until commit or rollback.
 */
export async function beginCoverageMapLoad(commitSha: string): Promise<CoverageMapLoadSession> {
  const client = await coverageDb.connect();
  try {
    await client.query('BEGIN');
    // Bounds the pathological case without capping a legitimately long load:
    // this transaction holds row locks from the DELETE below and one of a small
    // pool of connections, and it also runs from the pre-push hook against a
    // developer's shared local database. A load that stalls or is abandoned
    // releases both rather than holding them indefinitely. A load that is
    // merely slow is never idle, so it is unaffected.
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '60s'`);
    await client.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [commitSha]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    throw error;
  }

  let settled = false;
  return {
    async appendBatch(entries) {
      await appendCoverageTestLinkBatches(client, commitSha, entries);
    },
    async commit() {
      if (settled) return;
      settled = true;
      try {
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    },
    async rollback() {
      if (settled) return;
      settled = true;
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    },
  };
}

/** One typeahead match — testName included for display since testId alone (a Playwright-generated hash) is not human-readable. */
export interface TestIdSearchResult {
  testId: string;
  testName: string | null;
}

/**
 * Typeahead search over coverage_test_links.test_id/test_name for a given
 * commit — backs the coverage-dashboard app's drill-down test-ID picker
 * same rationale as coverageModelService.searchUnitKeys:
 * a plain "list every test ID" endpoint is not viable at real scale, so
 * this always requires a commitSha (indexed via coverage_test_links_test_idx)
 * and a non-empty search term, capped at `limit`.
 *
 * Matches against test_id OR test_name: testId alone (testInfo.testId, a
 * Playwright-generated hash — see coverage-session-control-client.ts) is
 * not something a caller could plausibly remember or search by by eye; the
 * human-readable test_name (testInfo.title) is what they'd actually type.
 *
 * DISTINCT ON (test_id): a single test_id can appear many times in
 * coverage_test_links (once per covered unit), so the result list must be
 * deduplicated to one row per test, not one row per unit it happens to cover.
 */
export async function searchTestIds(
  commitSha: string,
  search: string,
  limit: number,
): Promise<TestIdSearchResult[]> {
  const result = await coverageDb.query<{ test_id: string; test_name: string | null }>(
    `SELECT DISTINCT ON (test_id) test_id, test_name
     FROM coverage_test_links
     WHERE commit_sha = $1 AND (test_id ILIKE '%' || $2 || '%' OR test_name ILIKE '%' || $2 || '%')
     ORDER BY test_id
     LIMIT $3`,
    [commitSha, search, limit],
  );
  return result.rows.map((row) => ({ testId: row.test_id, testName: row.test_name }));
}
