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

    it('keeps two DIFFERENT files sharing the same unitKey/branchId as distinct links, not merged into one row (Greptile PR feedback)', async () => {
      // Regression test: coverage_test_links_identity_idx originally omitted
      // file_path from its unique index/ON CONFLICT target, so two
      // different files that happen to share the same structural unitKey
      // (e.g. two trivially-identical one-line functions) at the same
      // commit, covered by the same test, would collapse into ONE row —
      // silently dropping one file's coverage relationship from
      // findUnitsForTest. file_path is now part of the identity.
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const testId = 'spec:cross-file.spec.ts::test';
      const sharedUnitKey = 'identity#deadbeef00000000';

      await linkAndCommit(commitSha, testId, null, [
        makeLink({ filePath: `${FILE_PREFIX}/fileA.ts`, unitKey: sharedUnitKey, hitCount: 3 }),
        makeLink({ filePath: `${FILE_PREFIX}/fileB.ts`, unitKey: sharedUnitKey, hitCount: 5 }),
      ]);

      const found = await findUnitsForTest(commitSha, testId);
      expect(found).toHaveLength(2);
      const byFile = new Map(found.map((link) => [link.filePath, link]));
      expect(byFile.get(`${FILE_PREFIX}/fileA.ts`)?.hitCount).toBe(3);
      expect(byFile.get(`${FILE_PREFIX}/fileB.ts`)?.hitCount).toBe(5);
    });

    it('keeps two links whose filePath/unitKey pairs share a delimited-string collision as distinct (Greptile PR feedback)', async () => {
      // Regression test: collapseDuplicateIdentities' in-batch dedup key
      // used to be a plain `${filePath} ${unitKey} ${branchId}` join, so
      // filePath "a b" + unitKey "c" and filePath "a" + unitKey "b c" both
      // serialized to "a b c " and were wrongly merged into one link before
      // ever reaching the database's own (correctly file_path-aware) unique
      // index — silently dropping one of the two covered units from
      // findUnitsForTest. The key is now a JSON-encoded tuple, which cannot
      // collide this way.
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const testId = 'spec:delimiter-collision.spec.ts::test';

      await linkAndCommit(commitSha, testId, null, [
        makeLink({ filePath: `${FILE_PREFIX}/a b`, unitKey: 'c#0000000000000000', hitCount: 2 }),
        makeLink({ filePath: `${FILE_PREFIX}/a`, unitKey: 'b c#0000000000000000', hitCount: 7 }),
      ]);

      const found = await findUnitsForTest(commitSha, testId);
      expect(found).toHaveLength(2);
      const byUnitKey = new Map(found.map((link) => [link.unitKey, link]));
      expect(byUnitKey.get('c#0000000000000000')?.hitCount).toBe(2);
      expect(byUnitKey.get('b c#0000000000000000')?.hitCount).toBe(7);
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
