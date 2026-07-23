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

const TEST_LINK_INSERT_COLUMN_COUNT = 6;

// Same bind-parameter-ceiling rationale as coverageModelService's own
// MAX_UNITS_PER_INSERT_BATCH — PostgreSQL's wire protocol caps bind
// parameters per statement at 65535.
const MAX_LINKS_PER_INSERT_BATCH = Math.floor(65535 / TEST_LINK_INSERT_COLUMN_COUNT);

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
    hitCount: row.hit_count,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}

/**
 * Collapses links sharing the same (unitKey, branchId) identity within a
 * single batch by summing their hit counts, keyed on the SAME
 * COALESCE(branchId, '') identity the DB's own unique index uses.
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
    const identityKey = `${link.unitKey} ${link.branchId ?? ''}`;
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
 * of the same (commit_sha, unit_key, branch_id, test_id) identity —
 * mirrors coverageModelService.insertCoverageUnitBatch's own dedup shape.
 */
async function insertTestLinkBatch(
  client: PoolClient,
  commitSha: string,
  testId: string,
  testName: string | null,
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
     ON CONFLICT (commit_sha, unit_key, COALESCE(branch_id, ''), test_id)
     DO UPDATE SET
       hit_count = coverage_test_links.hit_count + EXCLUDED.hit_count,
       last_seen_at = now()`,
    values,
  );

  // test_name isn't part of the identity/conflict target (a test's display
  // name is metadata, not identity — test_id is the stable key), but should
  // still be kept current on repeat ingestion in case a test was renamed.
  // A second statement (rather than folding into the DO UPDATE above) keeps
  // the hot path's conflict clause simple; this only runs when test_name is
  // actually known.
  if (testName !== null) {
    await client.query(
      `UPDATE coverage_test_links
       SET test_name = $1
       WHERE commit_sha = $2 AND test_id = $3 AND (test_name IS DISTINCT FROM $1)`,
      [testName, commitSha, testId],
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
    await insertTestLinkBatch(client, commitSha, testId, testName, batch);
  }
}

/** Finds every test known to cover a given code unit, at a given commit. */
export async function findTestsForUnit(
  commitSha: string,
  unitKey: string,
  branchId: string | null,
): Promise<CoverageTestLink[]> {
  const result = await coverageDb.query<CoverageTestLinkRow>(
    `SELECT id, commit_sha, unit_key, branch_id, file_path, test_id, test_name, hit_count, first_seen_at, last_seen_at
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
    `SELECT id, commit_sha, unit_key, branch_id, file_path, test_id, test_name, hit_count, first_seen_at, last_seen_at
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
    l.id, l.commit_sha, l.unit_key, l.branch_id, l.file_path, l.test_id, l.test_name,
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
