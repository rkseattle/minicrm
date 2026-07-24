/**
 * Tests for safetyNetPolicy. (MINCRM-626)
 *
 * Pure logic over plain data fixtures — no DB or git repo needed, since
 * this module only combines already-computed selection/widening signals.
 */

import { applySafetyNetPolicy } from '../coverageAgent/testSelection/safetyNetPolicy.js';
import type { SelectedTest } from '../coverageAgent/testSelection/testSelectionService.js';
import type { DependencyWideningResult } from '../coverageAgent/testSelection/dependencyGraphService.js';

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

const NO_WIDENING: DependencyWideningResult[] = [];
const BASELINE = [
  { testId: 'spec:smoke.spec.ts::loads', testName: 'loads', reason: 'baseline' as const },
];

describe('applySafetyNetPolicy', () => {
  it('returns targeted mode with baseline unioned in when everything is confident and mapped', () => {
    const result = applySafetyNetPolicy([makeSelectedTest()], {
      baselineTests: BASELINE,
      totalChangedUnitCount: 1,
      unmappedChanges: [],
      dependencyWideningResults: NO_WIDENING,
    });

    expect(result.mode).toBe('targeted');
    expect(result.fallbackReasons).toEqual([]);
    expect(result.selectedTests).toEqual([
      { testId: 'spec:smoke.spec.ts::loads', testName: 'loads', reason: 'baseline' },
      { testId: 'spec:widget.spec.ts::renders', testName: 'renders', reason: 'direct-hit' },
    ]);
  });

  it('always includes the baseline set even for an otherwise-empty selection', () => {
    const result = applySafetyNetPolicy([], {
      baselineTests: BASELINE,
      totalChangedUnitCount: 0,
      unmappedChanges: [],
      dependencyWideningResults: NO_WIDENING,
    });

    expect(result.mode).toBe('targeted');
    expect(result.selectedTests).toEqual(BASELINE);
  });

  it('falls back to full-suite when a selected test has low confidence', () => {
    const result = applySafetyNetPolicy([makeSelectedTest({ confidenceScore: 0.1 })], {
      baselineTests: BASELINE,
      totalChangedUnitCount: 1,
      unmappedChanges: [],
      dependencyWideningResults: NO_WIDENING,
    });

    expect(result.mode).toBe('full-suite');
    expect(result.fallbackReasons).toEqual(['low-confidence']);
    expect(result.selectedTests).toEqual([]);
  });

  it('does not fall back for a null confidence score (no coverage_units match, not "low confidence")', () => {
    const result = applySafetyNetPolicy([makeSelectedTest({ confidenceScore: null })], {
      baselineTests: BASELINE,
      totalChangedUnitCount: 1,
      unmappedChanges: [],
      dependencyWideningResults: NO_WIDENING,
    });

    expect(result.mode).toBe('targeted');
  });

  it('falls back to full-suite when too many changed units are unmapped', () => {
    const result = applySafetyNetPolicy([makeSelectedTest()], {
      baselineTests: BASELINE,
      totalChangedUnitCount: 2,
      unmappedChanges: [
        { filePath: 'a.ts', unitKey: 'a#1' },
        { filePath: 'b.ts', unitKey: 'b#1' },
      ],
      dependencyWideningResults: NO_WIDENING,
      maxUnmappedRatio: 0.5,
    });

    expect(result.mode).toBe('full-suite');
    expect(result.fallbackReasons).toEqual(['unmapped-changes']);
  });

  it('does not fall back when the unmapped ratio is at or below the threshold', () => {
    const result = applySafetyNetPolicy([makeSelectedTest()], {
      baselineTests: BASELINE,
      totalChangedUnitCount: 4,
      unmappedChanges: [{ filePath: 'a.ts', unitKey: 'a#1' }],
      dependencyWideningResults: NO_WIDENING,
      maxUnmappedRatio: 0.5,
    });

    expect(result.mode).toBe('targeted');
  });

  it('falls back to full-suite when the dependency graph flags always-widen', () => {
    const result = applySafetyNetPolicy([makeSelectedTest()], {
      baselineTests: BASELINE,
      totalChangedUnitCount: 1,
      unmappedChanges: [],
      dependencyWideningResults: [
        {
          filePath: 'db/migrations/1.js',
          widenedTestScopes: [],
          alwaysWiden: true,
          matchedRuleIds: ['db-migration'],
        },
      ],
    });

    expect(result.mode).toBe('full-suite');
    expect(result.fallbackReasons).toEqual(['dependency-graph-always-widen']);
  });

  it('forces full-suite mode for periodic recalibration regardless of otherwise-clean signals', () => {
    const result = applySafetyNetPolicy([makeSelectedTest()], {
      baselineTests: BASELINE,
      totalChangedUnitCount: 1,
      unmappedChanges: [],
      dependencyWideningResults: NO_WIDENING,
      forceFullSuite: true,
    });

    expect(result.mode).toBe('full-suite');
    expect(result.fallbackReasons).toEqual(['forced-recalibration']);
  });

  it('reports every applicable fallback reason, not just the first one triggered', () => {
    const result = applySafetyNetPolicy([makeSelectedTest({ confidenceScore: 0.05 })], {
      baselineTests: BASELINE,
      totalChangedUnitCount: 1,
      unmappedChanges: [{ filePath: 'a.ts', unitKey: 'a#1' }],
      dependencyWideningResults: NO_WIDENING,
      maxUnmappedRatio: 0.5,
    });

    expect(result.fallbackReasons).toEqual(
      expect.arrayContaining(['unmapped-changes', 'low-confidence']),
    );
  });

  it('unions widened test scopes from the dependency graph into a targeted result', () => {
    const result = applySafetyNetPolicy([makeSelectedTest()], {
      baselineTests: BASELINE,
      totalChangedUnitCount: 1,
      unmappedChanges: [],
      dependencyWideningResults: [
        {
          filePath: 'shared/schemas/dealSchema.ts',
          widenedTestScopes: ['functional:*'],
          alwaysWiden: false,
          matchedRuleIds: ['shared-schema'],
        },
      ],
    });

    expect(result.mode).toBe('targeted');
    expect(result.widenedTestScopes).toEqual(['functional:*']);
  });

  it('labels a test both baseline and mapping-selected as baseline (the stronger guarantee)', () => {
    const sharedId = 'spec:smoke.spec.ts::loads';
    const result = applySafetyNetPolicy(
      [makeSelectedTest({ testId: sharedId, testName: 'loads', reason: 'direct-hit' })],
      {
        baselineTests: [{ testId: sharedId, testName: 'loads', reason: 'baseline' }],
        totalChangedUnitCount: 1,
        unmappedChanges: [],
        dependencyWideningResults: NO_WIDENING,
      },
    );

    expect(result.selectedTests).toHaveLength(1);
    expect(result.selectedTests[0]).toEqual({
      testId: sharedId,
      testName: 'loads',
      reason: 'baseline',
    });
  });
});
