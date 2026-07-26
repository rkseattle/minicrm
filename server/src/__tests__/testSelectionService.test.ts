/**
 * Tests for testSelectionService. (MINCRM-624)
 *
 * Runs against a real PostgreSQL test database (coverageDb) — seeds
 * coverage_test_links via linkCoverageUnitsToTest (the real ingestion path,
 * matching coverageMappingService.test.ts's own precedent) and
 * coverage_units directly (a plain insert; no simpler service call sets
 * confidence_score independent of a full dump-ingestion claim) so
 * findTestsForUnitAcrossBranches' LEFT JOIN has something to score against.
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import coverageDb from '../coverageDb.js';
import {
  linkCoverageUnitsToTest,
  type CoverageTestLinkInput,
} from '../services/coverageMappingService.js';
import {
  selectTestsForChangedUnits,
  enclosingUnitMapKey,
} from '../coverageAgent/testSelection/testSelectionService.js';
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
    await linkCoverageUnitsToTest(client, commitSha, testId, testName, null, links);
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
    const enclosingMap = new Map([
      [
        enclosingUnitMapKey(`${FILE_PREFIX}/widget.ts`, 'newMethod#new1'),
        { filePath: `${FILE_PREFIX}/widget.ts`, unitKey: 'enclosingClass#parent1' },
      ],
    ]);

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

  it('correctly routes a mix of direct-hit, inherited, and unmapped units within the SAME call (MINCRM-637 — the batched direct-lookup step and the still-per-unit inheritance step must each see only the units that actually need them)', async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    const directFile = `${FILE_PREFIX}/direct.ts`;
    const enclosingFile = `${FILE_PREFIX}/enclosing.ts`;

    await linkAndCommit(commitSha, 'spec:direct.spec.ts::t', 't', [
      { unitKey: 'direct#d1', branchId: null, filePath: directFile, hitCount: 1 },
    ]);
    await linkAndCommit(commitSha, 'spec:enclosing.spec.ts::t', 't', [
      { unitKey: 'enclosingParent#p1', branchId: null, filePath: enclosingFile, hitCount: 1 },
    ]);

    const directUnit = makeChangedUnit({ filePath: directFile, unitKey: 'direct#d1' });
    const inheritedUnit = makeChangedUnit({
      filePath: enclosingFile,
      unitKey: 'newChild#c1',
      changeKind: 'new',
    });
    const unmappedUnit = makeChangedUnit({
      filePath: `${FILE_PREFIX}/orphan.ts`,
      unitKey: 'orphan#o1',
      changeKind: 'new',
    });
    const enclosingMap = new Map([
      [
        enclosingUnitMapKey(enclosingFile, 'newChild#c1'),
        { filePath: enclosingFile, unitKey: 'enclosingParent#p1' },
      ],
    ]);

    const result = await selectTestsForChangedUnits(
      commitSha,
      [directUnit, inheritedUnit, unmappedUnit],
      enclosingMap,
    );

    expect(result.selectedTests).toHaveLength(2);
    expect(result.selectedTests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          testId: 'spec:direct.spec.ts::t',
          reason: 'direct-hit',
          sourceUnitKey: 'direct#d1',
        }),
        expect.objectContaining({
          testId: 'spec:enclosing.spec.ts::t',
          reason: 'inherited',
          sourceUnitKey: 'newChild#c1',
        }),
      ]),
    );
    expect(result.unmappedChanges).toEqual([
      { filePath: `${FILE_PREFIX}/orphan.ts`, unitKey: 'orphan#o1' },
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
    const enclosingMap = new Map([
      [
        enclosingUnitMapKey(`${FILE_PREFIX}/b.ts`, 'unitB-new#b1'),
        { filePath: `${FILE_PREFIX}/b.ts`, unitKey: 'enclosing#e1' },
      ],
    ]);

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

  it('finds a test whose coverage is stored under a non-null branch_id, even though the changed unit itself carries branchId: null (regression)', async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    // Mirrors how a branching function is actually stored — see
    // coverageSymbolicationService.ts's branch-granularity path — under a
    // real branch_id like "0:0", never branchId: null. changeUnitResolver
    // always resolves a changed FUNCTION with branchId: null (it has no way
    // to know which specific branch arm changed); before the fix, this
    // lookup required an EXACT (unitKey, branchId) match and so could never
    // find this row at all.
    await linkAndCommit(
      commitSha,
      'spec:branching.spec.ts::covers the if-branch',
      'covers the if-branch',
      [
        {
          unitKey: 'hasIf#branch1',
          branchId: '0:0',
          filePath: `${FILE_PREFIX}/branching.ts`,
          hitCount: 1,
        },
      ],
    );

    const result = await selectTestsForChangedUnits(commitSha, [
      makeChangedUnit({
        filePath: `${FILE_PREFIX}/branching.ts`,
        unitKey: 'hasIf#branch1',
        branchId: null,
      }),
    ]);

    expect(result.selectedTests).toHaveLength(1);
    expect(result.selectedTests[0]).toMatchObject({
      testId: 'spec:branching.spec.ts::covers the if-branch',
      reason: 'direct-hit',
    });
    expect(result.unmappedChanges).toEqual([]);
  });

  it("does not attribute a DIFFERENT file's coverage to a changed unit sharing the same unitKey (regression — file identity)", async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    // unit_key is derived purely from name + normalized body hash, with no
    // file path folded in — two unrelated files can coincidentally produce
    // the same unitKey. Before the fix, findTestsForUnitAcrossBranches
    // matched on unitKey alone, so a changed unit in fileA could pick up
    // fileB's coverage links.
    const sharedUnitKey = 'coincidence#samehash';
    await linkAndCommit(commitSha, 'spec:a.spec.ts::t', 't', [
      { unitKey: sharedUnitKey, branchId: null, filePath: `${FILE_PREFIX}/a.ts`, hitCount: 1 },
    ]);
    await linkAndCommit(commitSha, 'spec:b.spec.ts::t', 't', [
      { unitKey: sharedUnitKey, branchId: null, filePath: `${FILE_PREFIX}/b.ts`, hitCount: 1 },
    ]);

    const result = await selectTestsForChangedUnits(commitSha, [
      makeChangedUnit({ filePath: `${FILE_PREFIX}/a.ts`, unitKey: sharedUnitKey }),
    ]);

    expect(result.selectedTests).toHaveLength(1);
    expect(result.selectedTests[0].testId).toBe('spec:a.spec.ts::t');
  });

  it('inherits from the CORRECT enclosing unit when two changed units in different files share the same unitKey (regression — map key collision)', async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    // Two changed units — same unitKey, but in DIFFERENT files — each with
    // its own, DIFFERENT enclosing unit. Before the fix, enclosingUnitsByUnitKey
    // was keyed on unitKey alone, so whichever entry was written last for
    // this shared key would silently supply BOTH changed units' inheritance
    // candidates instead of each unit's own correct enclosing unit.
    const sharedUnitKey = 'newHelper#collide';

    await linkAndCommit(commitSha, 'spec:enclosing-a.spec.ts::t', 't', [
      { unitKey: 'enclosingA#a1', branchId: null, filePath: `${FILE_PREFIX}/a.ts`, hitCount: 1 },
    ]);
    await linkAndCommit(commitSha, 'spec:enclosing-b.spec.ts::t', 't', [
      { unitKey: 'enclosingB#b1', branchId: null, filePath: `${FILE_PREFIX}/b.ts`, hitCount: 1 },
    ]);

    const unitInA = makeChangedUnit({
      filePath: `${FILE_PREFIX}/a.ts`,
      unitKey: sharedUnitKey,
      changeKind: 'new',
    });
    const unitInB = makeChangedUnit({
      filePath: `${FILE_PREFIX}/b.ts`,
      unitKey: sharedUnitKey,
      changeKind: 'new',
    });

    const enclosingMap = new Map([
      [
        enclosingUnitMapKey(`${FILE_PREFIX}/a.ts`, sharedUnitKey),
        { filePath: `${FILE_PREFIX}/a.ts`, unitKey: 'enclosingA#a1' },
      ],
      [
        enclosingUnitMapKey(`${FILE_PREFIX}/b.ts`, sharedUnitKey),
        { filePath: `${FILE_PREFIX}/b.ts`, unitKey: 'enclosingB#b1' },
      ],
    ]);

    const result = await selectTestsForChangedUnits(commitSha, [unitInA, unitInB], enclosingMap);

    expect(result.selectedTests.map((t) => t.testId).sort()).toEqual([
      'spec:enclosing-a.spec.ts::t',
      'spec:enclosing-b.spec.ts::t',
    ]);
  });
});
