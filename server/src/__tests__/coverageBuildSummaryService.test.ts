/**
 * Integration tests for coverageBuildSummaryService. (MINCRM-629/630/631)
 *
 * Runs against a real PostgreSQL test database, exercising
 * upsertBuildSummaryForCommit directly with a standalone pool client — the
 * same pattern coverageMappingService.test.ts uses, since production
 * callers only ever invoke it as coverageIngestionService's
 * onUnitsUpserted callback inside an already-open transaction.
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import {
  upsertBuildSummaryForCommit,
  findBuildSummaryByCommitSha,
  findRecentBuildSummaries,
} from '../services/coverageBuildSummaryService.js';
import coverageDb from '../coverageDb.js';

const FILE_PREFIX = 'coverage-build-summary-svc';

interface UnitInput {
  filePath: string;
  unitKey: string;
  branchId: string | null;
  granularity: 'branch' | 'function';
  agent: 'node-v8' | 'browser-istanbul';
  hitCount: number;
}

async function insertUnits(commitSha: string, units: UnitInput[]): Promise<void> {
  for (const unit of units) {
    await coverageDb.query(
      `INSERT INTO coverage_units
         (commit_sha, file_path, unit_key, branch_id, granularity, agent, hit_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        commitSha,
        unit.filePath,
        unit.unitKey,
        unit.branchId,
        unit.granularity,
        unit.agent,
        unit.hitCount,
      ],
    );
  }
}

async function insertTestLink(
  commitSha: string,
  testId: string,
  unit: { filePath: string; unitKey: string; branchId: string | null; hitCount: number },
): Promise<void> {
  await coverageDb.query(
    `INSERT INTO coverage_test_links
       (commit_sha, unit_key, branch_id, file_path, test_id, hit_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [commitSha, unit.unitKey, unit.branchId, unit.filePath, testId, unit.hitCount],
  );
}

async function insertSessionAndDump(params: {
  source: 'automated-e2e' | 'manual';
  testId: string;
}): Promise<string> {
  const sessionResult = await coverageDb.query<{ id: string }>(
    `INSERT INTO coverage_sessions (label, source, build_sha, environment)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [`${FILE_PREFIX} session`, params.source, `${FILE_PREFIX}-sha`, 'test'],
  );
  const sessionId = sessionResult.rows[0].id;

  await coverageDb.query(
    `INSERT INTO coverage_session_dumps (session_id, dump_id, correlation_id, test_id)
     VALUES ($1, $2, gen_random_uuid(), $3)`,
    [sessionId, randomUUID(), params.testId],
  );

  return sessionId;
}

async function upsertAndCommit(commitSha: string): Promise<void> {
  const client = await coverageDb.connect();
  try {
    await client.query('BEGIN');
    await upsertBuildSummaryForCommit(client, commitSha);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixtures(): Promise<void> {
  await coverageDb.query('DELETE FROM coverage_build_summary WHERE commit_sha LIKE $1', [
    `${FILE_PREFIX}-%`,
  ]);
  await coverageDb.query('DELETE FROM coverage_test_links WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
  await coverageDb.query('DELETE FROM coverage_session_dumps WHERE test_id LIKE $1', [
    `${FILE_PREFIX}::%`,
  ]);
  await coverageDb.query('DELETE FROM coverage_sessions WHERE label = $1', [
    `${FILE_PREFIX} session`,
  ]);
  await coverageDb.query('DELETE FROM coverage_units WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
}

beforeEach(cleanupFixtures);
afterAll(cleanupFixtures);

describe('coverageBuildSummaryService', () => {
  describe('upsertBuildSummaryForCommit', () => {
    it('computes per-tier unit and covered-unit counts from coverage_units', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

      await insertUnits(commitSha, [
        {
          filePath: `${FILE_PREFIX}/server.ts`,
          unitKey: 'handler#1',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 3,
        },
        {
          filePath: `${FILE_PREFIX}/server.ts`,
          unitKey: 'unused#2',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 0,
        },
        {
          filePath: `${FILE_PREFIX}/Widget.tsx`,
          unitKey: 'render#3',
          branchId: null,
          granularity: 'function',
          agent: 'browser-istanbul',
          hitCount: 1,
        },
      ]);

      await upsertAndCommit(commitSha);

      const summary = await findBuildSummaryByCommitSha(commitSha);
      expect(summary).toMatchObject({
        commitSha,
        apiUnitCount: 2,
        apiCoveredUnitCount: 1,
        frontendUnitCount: 1,
        frontendCoveredUnitCount: 1,
      });
    });

    it('counts a covered unit toward automatedCoveredUnitCount when hit by an automated-e2e session', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const testId = `${FILE_PREFIX}::automated-test`;
      const unit = {
        filePath: `${FILE_PREFIX}/deals.ts`,
        unitKey: 'createDeal#1',
        branchId: null,
        hitCount: 2,
      };

      await insertUnits(commitSha, [
        { ...unit, granularity: 'function', agent: 'node-v8' as const },
      ]);
      await insertSessionAndDump({ source: 'automated-e2e', testId });
      await insertTestLink(commitSha, testId, unit);

      await upsertAndCommit(commitSha);

      const summary = await findBuildSummaryByCommitSha(commitSha);
      expect(summary?.automatedCoveredUnitCount).toBe(1);
      expect(summary?.manualCoveredUnitCount).toBe(0);
    });

    it('counts a covered unit toward manualCoveredUnitCount when hit by a manual session', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const testId = `${FILE_PREFIX}::manual-test`;
      const unit = {
        filePath: `${FILE_PREFIX}/deals.ts`,
        unitKey: 'createDeal#1',
        branchId: null,
        hitCount: 2,
      };

      await insertUnits(commitSha, [
        { ...unit, granularity: 'function', agent: 'node-v8' as const },
      ]);
      await insertSessionAndDump({ source: 'manual', testId });
      await insertTestLink(commitSha, testId, unit);

      await upsertAndCommit(commitSha);

      const summary = await findBuildSummaryByCommitSha(commitSha);
      expect(summary?.manualCoveredUnitCount).toBe(1);
      expect(summary?.automatedCoveredUnitCount).toBe(0);
    });

    it('is idempotent: re-running for the same commit recomputes rather than double-counting', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

      await insertUnits(commitSha, [
        {
          filePath: `${FILE_PREFIX}/server.ts`,
          unitKey: 'handler#1',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 1,
        },
      ]);

      await upsertAndCommit(commitSha);
      await upsertAndCommit(commitSha);

      const summary = await findBuildSummaryByCommitSha(commitSha);
      expect(summary?.apiUnitCount).toBe(1);
      expect(summary?.apiCoveredUnitCount).toBe(1);
    });

    it('reflects newly-ingested units on a subsequent call for the same commit', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;

      await insertUnits(commitSha, [
        {
          filePath: `${FILE_PREFIX}/server.ts`,
          unitKey: 'handler#1',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 1,
        },
      ]);
      await upsertAndCommit(commitSha);

      await insertUnits(commitSha, [
        {
          filePath: `${FILE_PREFIX}/server.ts`,
          unitKey: 'handler#2',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 1,
        },
      ]);
      await upsertAndCommit(commitSha);

      const summary = await findBuildSummaryByCommitSha(commitSha);
      expect(summary?.apiUnitCount).toBe(2);
    });
  });

  describe('findBuildSummaryByCommitSha', () => {
    it('returns null for a commit with no summary row', async () => {
      const summary = await findBuildSummaryByCommitSha(`${FILE_PREFIX}-${randomUUID()}`);
      expect(summary).toBeNull();
    });
  });

  describe('findRecentBuildSummaries', () => {
    it('returns summaries ordered most-recently-ingested first', async () => {
      const commitShaA = `${FILE_PREFIX}-${randomUUID()}`;
      const commitShaB = `${FILE_PREFIX}-${randomUUID()}`;

      await insertUnits(commitShaA, [
        {
          filePath: `${FILE_PREFIX}/a.ts`,
          unitKey: 'a#1',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 1,
        },
      ]);
      await upsertAndCommit(commitShaA);

      await insertUnits(commitShaB, [
        {
          filePath: `${FILE_PREFIX}/b.ts`,
          unitKey: 'b#1',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 1,
        },
      ]);
      await upsertAndCommit(commitShaB);

      const summaries = await findRecentBuildSummaries(500);
      const shas = summaries.map((summary) => summary.commitSha);
      expect(shas.indexOf(commitShaB)).toBeLessThan(shas.indexOf(commitShaA));
    });

    it('clamps an out-of-range limit rather than erroring', async () => {
      const summaries = await findRecentBuildSummaries(999_999);
      expect(summaries.length).toBeLessThanOrEqual(500);
    });
  });
});
