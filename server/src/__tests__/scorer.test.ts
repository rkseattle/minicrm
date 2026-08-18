/**
 * Tests for scorer.
 *
 * Pure logic over plain data fixtures. Includes a wiring-level test that
 * the safety-net invariant (scorers never see/influence the baseline set)
 * actually holds, not just that it's documented in prose.
 */

import { mapBasedScorer, type TestScorer } from '../coverageAgent/testSelection/scorer.js';
import { applySafetyNetPolicy } from '../coverageAgent/testSelection/safetyNetPolicy.js';
import type { SelectedTest } from '../coverageAgent/testSelection/testSelectionService.js';
import type { ChangedUnit } from '../coverageAgent/testSelection/changeUnitResolver.js';

function makeChangedUnit(overrides: Partial<ChangedUnit> = {}): ChangedUnit {
  return {
    filePath: 'src/widget.ts',
    unitKey: 'render#abc123',
    branchId: null,
    changeKind: 'in-line',
    ...overrides,
  };
}

function makeSelectedTest(overrides: Partial<SelectedTest> = {}): SelectedTest {
  return {
    testId: 'spec:widget.spec.ts::renders',
    testName: 'renders',
    reason: 'direct-hit',
    sourceUnitKey: 'render#abc123',
    sourceFilePath: 'src/widget.ts',
    confidenceScore: 0.9,
    ...overrides,
  };
}

describe('mapBasedScorer', () => {
  it('ranks by confidence score, highest first', () => {
    const tests = [
      makeSelectedTest({ testId: 'b', confidenceScore: 0.2 }),
      makeSelectedTest({ testId: 'a', confidenceScore: 0.8 }),
    ];

    const ranked = mapBasedScorer.score([makeChangedUnit()], tests, { totalChangedUnitCount: 1 });

    expect(ranked.map((t) => t.testId)).toEqual(['a', 'b']);
  });

  it('sorts null confidence after every scored result', () => {
    const tests = [
      makeSelectedTest({ testId: 'unscored', confidenceScore: null }),
      makeSelectedTest({ testId: 'scored', confidenceScore: 0.1 }),
    ];

    const ranked = mapBasedScorer.score([makeChangedUnit()], tests, { totalChangedUnitCount: 1 });

    expect(ranked.map((t) => t.testId)).toEqual(['scored', 'unscored']);
  });

  it('breaks a confidence tie alphabetically by testId', () => {
    const tests = [
      makeSelectedTest({ testId: 'zebra', confidenceScore: 0.5 }),
      makeSelectedTest({ testId: 'alpha', confidenceScore: 0.5 }),
    ];

    const ranked = mapBasedScorer.score([makeChangedUnit()], tests, { totalChangedUnitCount: 1 });

    expect(ranked.map((t) => t.testId)).toEqual(['alpha', 'zebra']);
  });

  it('does not mutate the input array', () => {
    const tests = [
      makeSelectedTest({ testId: 'b', confidenceScore: 0.2 }),
      makeSelectedTest({ testId: 'a', confidenceScore: 0.8 }),
    ];
    const original = [...tests];

    mapBasedScorer.score([makeChangedUnit()], tests, { totalChangedUnitCount: 1 });

    expect(tests).toEqual(original);
  });
});

describe('TestScorer safety-net invariant', () => {
  it('cannot influence the baseline set — a scorer that drops/reorders everything still leaves baseline tests present and labeled "baseline" after applySafetyNetPolicy', () => {
    // A maximally adversarial scorer: drops every candidate entirely. If
    // the safety-net invariant held only "by convention", a real caller
    // could still lose baseline coverage by wiring this scorer's output
    // straight into a final test run without going through
    // applySafetyNetPolicy separately. This test proves the ACTUAL
    // pipeline (selection -> safetyNetPolicy) can't do that: safetyNetPolicy
    // takes the baseline set as its OWN separate parameter, never derived
    // from or filtered by whatever the scorer returned.
    const dropEverythingScorer: TestScorer = {
      id: 'adversarial-drop-all',
      score: () => [],
    };

    const candidateTests = [makeSelectedTest()];
    const scored = dropEverythingScorer.score([makeChangedUnit()], candidateTests, {
      totalChangedUnitCount: 1,
    });
    expect(scored).toEqual([]);

    const finalResult = applySafetyNetPolicy(scored, {
      baselineTests: [
        { testId: 'spec:smoke.spec.ts::loads', testName: 'loads', reason: 'baseline' },
      ],
      totalChangedUnitCount: 1,
      unmappedChanges: [],
      dependencyWideningResults: [],
      // Matches coveragePolicyConfig.ts's own defaults — safetyNetPolicy.ts
      // no longer has module-level defaults of its own.
      minConfidenceThreshold: 0.3,
      maxUnmappedRatio: 0.5,
    });

    expect(finalResult.mode).toBe('targeted');
    expect(finalResult.selectedTests).toEqual([
      { testId: 'spec:smoke.spec.ts::loads', testName: 'loads', reason: 'baseline' },
    ]);
  });

  it('safetyNetPolicy never imports or references a TestScorer (structural check that the two modules are decoupled)', async () => {
    const safetyNetSource = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL('../coverageAgent/testSelection/safetyNetPolicy.ts', import.meta.url),
        'utf8',
      ),
    );
    expect(safetyNetSource).not.toMatch(/scorer/i);
  });
});
