/**
 * Integration tests for coverageModelService. (MINCRM-616)
 *
 * Runs against a real PostgreSQL test database. coverage_units and
 * coverage_ingested_dumps are truncated before each test.
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

beforeEach(async () => {
  await pool.query('DELETE FROM coverage_units WHERE file_path LIKE $1', [`${FILE_PREFIX}/%`]);
});

afterAll(async () => {
  await pool.query('DELETE FROM coverage_units WHERE file_path LIKE $1', [`${FILE_PREFIX}/%`]);
});

describe('coverageModelService', () => {
  describe('upsertCoverageUnits', () => {
    it('inserts new coverage_units rows anchored to the given commit SHA', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const dumpId = randomUUID();

      const { unitCount, unresolvedCount } = await upsertCoverageUnits(
        dumpId,
        commitSha,
        'node-v8',
        [makeUnit()],
      );

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

      await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [makeUnit({ hitCount: 3 })]);
      await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [makeUnit({ hitCount: 2 })]);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(1);
      expect(stored[0].hitCount).toBe(5);
    });

    it('treats two null-branchId rows for the same unit as the same identity (COALESCE dedup)', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const functionUnit = makeUnit({ branchId: null, granularity: 'function', hitCount: 4 });

      await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [functionUnit]);
      await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [
        { ...functionUnit, hitCount: 6 },
      ]);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(1);
      expect(stored[0].hitCount).toBe(10);
    });

    it('keeps distinct branchIds under the same unitKey as separate rows', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

      await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [
        makeUnit({ branchId: '0:0' }),
        makeUnit({ branchId: '0:1' }),
      ]);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(2);
    });

    it('persists resolved=false rows with their unresolvedReason rather than dropping them', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

      const { unresolvedCount } = await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [
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
      await upsertCoverageUnits(dumpId, commitSha, 'node-v8', [makeUnit()]);
      expect(await isDumpAlreadyIngested(dumpId)).toBe(true);

      await pool.query('DELETE FROM coverage_ingested_dumps WHERE dump_id = $1', [dumpId]);
    });
  });

  describe('pruneCoverageUnits', () => {
    it('deletes only rows whose last_seen_at is older than the retention window', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [makeUnit()]);

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
      await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [makeUnit()]);

      await pruneCoverageUnits(30);

      const stored = await findCoverageUnitsByCommitSha(commitSha);
      expect(stored).toHaveLength(1);
    });
  });
});
