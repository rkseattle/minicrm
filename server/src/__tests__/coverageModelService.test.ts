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
  upsertCoverageUnits,
} from '../services/coverageModelService.js';
import type { NormalizedCoverageUnit } from '../coverageAgent/pipeline/normalizedCoverageUnit.js';
import pool from '../db.js';

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
  await pool.query('DELETE FROM coverage_units WHERE file_path LIKE $1', [`${FILE_PREFIX}/%`]);
  ingestedDumpIdsThisTest.length = 0;
});

afterEach(async () => {
  if (ingestedDumpIdsThisTest.length > 0) {
    await pool.query('DELETE FROM coverage_ingested_dumps WHERE dump_id = ANY($1)', [
      ingestedDumpIdsThisTest,
    ]);
  }
});

afterAll(async () => {
  await pool.query('DELETE FROM coverage_units WHERE file_path LIKE $1', [`${FILE_PREFIX}/%`]);
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
  });

  describe('pruneCoverageUnits', () => {
    it('deletes only rows whose last_seen_at is older than the retention window', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      await upsertAndTrack(randomUUID(), commitSha, 'node-v8', [makeUnit()]);

      await pool.query(
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
});
