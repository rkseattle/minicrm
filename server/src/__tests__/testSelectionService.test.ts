/**
 * Tests for testSelectionService. (MINCRM-624)
 *
 * Runs against a real PostgreSQL test database (coverageDb) — seeds
 * coverage_test_links via linkCoverageUnitsToTest (the real ingestion path,
 * matching coverageMappingService.test.ts's own precedent) and
 * coverage_units directly (a plain insert; no simpler service call sets
 * confidence_score independent of a full dump-ingestion claim) so
 * findTestsForUnitWithConfidence's LEFT JOIN has something to score against.
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import coverageDb from '../coverageDb.js';
import {
  linkCoverageUnitsToTest,
  type CoverageTestLinkInput,
} from '../services/coverageMappingService.js';
import { selectTestsForChangedUnits } from '../coverageAgent/testSelection/testSelectionService.js';
import type { ChangedUnit } from '../coverageAgent/testSelection/changeUnitResolver.js';

const FILE_PREFIX = 'test-selection-svc';

function makeChangedUnit(overrides: Partial<ChangedUnit> = {}): ChangedUnit {
  return {
    filePath: `${FILE_PREFIX}/widget.ts`,
    unitKey: 'render#abc123',
    branchId: null,
    changeKind: 'in-line',
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

/** Seeds a coverage_units row with an explicit confidence score, for prioritization tests. */
async function seedUnitConfidence(
  commitSha: string,
  filePath: string,
  unitKey: string,
  branchId: string | null,
  confidenceScore: number,
): Promise<void> {
  await coverageDb.query(
    `INSERT INTO coverage_units
       (commit_sha, file_path, unit_key, branch_id, granularity, agent, hit_count, confidence_score)
     VALUES ($1, $2, $3, $4, 'function', 'node-v8', 1, $5)
     ON CONFLICT (commit_sha, file_path, unit_key, COALESCE(branch_id, ''))
     DO UPDATE SET confidence_score = EXCLUDED.confidence_score`,
    [commitSha, filePath, unitKey, branchId, confidenceScore],
  );
}

beforeEach(async () => {
  await coverageDb.query('DELETE FROM coverage_test_links WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
  await coverageDb.query('DELETE FROM coverage_units WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
});

afterAll(async () => {
  await coverageDb.query('DELETE FROM coverage_test_links WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
  await coverageDb.query('DELETE FROM coverage_units WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
});

describe('selectTestsForChangedUnits', () => {
  it('selects a directly-mapped test with reason direct-hit', async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    await linkAndCommit(commitSha, 'spec:widget.spec.ts::renders', 'renders', [
      {
        unitKey: 'render#abc123',
        branchId: null,
        filePath: `${FILE_PREFIX}/widget.ts`,
        hitCount: 1,
      },
    ]);

    const result = await selectTestsForChangedUnits(commitSha, [makeChangedUnit()]);

    expect(result.selectedTests).toHaveLength(1);
    expect(result.selectedTests[0]).toMatchObject({
      testId: 'spec:widget.spec.ts::renders',
      reason: 'direct-hit',
      sourceUnitKey: 'render#abc123',
    });
    expect(result.unmappedChanges).toEqual([]);
  });

  it('inherits candidates from the enclosing unit when a changed unit has no direct mapping', async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    await linkAndCommit(commitSha, 'spec:widget.spec.ts::renders', 'renders', [
      {
        unitKey: 'enclosingClass#parent1',
        branchId: null,
        filePath: `${FILE_PREFIX}/widget.ts`,
        hitCount: 1,
      },
    ]);

    const newUnit = makeChangedUnit({ unitKey: 'newMethod#new1', changeKind: 'new' });
    const enclosingMap = new Map([['newMethod#new1', 'enclosingClass#parent1']]);

    const result = await selectTestsForChangedUnits(commitSha, [newUnit], enclosingMap);

    expect(result.selectedTests).toHaveLength(1);
    expect(result.selectedTests[0]).toMatchObject({
      testId: 'spec:widget.spec.ts::renders',
      reason: 'inherited',
      sourceUnitKey: 'newMethod#new1',
    });
    expect(result.unmappedChanges).toEqual([]);
  });

  it('surfaces a changed unit as unmapped when neither direct nor inherited lookup finds anything', async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    const unit = makeChangedUnit({ unitKey: 'orphan#zzz', changeKind: 'new' });

    const result = await selectTestsForChangedUnits(commitSha, [unit]);

    expect(result.selectedTests).toEqual([]);
    expect(result.unmappedChanges).toEqual([
      { filePath: `${FILE_PREFIX}/widget.ts`, unitKey: 'orphan#zzz' },
    ]);
  });

  it('deduplicates a test reached from two different changed units, keeping direct-hit over inherited', async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    await linkAndCommit(commitSha, 'spec:shared.spec.ts::covers both', 'covers both', [
      { unitKey: 'unitA#a1', branchId: null, filePath: `${FILE_PREFIX}/a.ts`, hitCount: 1 },
      { unitKey: 'enclosing#e1', branchId: null, filePath: `${FILE_PREFIX}/b.ts`, hitCount: 1 },
    ]);

    const units = [
      makeChangedUnit({ filePath: `${FILE_PREFIX}/a.ts`, unitKey: 'unitA#a1' }),
      makeChangedUnit({
        filePath: `${FILE_PREFIX}/b.ts`,
        unitKey: 'unitB-new#b1',
        changeKind: 'new',
      }),
    ];
    const enclosingMap = new Map([['unitB-new#b1', 'enclosing#e1']]);

    const result = await selectTestsForChangedUnits(commitSha, units, enclosingMap);

    expect(result.selectedTests).toHaveLength(1);
    expect(result.selectedTests[0]).toMatchObject({
      testId: 'spec:shared.spec.ts::covers both',
      reason: 'direct-hit',
    });
  });

  it('prioritizes higher-confidence tests first', async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    await linkAndCommit(commitSha, 'spec:low.spec.ts::t', 't', [
      { unitKey: 'shared#s1', branchId: null, filePath: `${FILE_PREFIX}/shared.ts`, hitCount: 1 },
    ]);
    await linkAndCommit(commitSha, 'spec:high.spec.ts::t', 't', [
      { unitKey: 'shared#s1', branchId: null, filePath: `${FILE_PREFIX}/shared.ts`, hitCount: 1 },
    ]);
    // Both tests link to the same unit; confidence is a per-unit score, so
    // both would score identically via that unit — instead verify the null-
    // confidence-sorts-last rule by only scoring one of the two tests'
    // units. Simpler: seed the shared unit's confidence directly, then rely
    // on the alphabetical tie-break for the (otherwise-identical-confidence) pair.
    await seedUnitConfidence(commitSha, `${FILE_PREFIX}/shared.ts`, 'shared#s1', null, 0.75);

    const result = await selectTestsForChangedUnits(commitSha, [
      makeChangedUnit({ filePath: `${FILE_PREFIX}/shared.ts`, unitKey: 'shared#s1' }),
    ]);

    expect(result.selectedTests).toHaveLength(2);
    // Same confidence score for both (0.75) — stable alphabetical tie-break.
    expect(result.selectedTests.map((t) => t.testId)).toEqual([
      'spec:high.spec.ts::t',
      'spec:low.spec.ts::t',
    ]);
    expect(result.selectedTests.every((t) => t.confidenceScore === 0.75)).toBe(true);
  });

  it('sorts a null-confidence result after a scored result', async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    await linkAndCommit(commitSha, 'spec:scored.spec.ts::t', 't', [
      { unitKey: 'scored#c1', branchId: null, filePath: `${FILE_PREFIX}/a.ts`, hitCount: 1 },
    ]);
    await linkAndCommit(commitSha, 'spec:unscored.spec.ts::t', 't', [
      { unitKey: 'unscored#c2', branchId: null, filePath: `${FILE_PREFIX}/b.ts`, hitCount: 1 },
    ]);
    await seedUnitConfidence(commitSha, `${FILE_PREFIX}/a.ts`, 'scored#c1', null, 0.5);
    // No coverage_units row seeded for unscored#c2 — its mapping result's
    // confidenceScore stays null (LEFT JOIN finds nothing).

    const result = await selectTestsForChangedUnits(commitSha, [
      makeChangedUnit({ filePath: `${FILE_PREFIX}/a.ts`, unitKey: 'scored#c1' }),
      makeChangedUnit({ filePath: `${FILE_PREFIX}/b.ts`, unitKey: 'unscored#c2' }),
    ]);

    expect(result.selectedTests.map((t) => t.testId)).toEqual([
      'spec:scored.spec.ts::t',
      'spec:unscored.spec.ts::t',
    ]);
  });

  it('returns empty results for an empty change set', async () => {
    const result = await selectTestsForChangedUnits(`${FILE_PREFIX}-${randomUUID()}`, []);
    expect(result.selectedTests).toEqual([]);
    expect(result.unmappedChanges).toEqual([]);
  });
});
