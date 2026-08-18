/**
 * Integration tests for coverageModelService.
 *
 * Runs against a real PostgreSQL test database. coverage_units is
 * truncated (by file_path prefix) before each test; coverage_ingested_dumps
 * rows are tracked per-test and deleted in afterEach — every dumpId used
 * here is a fresh randomUUID() so there's no cross-test collision risk
 * either way, but leaving them behind would still accumulate unboundedly
 * across repeated local test runs against the same database.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import {
  findCoverageUnitsByCommitSha,
  isDumpAlreadyIngested,
  pruneCoverageUnits,
  relocateCoverageUnit,
  upsertCoverageUnits,
} from '../services/coverageModelService.js';
import { loadCoverageTestLinksForCommit } from '../services/coverageMappingService.js';
import type { NormalizedCoverageUnit } from '../coverageAgent/pipeline/normalizedCoverageUnit.js';
import coverageDb from '../coverageDb.js';

const FILE_PREFIX = 'coverage-model-svc';

function makeUnit(overrides: Partial<NormalizedCoverageUnit> = {}): NormalizedCoverageUnit {
  return {
    filePath: `${FILE_PREFIX}/widget.ts`,
    unitKey: 'render@10',
    branchId: '0:0',
    granularity: 'branch',
    hitCount: 1,
    resolved: true,
    unresolvedReason: null,
    ...overrides,
  };
}

const ingestedDumpIdsThisTest: string[] = [];

/** Wraps upsertCoverageUnits, tracking the dumpId for afterEach cleanup. */
async function upsertAndTrack(
  dumpId: string,
  commitSha: string,
  agent: 'node-v8' | 'browser-istanbul',
  units: NormalizedCoverageUnit[],
) {
  ingestedDumpIdsThisTest.push(dumpId);
  return upsertCoverageUnits(dumpId, commitSha, agent, units);
}

beforeEach(async () => {
  await coverageDb.query('DELETE FROM coverage_units WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
  await coverageDb.query('DELETE FROM coverage_test_links WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
  ingestedDumpIdsThisTest.length = 0;
});

afterEach(async () => {
  if (ingestedDumpIdsThisTest.length > 0) {
    await coverageDb.query('DELETE FROM coverage_ingested_dumps WHERE dump_id = ANY($1)', [
      ingestedDumpIdsThisTest,
    ]);
  }
});

afterAll(async () => {
  await coverageDb.query('DELETE FROM coverage_units WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
});

describe('coverageModelService', () => {
  describe('upsertCoverageUnits', () => {
    it('inserts new coverage_units rows anchored to the given commit SHA', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const dumpId = randomUUID();

      const { alreadyIngested, unitCount, unresolvedCount } = await upsertAndTrack(
        dumpId,
        commitSha,
        'node-v8',
        [makeUnit()],
      );

      expect(alreadyIngested).toBe(false);
      expect(unitCount).toBe(1);
      expect(unresolvedCount).toBe(0);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        commitSha,
        filePath: `${FILE_PREFIX}/widget.ts`,
        unitKey: 'render@10',
        branchId: '0:0',
        granularity: 'branch',
        agent: 'node-v8',
        hitCount: 1,
        resolved: true,
      });
    });

    it('merges (dedups) repeated ingestion of the same identity by accumulating hit_count', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [makeUnit({ hitCount: 3 })]);
      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [makeUnit({ hitCount: 2 })]);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(1);
      expect(stored[0].hitCount).toBe(5);
    });

    it('treats two null-branchId rows for the same unit as the same identity (COALESCE dedup)', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const functionUnit = makeUnit({ branchId: null, granularity: 'function', hitCount: 4 });

      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [functionUnit]);
      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [{ ...functionUnit, hitCount: 6 }]);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(1);
      expect(stored[0].hitCount).toBe(10);
    });

    it('keeps distinct branchIds under the same unitKey as separate rows', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [
        makeUnit({ branchId: '0:0' }),
        makeUnit({ branchId: '0:1' }),
      ]);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(2);
    });

    it('collapses two rows sharing the same identity WITHIN one call rather than erroring on a same-statement ON CONFLICT collision', async () => {
      // A single symbolicated dump can legitimately produce more than one
      // NormalizedCoverageUnit for the same (file_path, unit_key, branch_id)
      // identity in one call (e.g. the same function reached via more than
      // one V8 script). Without collapsing duplicates before building the
      // multi-row INSERT, PostgreSQL rejects the statement outright
      // ("ON CONFLICT DO UPDATE command cannot affect row a second time")
      // rather than silently mishandling it — this proves the fix, not just
      // that no error is thrown.
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

      const { unresolvedCount } = await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [
        makeUnit({ branchId: '0:0', hitCount: 3 }),
        makeUnit({ branchId: '0:0', hitCount: 4 }),
      ]);

      expect(unresolvedCount).toBe(0);
      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(1);
      expect(stored[0].hitCount).toBe(7);
    });

    it('keeps two units whose filePath/unitKey pairs share a delimited-string collision as distinct (Greptile PR feedback)', async () => {
      // Regression test: collapseDuplicateIdentities' in-batch dedup key
      // used to be a plain `${filePath} ${unitKey} ${branchId}` join, so
      // filePath "a b" + unitKey "c" and filePath "a" + unitKey "b c" both
      // serialized to the same string and were wrongly merged into one unit
      // before ever reaching the database's own (correctly file_path-aware)
      // unique index. The key is now a JSON-encoded tuple, which cannot
      // collide this way.
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

      const { unresolvedCount } = await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [
        makeUnit({ filePath: `${FILE_PREFIX}/a b`, unitKey: 'c@1', branchId: null, hitCount: 2 }),
        makeUnit({ filePath: `${FILE_PREFIX}/a`, unitKey: 'b c@1', branchId: null, hitCount: 9 }),
      ]);

      expect(unresolvedCount).toBe(0);
      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(2);
      const byUnitKey = new Map(stored.map((unit) => [unit.unitKey, unit]));
      expect(byUnitKey.get('c@1')?.hitCount).toBe(2);
      expect(byUnitKey.get('b c@1')?.hitCount).toBe(9);
    });

    it('persists resolved=false rows with their unresolvedReason rather than dropping them', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

      const { unresolvedCount } = await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [
        makeUnit({
          resolved: false,
          unresolvedReason: 'sourcemap not found',
          branchId: null,
          granularity: 'function',
        }),
      ]);

      expect(unresolvedCount).toBe(1);
      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored[0].resolved).toBe(false);
      expect(stored[0].unresolvedReason).toBe('sourcemap not found');
    });

    it('records the dump as ingested so isDumpAlreadyIngested reflects it', async () => {
      const dumpId = randomUUID();
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

      expect(await isDumpAlreadyIngested(dumpId)).toBe(false);
      await upsertAndTrack(dumpId, commitSha, 'node-v8', [makeUnit()]);
      expect(await isDumpAlreadyIngested(dumpId)).toBe(true);
    });

    it('reports alreadyIngested=true and applies no further writes on a second sequential call for the same dumpId', async () => {
      const dumpId = randomUUID();
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

      const first = await upsertAndTrack(dumpId, commitSha, 'node-v8', [makeUnit({ hitCount: 3 })]);
      expect(first.alreadyIngested).toBe(false);

      const second = await upsertAndTrack(dumpId, commitSha, 'node-v8', [
        makeUnit({ hitCount: 3 }),
      ]);
      expect(second.alreadyIngested).toBe(true);
      expect(second.unitCount).toBe(0);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(1);
      // Still 3, not 6 — the second call's units were never applied.
      expect(stored[0].hitCount).toBe(3);
    });

    it('is race-safe: two concurrent calls for the same dumpId apply the write exactly once', async () => {
      const dumpId = randomUUID();
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

      const [first, second] = await Promise.all([
        upsertAndTrack(dumpId, commitSha, 'node-v8', [makeUnit({ hitCount: 5 })]),
        upsertAndTrack(dumpId, commitSha, 'node-v8', [makeUnit({ hitCount: 5 })]),
      ]);

      // Exactly one of the two concurrent calls should have won the claim
      // on coverage_ingested_dumps; the other must see alreadyIngested=true
      // rather than both racing the coverage_units upsert and double-adding
      // hit_count (the TOCTOU this transaction design closes).
      const alreadyIngestedFlags = [first.alreadyIngested, second.alreadyIngested].sort();
      expect(alreadyIngestedFlags).toEqual([false, true]);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(1);
      expect(stored[0].hitCount).toBe(5);
    });

    it('inserts a unit count exceeding PostgreSQL bind-parameter limits in one call without throwing', async () => {
      // 9 columns/unit x 65535 params ceiling => 7281 units fit one INSERT
      // statement; this exceeds that by design to prove the chunking loop
      // in upsertCoverageUnits actually spans a batch boundary rather than
      // constructing one oversized multi-row INSERT that would throw
      // "bind message supplies X parameters, but prepared statement
      // requires Y" at the PostgreSQL wire protocol level.
      const UNIT_COUNT_OVER_ONE_BATCH = 7300;
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const units = Array.from({ length: UNIT_COUNT_OVER_ONE_BATCH }, (_, index) =>
        makeUnit({ unitKey: `fn${index}@1`, branchId: `0:${index}` }),
      );

      const { unitCount } = await upsertAndTrack(randomUUID(), commitSha, 'node-v8', units);

      expect(unitCount).toBe(UNIT_COUNT_OVER_ONE_BATCH);
      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(UNIT_COUNT_OVER_ONE_BATCH);
    }, 30_000);
  });

  describe('pruneCoverageUnits', () => {
    it('deletes only rows whose last_seen_at is older than the retention window', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [makeUnit()]);

      await coverageDb.query(
        `UPDATE coverage_units SET last_seen_at = now() - interval '100 days' WHERE commit_sha = $1`,
        [commitSha],
      );

      const result = await pruneCoverageUnits(30);
      expect(result.prunedUnitCount).toBeGreaterThanOrEqual(1);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(0);
    });

    it('does not delete rows newer than the retention window', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [makeUnit()]);

      await pruneCoverageUnits(30);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(1);
    });

    it('deletes a coverage_test_links row whose matching coverage_units row was just pruned in the same transaction', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const unit = makeUnit();
      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [unit]);
      await coverageDb.query(
        `INSERT INTO coverage_test_links (commit_sha, unit_key, branch_id, file_path, test_id, test_name, hit_count, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, now())`,
        [
          commitSha,
          unit.unitKey,
          unit.branchId,
          unit.filePath,
          'spec:widget.spec.ts::renders',
          'renders',
        ],
      );
      await coverageDb.query(
        `UPDATE coverage_units SET last_seen_at = now() - interval '100 days' WHERE commit_sha = $1`,
        [commitSha],
      );

      const result = await pruneCoverageUnits(30);
      expect(result.prunedUnitCount).toBeGreaterThanOrEqual(1);
      expect(result.prunedLinkCount).toBeGreaterThanOrEqual(1);

      const remainingLinks = await coverageDb.query(
        'SELECT id FROM coverage_test_links WHERE commit_sha = $1',
        [commitSha],
      );
      expect(remainingLinks.rowCount).toBe(0);
    });

    it("deletes an orphaned link even when the link's OWN last_seen_at is recent — scoped to which units were just pruned, not to the link's independent freshness", async () => {
      // Closes a real bug a later branch-review round found in an earlier
      // revision of this cleanup: coverage_units.last_seen_at is refreshed
      // ONLY by real V8 ingestion (upsertCoverageUnits), while
      // coverage_test_links.last_seen_at is refreshed independently by
      // loadCoverageTestLinksForCommit's map-load path (ON CONFLICT ... DO
      // UPDATE SET last_seen_at = now()) — these are two genuinely decoupled
      // write paths. On a persistent deployment, a commit can stop being
      // actively ingested (no longer HEAD) while pre-push-tia.ts keeps
      // reloading the SAME base SHA's map on every push, refreshing only the
      // LINK's last_seen_at forever while the UNIT goes stale and gets
      // pruned. A predicate scoped to "the link is ALSO stale" would leave
      // this link an orphan forever. Scoping to "was this link's own unit
      // just deleted" (regardless of the link's own last_seen_at) is what
      // actually closes it.
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const unit = makeUnit();
      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [unit]);
      await coverageDb.query(
        `INSERT INTO coverage_test_links (commit_sha, unit_key, branch_id, file_path, test_id, test_name, hit_count, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, now())`,
        [
          commitSha,
          unit.unitKey,
          unit.branchId,
          unit.filePath,
          'spec:widget.spec.ts::renders',
          'renders',
        ],
      );
      // The unit goes stale (simulating "this commit is no longer HEAD, no
      // new V8 dumps target it"); the link stays recent (simulating a
      // repeated pre-push-tia.ts reload of the same base SHA's map).
      await coverageDb.query(
        `UPDATE coverage_units SET last_seen_at = now() - interval '100 days' WHERE commit_sha = $1`,
        [commitSha],
      );

      const result = await pruneCoverageUnits(30);
      expect(result.prunedUnitCount).toBeGreaterThanOrEqual(1);
      expect(result.prunedLinkCount).toBeGreaterThanOrEqual(1);

      const remainingLinks = await coverageDb.query(
        'SELECT id FROM coverage_test_links WHERE commit_sha = $1',
        [commitSha],
      );
      expect(remainingLinks.rowCount).toBe(0);
    });

    it('does not delete a coverage_test_links row that has no coverage_units row at all, regardless of the link being stale', async () => {
      // Mirrors loadCoverageTestLinksForCommit's real shape: a committed
      // qa/coverage-map.jsonl load writes coverage_test_links rows with NO
      // corresponding coverage_units rows, ever — that's the normal, only
      // way select-tests.ts gets a coverage index in CI and via
      // pre-push-tia.ts locally. This cleanup is scoped to "matches a unit
      // identity deleted in THIS prune" — a link with no unit at all was
      // never a match in the first place, so it's out of scope regardless
      // of its own last_seen_at. Found via Greptile branch review of.
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const unit = makeUnit();
      await coverageDb.query(
        `INSERT INTO coverage_test_links (commit_sha, unit_key, branch_id, file_path, test_id, test_name, hit_count, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, now() - interval '100 days')`,
        [
          commitSha,
          unit.unitKey,
          unit.branchId,
          unit.filePath,
          'spec:widget.spec.ts::renders',
          'renders',
        ],
      );

      const result = await pruneCoverageUnits(30);
      expect(result.prunedLinkCount).toBe(0);

      const remainingLinks = await coverageDb.query(
        'SELECT id FROM coverage_test_links WHERE commit_sha = $1',
        [commitSha],
      );
      expect(remainingLinks.rowCount).toBe(1);
    });

    it('a re-load via loadCoverageTestLinksForCommit keeps a link matched to a still-live unit untouched, even at a huge age', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const unit = makeUnit();
      const testId = 'spec:reload.spec.ts::renders';
      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [unit]);
      await loadCoverageTestLinksForCommit(commitSha, [
        {
          unitKey: unit.unitKey,
          branchId: unit.branchId,
          filePath: unit.filePath,
          testId,
          testName: 'renders',
          testFile: null,
          hitCount: 1,
        },
      ]);
      await coverageDb.query(
        `UPDATE coverage_test_links SET last_seen_at = now() - interval '100 days' WHERE commit_sha = $1`,
        [commitSha],
      );

      // The real reload path: same commitSha, same entries — mirrors
      // load-coverage-map.ts re-running against an unchanged qa/coverage-map.jsonl.
      await loadCoverageTestLinksForCommit(commitSha, [
        {
          unitKey: unit.unitKey,
          branchId: unit.branchId,
          filePath: unit.filePath,
          testId,
          testName: 'renders',
          testFile: null,
          hitCount: 1,
        },
      ]);

      const result = await pruneCoverageUnits(30);
      expect(result.prunedLinkCount).toBe(0);

      const remainingLinks = await coverageDb.query(
        'SELECT id FROM coverage_test_links WHERE commit_sha = $1',
        [commitSha],
      );
      expect(remainingLinks.rowCount).toBe(1);
    });

    it('chunks the orphan-link cleanup past the bind-parameter ceiling without throwing', async () => {
      // Mirrors "inserts a unit count exceeding PostgreSQL bind-parameter
      // limits in one call without throwing" above, but for the NEW
      // MAX_UNITS_PER_LINK_DELETE_BATCH chunking this prune's link cleanup
      // needs (4 bind params per unit identity vs. that test's 9 per
      // insert) — retention has never run in production before this
      // ticket, so an established deployment's first prune could plausibly
      // exceed one VALUES list's worth of deleted units.
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const unitCount = 20_000;
      const units = Array.from({ length: unitCount }, (_, i) =>
        makeUnit({ unitKey: `render@${i}`, filePath: `${FILE_PREFIX}/chunked-${i}.ts` }),
      );
      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', units);
      for (const unit of units) {
        await coverageDb.query(
          `INSERT INTO coverage_test_links (commit_sha, unit_key, branch_id, file_path, test_id, test_name, hit_count, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, 1, now())`,
          [commitSha, unit.unitKey, unit.branchId, unit.filePath, 'spec:chunk.spec.ts::t', 't'],
        );
      }
      await coverageDb.query(
        `UPDATE coverage_units SET last_seen_at = now() - interval '100 days' WHERE commit_sha = $1`,
        [commitSha],
      );

      const result = await pruneCoverageUnits(30);
      expect(result.prunedUnitCount).toBe(unitCount);
      expect(result.prunedLinkCount).toBe(unitCount);

      const remainingLinks = await coverageDb.query(
        'SELECT id FROM coverage_test_links WHERE commit_sha = $1',
        [commitSha],
      );
      expect(remainingLinks.rowCount).toBe(0);
      // 90s, raised from 30s. This is by far the heaviest test in the suite —
      // 20,000 units through an insert, a prune and a chunked link cleanup,
      // ~29x slower than the next slowest test in this file. It takes ~5s on an
      // idle machine, but it runs in the `parallel` project alongside five other
      // DB-bound workers (vitest.config.ts maxWorkers: 6), and on a contended CI
      // runner it hit exactly 30,039ms and failed the job (PR #369).
      //
      // The old 30s left under a 6x margin against a figure measured on an idle
      // machine — not enough headroom for a shared runner. Same reasoning the
      // `serial` project already applies to seedDemo ("60s allows each call up
      // to ~15s on a loaded machine"); this test is heavier still and the
      // parallel project has no raised default to inherit. Raising the ceiling
      // does not slow the passing case: a test that finishes in 5s finishes in
      // 5s either way.
    }, 90_000);

    it('deletes coverage_ingested_dumps rows older than the retention window', async () => {
      // coverage_ingested_dumps had zero retention pruning at all before
      // this — an unbounded idempotency-claim ledger that would eventually
      // slow ingestCoverageDump's own claim INSERT (found via Greptile
      // branch review).
      const dumpId = randomUUID();
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      await upsertAndTrack(dumpId, commitSha, 'node-v8', [makeUnit()]);
      await coverageDb.query(
        `UPDATE coverage_ingested_dumps SET ingested_at = now() - interval '100 days' WHERE dump_id = $1`,
        [dumpId],
      );

      const result = await pruneCoverageUnits(30);
      expect(result.prunedIngestedDumpCount).toBeGreaterThanOrEqual(1);

      const remaining = await isDumpAlreadyIngested(dumpId);
      expect(remaining).toBe(false);
    });

    it('does not delete a coverage_ingested_dumps row newer than the retention window', async () => {
      const dumpId = randomUUID();
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      await upsertAndTrack(dumpId, commitSha, 'node-v8', [makeUnit()]);

      await pruneCoverageUnits(30);

      const remaining = await isDumpAlreadyIngested(dumpId);
      expect(remaining).toBe(true);
    });

    it("does not touch a still-linked (non-pruned) unit's coverage_units or coverage_test_links row", async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const unit = makeUnit();
      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [unit]);
      await coverageDb.query(
        `INSERT INTO coverage_test_links (commit_sha, unit_key, branch_id, file_path, test_id, test_name, hit_count)
         VALUES ($1, $2, $3, $4, $5, $6, 1)`,
        [
          commitSha,
          unit.unitKey,
          unit.branchId,
          unit.filePath,
          'spec:widget.spec.ts::renders',
          'renders',
        ],
      );
      // last_seen_at deliberately left recent — this unit is NOT within the
      // retention window and must survive the prune untouched, so it's
      // never in prunedUnits' RETURNING set, and its coverage_test_links
      // row is therefore never in scope for the link cleanup either (see
      // coverageMappingService.test.ts for the LEFT JOIN /
      // confidenceScore: null behavior this orphan-cleanup exists to
      // prevent for units that DO get pruned).

      await pruneCoverageUnits(30);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(1);

      const remainingLinks = await coverageDb.query(
        'SELECT id FROM coverage_test_links WHERE commit_sha = $1',
        [commitSha],
      );
      expect(remainingLinks.rowCount).toBe(1);
    });
  });

  describe('relocateCoverageUnit', () => {
    it('moves a unit to a new file_path/unit_key when no row already exists there', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [makeUnit({ hitCount: 4 })]);
      const [before] = await findCoverageUnitsByCommitSha(commitSha);

      const survivingId = await relocateCoverageUnit(
        before.id,
        `${FILE_PREFIX}/renamed.ts`,
        'render@20',
      );

      // Non-collision case: the surviving id is the original row's own id.
      expect(survivingId).toBe(before.id);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(before.id);
      expect(stored[0].filePath).toBe(`${FILE_PREFIX}/renamed.ts`);
      expect(stored[0].unitKey).toBe('render@20');
      expect(stored[0].hitCount).toBe(4);
    });

    it('merges into the existing row rather than violating the unique index when the destination identity already has its own row', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      // The row being relocated...
      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [
        makeUnit({ filePath: `${FILE_PREFIX}/old.ts`, hitCount: 3 }),
      ]);
      // ...and a row that ALREADY occupies the destination identity
      // (commit_sha, new file_path, new unit_key, branch_id) — e.g. the
      // rename target was already ingested separately under the same commit.
      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [
        makeUnit({ filePath: `${FILE_PREFIX}/new.ts`, unitKey: 'render@99', hitCount: 5 }),
      ]);

      const beforeAll = await findCoverageUnitsByCommitSha(commitSha);
      const movingUnit = beforeAll.find((u) => u.filePath === `${FILE_PREFIX}/old.ts`)!;
      const destinationUnit = beforeAll.find((u) => u.filePath === `${FILE_PREFIX}/new.ts`)!;

      const survivingId = await relocateCoverageUnit(
        movingUnit.id,
        `${FILE_PREFIX}/new.ts`,
        'render@99',
      );

      // The returned id must be the DESTINATION row's id, not the moving
      // row's — callers (coverageReconciliationService) rely on this to
      // know which row to act on next; the moving row's own id no longer
      // exists after the merge.
      expect(survivingId).toBe(destinationUnit.id);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      // The moving row was merged away, not left as a duplicate — only the
      // pre-existing destination row remains, with hit_count summed.
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(destinationUnit.id);
      expect(stored[0].filePath).toBe(`${FILE_PREFIX}/new.ts`);
      expect(stored[0].hitCount).toBe(8);
    });
  });
});
