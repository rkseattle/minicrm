/**
 * Coverage/TIA safety-net selection policy. (MINCRM-626)
 *
 * Wraps testSelectionService's (MINCRM-624) mapping-based selection and
 * dependencyGraphService's (MINCRM-625) config/infra widening with the
 * guardrails MINCRM-626's AC requires:
 *  - An always-run baseline set (smoke/critical paths) unioned in
 *    unconditionally, regardless of what the diff itself resolved to.
 *  - A full-suite fallback triggered by low confidence, unmapped changes, or
 *    a dependency-graph "always widen" signal — never a partial/best-guess
 *    widening in these cases, since MINCRM-626's own framing ("a missed
 *    test never becomes a missed regression") calls for the safe default,
 *    not a narrower one.
 *  - Configurable thresholds (as named constants, overridable via env var)
 *    for the periodic-full-run recalibration case (nightly/pre-merge),
 *    where a caller wants the safety net to always fire regardless of
 *    what a specific diff looks like.
 *
 * This module has NO knowledge of the mapping query API, git diffs, or the
 * dependency rule table — it only combines their already-computed outputs,
 * so it stays testable with plain data fixtures (see its own test file).
 */

import type { SelectedTest, UnmappedChange } from './testSelectionService.js';
import type { DependencyWideningResult } from './dependencyGraphService.js';

/** A test selected under the 'baseline' reason is ALWAYS present in the final result — see FinalSelectionResult.mode. */
export type FinalSelectionReason = 'direct-hit' | 'inherited' | 'baseline';

export interface FinalSelectedTest {
  testId: string;
  testName: string | null;
  reason: FinalSelectionReason;
}

/** Why the policy chose the mode it did — surfaced for CI logs/audit, not just the final test list. */
export type FullSuiteFallbackReason =
  'low-confidence' | 'unmapped-changes' | 'dependency-graph-always-widen' | 'forced-recalibration';

export interface FinalSelectionResult {
  mode: 'targeted' | 'full-suite';
  /** Populated for 'targeted' mode; empty for 'full-suite' (callers run everything, this list is moot). */
  selectedTests: FinalSelectedTest[];
  /** Extra test-scope tags to widen targeted selection with, from dependencyGraphService — only meaningful when mode is 'targeted'. */
  widenedTestScopes: string[];
  fallbackReasons: FullSuiteFallbackReason[];
}

/** A confidence score below this floor is treated as untrustworthy — the unit "matched" but the match itself is stale enough to not be relied on alone. */
const DEFAULT_MIN_CONFIDENCE_THRESHOLD = Number(process.env.TIA_MIN_CONFIDENCE_THRESHOLD ?? '0.3');

/** Fraction of a diff's changed units allowed to be unmapped before the whole selection is considered too unreliable to trust in targeted mode. */
const DEFAULT_MAX_UNMAPPED_RATIO = Number(process.env.TIA_MAX_UNMAPPED_RATIO ?? '0.5');

export interface SafetyNetPolicyOptions {
  /** Always-run baseline tests (smoke/critical paths) — unioned in unconditionally regardless of mode. */
  baselineTests: readonly FinalSelectedTest[];
  /** Total number of changed units resolved for this diff (from changeUnitResolver), for computing the unmapped ratio. */
  totalChangedUnitCount: number;
  unmappedChanges: readonly UnmappedChange[];
  dependencyWideningResults: readonly DependencyWideningResult[];
  /** Forces full-suite mode unconditionally — the periodic/nightly recalibration case, independent of this specific diff's own signals. */
  forceFullSuite?: boolean;
  minConfidenceThreshold?: number;
  maxUnmappedRatio?: number;
}

function toFinalSelectedTest(test: SelectedTest): FinalSelectedTest {
  return { testId: test.testId, testName: test.testName, reason: test.reason };
}

/** True if any selected test's confidence is below the threshold — a single unreliable match is enough to distrust targeted mode for the whole diff, matching the "never miss a regression" framing over a per-test partial fallback. */
function hasLowConfidenceMatch(
  selectedTests: readonly SelectedTest[],
  minConfidenceThreshold: number,
): boolean {
  return selectedTests.some(
    (test) => test.confidenceScore !== null && test.confidenceScore < minConfidenceThreshold,
  );
}

function unmappedRatio(unmappedCount: number, totalChangedUnitCount: number): number {
  if (totalChangedUnitCount === 0) return 0;
  return unmappedCount / totalChangedUnitCount;
}

/**
 * Applies the safety-net policy to a diff's already-computed selection
 * signals, producing the FINAL result CI should act on.
 */
export function applySafetyNetPolicy(
  selectedTests: readonly SelectedTest[],
  options: SafetyNetPolicyOptions,
): FinalSelectionResult {
  const minConfidenceThreshold = options.minConfidenceThreshold ?? DEFAULT_MIN_CONFIDENCE_THRESHOLD;
  const maxUnmappedRatio = options.maxUnmappedRatio ?? DEFAULT_MAX_UNMAPPED_RATIO;

  const fallbackReasons: FullSuiteFallbackReason[] = [];

  if (options.forceFullSuite) {
    fallbackReasons.push('forced-recalibration');
  }
  if (
    unmappedRatio(options.unmappedChanges.length, options.totalChangedUnitCount) > maxUnmappedRatio
  ) {
    fallbackReasons.push('unmapped-changes');
  }
  if (hasLowConfidenceMatch(selectedTests, minConfidenceThreshold)) {
    fallbackReasons.push('low-confidence');
  }
  if (options.dependencyWideningResults.some((result) => result.alwaysWiden)) {
    fallbackReasons.push('dependency-graph-always-widen');
  }

  if (fallbackReasons.length > 0) {
    return { mode: 'full-suite', selectedTests: [], widenedTestScopes: [], fallbackReasons };
  }

  const baselineTestIds = new Set(options.baselineTests.map((t) => t.testId));
  const nonBaselineTests = selectedTests
    .filter((t) => !baselineTestIds.has(t.testId))
    .map(toFinalSelectedTest);

  const widenedTestScopes = Array.from(
    new Set(options.dependencyWideningResults.flatMap((result) => result.widenedTestScopes)),
  );

  return {
    mode: 'targeted',
    // Baseline tests always appear, and always with reason 'baseline' — a
    // test that's BOTH baseline and independently mapping-selected still
    // reports as 'baseline' rather than silently picking one label, since
    // "was this run because it's always-run, or because the diff mapped to
    // it" is exactly the audit question this reason field exists to answer,
    // and baseline membership is the stronger, unconditional guarantee.
    selectedTests: [...options.baselineTests, ...nonBaselineTests],
    widenedTestScopes,
    fallbackReasons: [],
  };
}
