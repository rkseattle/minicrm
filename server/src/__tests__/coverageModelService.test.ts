/**
 * Integration tests for coverageModelService. (MINCRM-616)
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

      const deletedCount = await pruneCoverageUnits(30);
      expect(deletedCount).toBeGreaterThanOrEqual(1);

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
