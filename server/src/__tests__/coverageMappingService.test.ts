/**
 * Integration tests for coverageMappingService. (MINCRM-618)
 *
 * Runs against a real PostgreSQL test database, exercising
 * linkCoverageUnitsToTest directly with a standalone pool client — the same
 * pattern coverageModelService.test.ts uses for upsertCoverageUnits — since
 * production callers only ever invoke it as coverageIngestionService's
 * onUnitsUpserted callback inside an already-open transaction.
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import {
  findTestsForUnit,
  findUnitsForTest,
  linkCoverageUnitsToTest,
} from '../services/coverageMappingService.js';
import type { CoverageTestLinkInput } from '../services/coverageMappingService.js';
import coverageDb from '../coverageDb.js';

const FILE_PREFIX = 'coverage-mapping-svc';

function makeLink(overrides: Partial<CoverageTestLinkInput> = {}): CoverageTestLinkInput {
  return {
    unitKey: 'render#abc123',
    branchId: '0:0',
    filePath: `${FILE_PREFIX}/widget.ts`,
    hitCount: 1,
    ...overrides,
  };
}

async function linkAndCommit(
  commitSha: string,
  testId: string,
  testName: string | null,
  links: CoverageTestLinkInput[],
): Promise<void> {
  const client = await coverageDb.connect();
  try {
    await client.query('BEGIN');
    await linkCoverageUnitsToTest(client, commitSha, testId, testName, links);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

beforeEach(async () => {
  await coverageDb.query('DELETE FROM coverage_test_links WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
});

afterAll(async () => {
  await coverageDb.query('DELETE FROM coverage_test_links WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
});

describe('coverageMappingService', () => {
  describe('linkCoverageUnitsToTest + findUnitsForTest', () => {
    it('links units to a test and finds them by test ID', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const testId = 'spec:deals.spec.ts::creates a deal';

      await linkAndCommit(commitSha, testId, 'creates a deal', [makeLink({ hitCount: 4 })]);

      const found = await findUnitsForTest(commitSha, testId);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        commitSha,
        unitKey: 'render#abc123',
        branchId: '0:0',
        testId,
        testName: 'creates a deal',
        hitCount: 4,
      });
    });

    it('collapses two links sharing the same identity WITHIN one call rather than erroring on a same-statement ON CONFLICT collision', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const testId = 'spec:collision.spec.ts::test';

      await linkAndCommit(commitSha, testId, null, [
        makeLink({ hitCount: 3 }),
        makeLink({ hitCount: 5 }),
      ]);

      const found = await findUnitsForTest(commitSha, testId);
      expect(found).toHaveLength(1);
      expect(found[0].hitCount).toBe(8);
    });

    it('merges (dedups) repeated linking of the same identity by accumulating hit_count', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const testId = 'spec:dedup.spec.ts::test';

      await linkAndCommit(commitSha, testId, null, [makeLink({ hitCount: 3 })]);
      await linkAndCommit(commitSha, testId, null, [makeLink({ hitCount: 2 })]);

      const found = await findUnitsForTest(commitSha, testId);
      expect(found).toHaveLength(1);
      expect(found[0].hitCount).toBe(5);
    });

    it('updates test_name on a later call when a prior call had none', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const testId = 'spec:rename.spec.ts::test';

      await linkAndCommit(commitSha, testId, null, [makeLink()]);
      await linkAndCommit(commitSha, testId, 'now named', [makeLink()]);

      const found = await findUnitsForTest(commitSha, testId);
      expect(found[0].testName).toBe('now named');
    });

    it('treats a null branch_id and an unrelated function-granularity unit as distinct identities', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const testId = 'spec:granularity.spec.ts::test';

      await linkAndCommit(commitSha, testId, null, [
        makeLink({ unitKey: 'add#def456', branchId: null, hitCount: 1 }),
      ]);

      const found = await findUnitsForTest(commitSha, testId);
      expect(found).toHaveLength(1);
      expect(found[0].branchId).toBeNull();
    });
  });

  describe('findTestsForUnit', () => {
    it('finds every test that covers a given unit', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const unitKey = 'shared#shared123';

      await linkAndCommit(commitSha, 'spec:a.spec.ts::a', 'test a', [
        makeLink({ unitKey, branchId: '0:0' }),
      ]);
      await linkAndCommit(commitSha, 'spec:b.spec.ts::b', 'test b', [
        makeLink({ unitKey, branchId: '0:0' }),
      ]);

      const found = await findTestsForUnit(commitSha, unitKey, '0:0');
      expect(found.map((link) => link.testId).sort()).toEqual([
        'spec:a.spec.ts::a',
        'spec:b.spec.ts::b',
      ]);
    });

    it('returns an empty array when no test covers the given unit', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const found = await findTestsForUnit(commitSha, 'nonexistent#000', null);
      expect(found).toHaveLength(0);
    });
  });
});
