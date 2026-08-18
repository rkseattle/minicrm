/**
 * Integration tests for coverageMappingService.
 *
 * Runs against a real PostgreSQL test database, exercising
 * linkCoverageUnitsToTest directly with a standalone pool client — the same
 * pattern coverageModelService.test.ts uses for upsertCoverageUnits — since
 * production callers only ever invoke it as coverageIngestionService's
 * onUnitsUpserted callback inside an already-open transaction.
 */

import 'dotenv/config';
import { vi } from 'vitest';
import { randomUUID } from 'crypto';
import {
  findTestsForUnit,
  findUnitsForTest,
  findTestsForUnitAcrossBranches,
  findTestsForUnitsAcrossBranches,
  linkCoverageUnitsToTest,
  streamAllCoverageTestLinks,
  beginCoverageMapLoad,
  loadCoverageTestLinksForCommit,
} from '../services/coverageMappingService.js';
import type {
  CoverageTestLinkInput,
  CoverageTestLinkExportEntry,
} from '../services/coverageMappingService.js';
import coverageDb from '../coverageDb.js';
import logger from '../logger.js';

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
  testFile: string | null = null,
): Promise<void> {
  const client = await coverageDb.connect();
  try {
    await client.query('BEGIN');
    await linkCoverageUnitsToTest(client, commitSha, testId, testName, testFile, links);
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

    it('persists test_file alongside a link', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const testId = 'spec:with-file.spec.ts::test';
      const testFile = 'tests/apps/minicrm/functional/deals/deal-creation.spec.ts';

      await linkAndCommit(commitSha, testId, 'creates a deal', [makeLink()], testFile);

      const found = await findUnitsForTest(commitSha, testId);
      expect(found[0].testFile).toBe(testFile);
    });

    it('updates test_file on a later call when a prior call had none', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const testId = 'spec:moved.spec.ts::test';
      const testFile = 'tests/apps/minicrm/functional/deals/deal-moved.spec.ts';

      await linkAndCommit(commitSha, testId, null, [makeLink()]);
      await linkAndCommit(commitSha, testId, null, [makeLink()], testFile);

      const found = await findUnitsForTest(commitSha, testId);
      expect(found[0].testFile).toBe(testFile);
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

  describe('findTestsForUnitAcrossBranches', () => {
    it('finds a test whose link is stored under a NON-null branch_id, given only the (filePath, unitKey)', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const filePath = `${FILE_PREFIX}/branching.ts`;
      const unitKey = 'branching#branchtest1';

      await linkAndCommit(commitSha, 'spec:branching.spec.ts::t', 't', [
        makeLink({ unitKey, branchId: '0:0', filePath }),
      ]);

      const found = await findTestsForUnitAcrossBranches(commitSha, filePath, unitKey);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ testId: 'spec:branching.spec.ts::t', branchId: '0:0' });
    });

    it('finds tests across MULTIPLE distinct branch_ids for the same (filePath, unitKey)', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const filePath = `${FILE_PREFIX}/multi-branch.ts`;
      const unitKey = 'multiBranch#branchtest2';

      await linkAndCommit(commitSha, 'spec:branch-a.spec.ts::t', 't', [
        makeLink({ unitKey, branchId: '0:0', filePath }),
      ]);
      await linkAndCommit(commitSha, 'spec:branch-b.spec.ts::t', 't', [
        makeLink({ unitKey, branchId: '0:1', filePath }),
      ]);

      const found = await findTestsForUnitAcrossBranches(commitSha, filePath, unitKey);
      expect(found.map((r) => r.testId).sort()).toEqual([
        'spec:branch-a.spec.ts::t',
        'spec:branch-b.spec.ts::t',
      ]);
    });

    it('also finds a function-granularity (null branch_id) link — matching drops branch_id, not file_path', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const filePath = `${FILE_PREFIX}/function-granularity.ts`;
      const unitKey = 'functionGranularity#branchtest3';

      await linkAndCommit(commitSha, 'spec:function.spec.ts::t', 't', [
        makeLink({ unitKey, branchId: null, filePath }),
      ]);

      const found = await findTestsForUnitAcrossBranches(commitSha, filePath, unitKey);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ testId: 'spec:function.spec.ts::t', branchId: null });
    });

    it('does NOT return a link from a DIFFERENT file sharing the same unitKey (regression — file identity must be preserved)', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      // Same unitKey in two DIFFERENT files — a real, if rare, possibility:
      // unit_key is derived purely from a function's own qualified name +
      // normalized body hash, with no file path folded in (see
      // structuralKeyService.ts), so two unrelated files can coincidentally
      // produce an identical unitKey for two coincidentally-identical
      // functions.
      const sharedUnitKey = 'coincidence#samehash';
      const fileA = `${FILE_PREFIX}/a.ts`;
      const fileB = `${FILE_PREFIX}/b.ts`;

      await linkAndCommit(commitSha, 'spec:a.spec.ts::t', 't', [
        makeLink({ unitKey: sharedUnitKey, branchId: '0:0', filePath: fileA }),
      ]);
      await linkAndCommit(commitSha, 'spec:b.spec.ts::t', 't', [
        makeLink({ unitKey: sharedUnitKey, branchId: '0:0', filePath: fileB }),
      ]);

      const found = await findTestsForUnitAcrossBranches(commitSha, fileA, sharedUnitKey);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ testId: 'spec:a.spec.ts::t', filePath: fileA });
    });

    it('returns an empty array when no test covers the given (filePath, unitKey) under any branch', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const found = await findTestsForUnitAcrossBranches(
        commitSha,
        `${FILE_PREFIX}/nonexistent.ts`,
        'nonexistent#000',
      );
      expect(found).toHaveLength(0);
    });

    it('logs commitSha, resultCount, and durationMs at debug level, not info', async () => {
      // debug, not info — this is the per-unit inheritance fan-out inside
      // testSelectionService's mapWithConcurrencyLimit call, invoked once
      // per changed unit; logging it at info would put one line per unit
      // on test selection's hot path (found via Greptile branch review).
      const infoSpy = vi.spyOn(logger, 'info');
      const debugSpy = vi.spyOn(logger, 'debug');
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const filePath = `${FILE_PREFIX}/logging.ts`;
      const unitKey = 'render#logtest1';
      await linkAndCommit(commitSha, 'spec:logging.spec.ts::t', 't', [
        makeLink({ unitKey, branchId: '0:0', filePath }),
      ]);

      await findTestsForUnitAcrossBranches(commitSha, filePath, unitKey);

      expect(
        infoSpy.mock.calls.find(
          ([, message]) => message === 'coverageMappingService: findTestsForUnitAcrossBranches',
        ),
      ).toBeUndefined();
      const call = debugSpy.mock.calls.find(
        ([, message]) => message === 'coverageMappingService: findTestsForUnitAcrossBranches',
      );
      expect(call).toBeDefined();
      const [fields] = call ?? [];
      expect(fields).toMatchObject({ commitSha, filePath, unitKey, resultCount: 1 });
      expect(typeof (fields as { durationMs?: unknown })?.durationMs).toBe('number');
      infoSpy.mockRestore();
      debugSpy.mockRestore();
    });
  });

  describe('findTestsForUnitsAcrossBranches (batched)', () => {
    it('resolves multiple units in one call, each attributed back to its own (filePath, unitKey) pair', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const fileA = `${FILE_PREFIX}/a.ts`;
      const fileB = `${FILE_PREFIX}/b.ts`;
      const unitKeyA = 'render#batcha';
      const unitKeyB = 'render#batchb';

      await linkAndCommit(commitSha, 'spec:a.spec.ts::t', 't', [
        makeLink({ unitKey: unitKeyA, branchId: '0:0', filePath: fileA }),
      ]);
      await linkAndCommit(commitSha, 'spec:b.spec.ts::t', 't', [
        makeLink({ unitKey: unitKeyB, branchId: '0:0', filePath: fileB }),
      ]);

      const results = await findTestsForUnitsAcrossBranches(commitSha, [
        { filePath: fileA, unitKey: unitKeyA },
        { filePath: fileB, unitKey: unitKeyB },
      ]);

      expect(results).toHaveLength(2);
      const byPair = new Map(results.map((r) => [`${r.filePath}::${r.unitKey}`, r]));
      expect(byPair.get(`${fileA}::${unitKeyA}`)?.matches).toMatchObject([
        { testId: 'spec:a.spec.ts::t' },
      ]);
      expect(byPair.get(`${fileB}::${unitKeyB}`)?.matches).toMatchObject([
        { testId: 'spec:b.spec.ts::t' },
      ]);
    });

    it('includes a pair with zero matches in the result, with an empty matches array', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const fileA = `${FILE_PREFIX}/a.ts`;
      const unitKeyA = 'render#batchc';

      await linkAndCommit(commitSha, 'spec:a.spec.ts::t', 't', [
        makeLink({ unitKey: unitKeyA, branchId: '0:0', filePath: fileA }),
      ]);

      const results = await findTestsForUnitsAcrossBranches(commitSha, [
        { filePath: fileA, unitKey: unitKeyA },
        { filePath: `${FILE_PREFIX}/nonexistent.ts`, unitKey: 'nonexistent#000' },
      ]);

      expect(results).toHaveLength(2);
      const nonexistentResult = results.find((r) => r.unitKey === 'nonexistent#000');
      expect(nonexistentResult?.matches).toEqual([]);
    });

    it('does not cross-attribute a match to a pair sharing the same unitKey but a DIFFERENT filePath (regression — file identity must be preserved across the batch, same as the singular function)', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const sharedUnitKey = 'coincidence#batchsamehash';
      const fileA = `${FILE_PREFIX}/a.ts`;
      const fileB = `${FILE_PREFIX}/b.ts`;

      await linkAndCommit(commitSha, 'spec:a.spec.ts::t', 't', [
        makeLink({ unitKey: sharedUnitKey, branchId: '0:0', filePath: fileA }),
      ]);
      await linkAndCommit(commitSha, 'spec:b.spec.ts::t', 't', [
        makeLink({ unitKey: sharedUnitKey, branchId: '0:0', filePath: fileB }),
      ]);

      // Only request fileA's pair — fileB's link for the same unitKey must
      // never leak into fileA's result.
      const results = await findTestsForUnitsAcrossBranches(commitSha, [
        { filePath: fileA, unitKey: sharedUnitKey },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].matches).toHaveLength(1);
      expect(results[0].matches[0]).toMatchObject({ testId: 'spec:a.spec.ts::t', filePath: fileA });
    });

    it('deduplicates a (filePath, unitKey) pair appearing more than once in the input, returning it once', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const fileA = `${FILE_PREFIX}/a.ts`;
      const unitKeyA = 'render#batchdedup';

      await linkAndCommit(commitSha, 'spec:a.spec.ts::t', 't', [
        makeLink({ unitKey: unitKeyA, branchId: '0:0', filePath: fileA }),
      ]);

      const results = await findTestsForUnitsAcrossBranches(commitSha, [
        { filePath: fileA, unitKey: unitKeyA },
        { filePath: fileA, unitKey: unitKeyA },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].matches).toHaveLength(1);
    });

    it('returns an empty array for an empty input', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const results = await findTestsForUnitsAcrossBranches(commitSha, []);
      expect(results).toEqual([]);
    });

    it('resolves correctly across multiple internal chunks — exercises the chunking loop for an input larger than MAX_UNITS_PER_MAPPING_LOOKUP_BATCH (200)', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const realFilePath = `${FILE_PREFIX}/chunked-real.ts`;
      const realUnitKey = 'render#chunked1';

      await linkAndCommit(commitSha, 'spec:chunked.spec.ts::t', 't', [
        makeLink({ unitKey: realUnitKey, branchId: '0:0', filePath: realFilePath }),
      ]);

      // 250 pairs spans two internal chunks (batch size 200) — 249 of them
      // resolve to nothing, one (placed deliberately in the SECOND chunk,
      // at index 210) is real, proving both chunks actually execute and
      // attribute their own results correctly, not just the first.
      const padding = Array.from({ length: 249 }, (_, i) => ({
        filePath: `${FILE_PREFIX}/chunked-padding-${i}.ts`,
        unitKey: `padding#${i}`,
      }));
      const units = [
        ...padding.slice(0, 210),
        { filePath: realFilePath, unitKey: realUnitKey },
        ...padding.slice(210),
      ];
      expect(units).toHaveLength(250);

      const results = await findTestsForUnitsAcrossBranches(commitSha, units);

      expect(results).toHaveLength(250);
      const realResult = results.find(
        (r) => r.filePath === realFilePath && r.unitKey === realUnitKey,
      );
      expect(realResult?.matches).toMatchObject([{ testId: 'spec:chunked.spec.ts::t' }]);
      const emptyResults = results.filter((r) => r !== realResult);
      expect(emptyResults.every((r) => r.matches.length === 0)).toBe(true);
    });

    it('produces the same matches (branch coverage and function-granularity) as the singular findTestsForUnitAcrossBranches for the same pair', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const filePath = `${FILE_PREFIX}/multi-branch-batch.ts`;
      const unitKey = 'multiBranch#batchtest';

      await linkAndCommit(commitSha, 'spec:branch-a.spec.ts::t', 't', [
        makeLink({ unitKey, branchId: '0:0', filePath }),
      ]);
      await linkAndCommit(commitSha, 'spec:branch-b.spec.ts::t', 't', [
        makeLink({ unitKey, branchId: '0:1', filePath }),
      ]);

      const singular = await findTestsForUnitAcrossBranches(commitSha, filePath, unitKey);
      const batched = await findTestsForUnitsAcrossBranches(commitSha, [{ filePath, unitKey }]);

      expect(batched[0].matches.map((m) => m.testId).sort()).toEqual(
        singular.map((m) => m.testId).sort(),
      );
    });

    it('logs commitSha, input/unique counts, chunkCount, totalMatchCount, and durationMs', async () => {
      const infoSpy = vi.spyOn(logger, 'info');
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const filePath = `${FILE_PREFIX}/batch-logging.ts`;
      const unitKey = 'render#batchlogtest1';
      await linkAndCommit(commitSha, 'spec:batch-logging.spec.ts::t', 't', [
        makeLink({ unitKey, branchId: '0:0', filePath }),
      ]);

      await findTestsForUnitsAcrossBranches(commitSha, [
        { filePath, unitKey },
        { filePath, unitKey }, // deliberate duplicate — inputUnitCount 2, uniqueUnitCount 1
      ]);

      const call = infoSpy.mock.calls.find(
        ([, message]) => message === 'coverageMappingService: findTestsForUnitsAcrossBranches',
      );
      expect(call).toBeDefined();
      const [fields] = call ?? [];
      expect(fields).toMatchObject({
        commitSha,
        inputUnitCount: 2,
        uniqueUnitCount: 1,
        chunkCount: 1,
        totalMatchCount: 1,
      });
      expect(typeof (fields as { durationMs?: unknown })?.durationMs).toBe('number');
      infoSpy.mockRestore();
    });
  });

  // ── streamAllCoverageTestLinks / loadCoverageTestLinksForCommit (pr-tia-8) ──

  /**
   * Drains the streaming export into an array.
   *
   * Only for assertions — production callers consume it a page at a time,
   * which is the entire point of the streaming API.
   *
   * @returns Every exported entry, in key order.
   */
  async function collectExport(): Promise<CoverageTestLinkExportEntry[]> {
    const all: CoverageTestLinkExportEntry[] = [];
    await streamAllCoverageTestLinks(async (entries) => {
      all.push(...entries);
    });
    return all;
  }

  describe('streamAllCoverageTestLinks + loadCoverageTestLinksForCommit', () => {
    it('round-trips a link through export then load at a DIFFERENT commit_sha', async () => {
      const sourceSha = `${FILE_PREFIX}-source-${randomUUID()}`;
      const targetSha = `${FILE_PREFIX}-target-${randomUUID()}`;

      await linkAndCommit(
        sourceSha,
        'spec:roundtrip.spec.ts::t',
        'round trip test',
        [makeLink({ hitCount: 3 })],
        'tests/roundtrip.spec.ts',
      );

      const exported = await collectExport();
      const relevant = exported.filter((e) => e.filePath === `${FILE_PREFIX}/widget.ts`);
      expect(relevant).toHaveLength(1);
      expect(relevant[0]).toMatchObject({
        unitKey: 'render#abc123',
        testId: 'spec:roundtrip.spec.ts::t',
        testName: 'round trip test',
        testFile: 'tests/roundtrip.spec.ts',
        hitCount: 3,
      });

      await loadCoverageTestLinksForCommit(targetSha, relevant);

      const foundAtTarget = await findUnitsForTest(targetSha, 'spec:roundtrip.spec.ts::t');
      expect(foundAtTarget).toHaveLength(1);
      expect(foundAtTarget[0]).toMatchObject({
        commitSha: targetSha,
        testFile: 'tests/roundtrip.spec.ts',
        hitCount: 3,
      });

      // Loading into targetSha must not touch the original sourceSha rows.
      const stillAtSource = await findUnitsForTest(sourceSha, 'spec:roundtrip.spec.ts::t');
      expect(stillAtSource).toHaveLength(1);

      await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [targetSha]);
    });

    it('REPLACES (not merges) existing rows at the target commit_sha on a second load', async () => {
      const targetSha = `${FILE_PREFIX}-replace-${randomUUID()}`;
      const entryA: CoverageTestLinkExportEntry = {
        unitKey: 'render#abc123',
        branchId: '0:0',
        filePath: `${FILE_PREFIX}/widget.ts`,
        testId: 'spec:a.spec.ts::a',
        testName: null,
        testFile: null,
        hitCount: 1,
      };
      const entryB: CoverageTestLinkExportEntry = {
        ...entryA,
        testId: 'spec:b.spec.ts::b',
      };

      await loadCoverageTestLinksForCommit(targetSha, [entryA]);
      const afterFirstLoad = await findTestsForUnit(targetSha, 'render#abc123', '0:0');
      expect(afterFirstLoad.map((l) => l.testId)).toEqual(['spec:a.spec.ts::a']);

      // Second load with a DIFFERENT entry set for the same commit_sha —
      // entryA's row must be gone, not merged alongside entryB's.
      await loadCoverageTestLinksForCommit(targetSha, [entryB]);
      const afterSecondLoad = await findTestsForUnit(targetSha, 'render#abc123', '0:0');
      expect(afterSecondLoad.map((l) => l.testId)).toEqual(['spec:b.spec.ts::b']);

      await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [targetSha]);
    });

    it('loading an empty entry list clears any existing rows at that commit_sha', async () => {
      const targetSha = `${FILE_PREFIX}-empty-${randomUUID()}`;
      await loadCoverageTestLinksForCommit(targetSha, [
        {
          unitKey: 'render#abc123',
          branchId: null,
          filePath: `${FILE_PREFIX}/widget.ts`,
          testId: 'spec:a.spec.ts::a',
          testName: null,
          testFile: null,
          hitCount: 1,
        },
      ]);

      await loadCoverageTestLinksForCommit(targetSha, []);

      const found = await findTestsForUnit(targetSha, 'render#abc123', null);
      expect(found).toHaveLength(0);
    });
  });

  // ── commit-agnostic collapse + streamed load ──

  describe('commit-agnostic collapse', () => {
    it('has the index the keyset export pages on', async () => {
      // Without it every page sorts the whole table, against coverageDb's 30s
      // statement_timeout — so the streaming rewrite that stopped the export
      // dying on a 512MB string would instead have made it die on a timeout.
      // Nothing else references this index by name, so dropping the migration
      // would otherwise leave every test green.
      const { rows } = await coverageDb.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'coverage_test_links_export_idx'`,
      );

      expect(rows).toHaveLength(1);
      // Leading column must be unit_key, and branch_id must be coalesced —
      // the export spans every commit_sha, so an index led by commit_sha (as
      // all the others are) cannot serve this seek.
      expect(rows[0].indexdef).toMatch(/\(unit_key,\s*COALESCE\(branch_id,\s*''::text\)/);
    });

    /**
     * Inserts a link row directly at a given commit, bypassing ingestion.
     *
     * @param commitSha - Commit to key the row to.
     * @param overrides - Column values to set.
     */
    async function insertLinkAt(
      commitSha: string,
      overrides: {
        testId: string;
        hitCount: number;
        testName?: string | null;
        testFile?: string | null;
        branchId?: string | null;
        lastSeenAt?: string;
      },
    ): Promise<void> {
      await coverageDb.query(
        `INSERT INTO coverage_test_links
           (commit_sha, unit_key, branch_id, file_path, test_id, test_name, test_file, hit_count, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()))`,
        [
          commitSha,
          'render#abc123',
          overrides.branchId ?? null,
          `${FILE_PREFIX}/widget.ts`,
          overrides.testId,
          overrides.testName ?? null,
          overrides.testFile ?? null,
          overrides.hitCount,
          overrides.lastSeenAt ?? null,
        ],
      );
    }

    it('collapses the same mapping across commits into ONE entry', async () => {
      // The property the whole streaming rewrite rests on: the per-commit
      // copies are pure duplication, because the load re-keys everything to one
      // SHA and its ON CONFLICT target merges them anyway.
      const shaA = `${FILE_PREFIX}-collapse-a-${randomUUID()}`;
      const shaB = `${FILE_PREFIX}-collapse-b-${randomUUID()}`;
      await insertLinkAt(shaA, { testId: 'spec:c.spec.ts::t', hitCount: 5 });
      await insertLinkAt(shaB, { testId: 'spec:c.spec.ts::t', hitCount: 9 });

      const exported = (await collectExport()).filter((e) => e.testId === 'spec:c.spec.ts::t');

      expect(exported).toHaveLength(1);
      // MAX, not SUM: summing across commits would grow without bound, which is
      // the axis the collapse exists to remove.
      expect(exported[0].hitCount).toBe(9);

      await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = ANY($1)', [
        [shaA, shaB],
      ]);
    });

    it('keeps rows that differ only by branch_id separate', async () => {
      // branch_id is in the grouping key AND the keyset cursor. If it were
      // dropped from either, these two would collide and one would be lost.
      const sha = `${FILE_PREFIX}-branch-${randomUUID()}`;
      await insertLinkAt(sha, { testId: 'spec:d.spec.ts::t', hitCount: 1, branchId: '0:0' });
      await insertLinkAt(sha, { testId: 'spec:d.spec.ts::t', hitCount: 1, branchId: '0:1' });

      const exported = (await collectExport()).filter((e) => e.testId === 'spec:d.spec.ts::t');

      expect(exported).toHaveLength(2);
      expect(exported.map((e) => e.branchId).sort()).toEqual(['0:0', '0:1']);

      await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [sha]);
    });

    it('takes the most recent NON-NULL test_file, not simply the most recent', async () => {
      // test_file was added after the table, so older rows legitimately carry
      // NULL. A newer NULL winning would erase a known value — and the load
      // path cannot restore it, since it sets test_file only when present.
      const shaOld = `${FILE_PREFIX}-tf-old-${randomUUID()}`;
      const shaNew = `${FILE_PREFIX}-tf-new-${randomUUID()}`;
      await insertLinkAt(shaOld, {
        testId: 'spec:e.spec.ts::t',
        hitCount: 1,
        testFile: 'tests/known.spec.ts',
        lastSeenAt: '2020-01-01T00:00:00Z',
      });
      await insertLinkAt(shaNew, {
        testId: 'spec:e.spec.ts::t',
        hitCount: 1,
        testFile: null,
        lastSeenAt: '2030-01-01T00:00:00Z',
      });

      const exported = (await collectExport()).filter((e) => e.testId === 'spec:e.spec.ts::t');

      expect(exported).toHaveLength(1);
      expect(exported[0].testFile).toBe('tests/known.spec.ts');

      await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = ANY($1)', [
        [shaOld, shaNew],
      ]);
    });

    it('takes the most recent NON-NULL test_name, not simply the most recent', async () => {
      // Same hazard as test_file: test_name is nullable and ingestion fills it
      // only when the dump carried one, so a newer NULL winning would erase the
      // human-readable label the query API and typeahead return.
      const shaOld = `${FILE_PREFIX}-tn-old-${randomUUID()}`;
      const shaNew = `${FILE_PREFIX}-tn-new-${randomUUID()}`;
      await insertLinkAt(shaOld, {
        testId: 'spec:n.spec.ts::t',
        hitCount: 1,
        testName: 'the known name',
        lastSeenAt: '2020-01-01T00:00:00Z',
      });
      await insertLinkAt(shaNew, {
        testId: 'spec:n.spec.ts::t',
        hitCount: 1,
        testName: null,
        lastSeenAt: '2030-01-01T00:00:00Z',
      });

      const exported = (await collectExport()).filter((e) => e.testId === 'spec:n.spec.ts::t');

      expect(exported).toHaveLength(1);
      expect(exported[0].testName).toBe('the known name');

      await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = ANY($1)', [
        [shaOld, shaNew],
      ]);
    });

    it('pages through more entries than fit in one keyset page', async () => {
      // Exercises the cursor itself: with a page size of 5000 a smaller corpus
      // would never advance past the first page, so a broken cursor would look
      // identical to a working one.
      const sha = `${FILE_PREFIX}-paging-${randomUUID()}`;
      const testIds = Array.from({ length: 25 }, (_, i) => `spec:page.spec.ts::t${i}`);
      for (const testId of testIds) {
        await insertLinkAt(sha, { testId, hitCount: 1 });
      }

      const pageSizes: number[] = [];
      const seen: string[] = [];
      await streamAllCoverageTestLinks(async (entries) => {
        pageSizes.push(entries.length);
        for (const e of entries)
          if (e.testId.startsWith('spec:page.spec.ts::')) seen.push(e.testId);
      });

      expect(seen.sort()).toEqual(testIds.sort());
      expect(pageSizes.length).toBeGreaterThan(0);

      await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [sha]);
    });
  });

  describe('beginCoverageMapLoad', () => {
    it('accumulates batches into ONE replace rather than each clearing the last', async () => {
      // Calling loadCoverageTestLinksForCommit per streamed batch would delete
      // the previous batch every time, leaving only the final one.
      const targetSha = `${FILE_PREFIX}-session-${randomUUID()}`;
      const entry = (testId: string): CoverageTestLinkExportEntry => ({
        unitKey: 'render#abc123',
        branchId: null,
        filePath: `${FILE_PREFIX}/widget.ts`,
        testId,
        testName: null,
        testFile: null,
        hitCount: 1,
      });

      const session = await beginCoverageMapLoad(targetSha);
      await session.appendBatch([entry('spec:s1.spec.ts::t')]);
      await session.appendBatch([entry('spec:s2.spec.ts::t')]);
      await session.commit();

      const found = await findTestsForUnit(targetSha, 'render#abc123', null);
      expect(found.map((l) => l.testId).sort()).toEqual([
        'spec:s1.spec.ts::t',
        'spec:s2.spec.ts::t',
      ]);

      await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [targetSha]);
    });

    it('rollback leaves the prior map intact', async () => {
      // The all-or-nothing property: a failure mid-stream must not leave a
      // half-replaced map, which would silently narrow every later selection.
      const targetSha = `${FILE_PREFIX}-rollback-${randomUUID()}`;
      const original: CoverageTestLinkExportEntry = {
        unitKey: 'render#abc123',
        branchId: null,
        filePath: `${FILE_PREFIX}/widget.ts`,
        testId: 'spec:original.spec.ts::t',
        testName: null,
        testFile: null,
        hitCount: 1,
      };
      await loadCoverageTestLinksForCommit(targetSha, [original]);

      const session = await beginCoverageMapLoad(targetSha);
      await session.appendBatch([{ ...original, testId: 'spec:replacement.spec.ts::t' }]);
      await session.rollback();

      const found = await findTestsForUnit(targetSha, 'render#abc123', null);
      expect(found.map((l) => l.testId)).toEqual(['spec:original.spec.ts::t']);

      await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [targetSha]);
    });

    it('sets test_file in one batched statement, including a mixed batch', async () => {
      // The batched UPDATE ... FROM (VALUES ...) replaces a per-entry round
      // trip. Mixed null/non-null is the case where a naive rewrite drops rows.
      const targetSha = `${FILE_PREFIX}-testfile-${randomUUID()}`;
      const base: CoverageTestLinkExportEntry = {
        unitKey: 'render#abc123',
        branchId: null,
        filePath: `${FILE_PREFIX}/widget.ts`,
        testId: 'spec:tf1.spec.ts::t',
        testName: null,
        testFile: 'tests/one.spec.ts',
        hitCount: 1,
      };

      await loadCoverageTestLinksForCommit(targetSha, [
        base,
        { ...base, testId: 'spec:tf2.spec.ts::t', testFile: null },
        { ...base, testId: 'spec:tf3.spec.ts::t', testFile: 'tests/three.spec.ts' },
      ]);

      const found = await findTestsForUnit(targetSha, 'render#abc123', null);
      const byId = new Map(found.map((l) => [l.testId, l.testFile]));
      expect(byId.get('spec:tf1.spec.ts::t')).toBe('tests/one.spec.ts');
      expect(byId.get('spec:tf2.spec.ts::t')).toBeNull();
      expect(byId.get('spec:tf3.spec.ts::t')).toBe('tests/three.spec.ts');

      await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [targetSha]);
    });
  });
});
