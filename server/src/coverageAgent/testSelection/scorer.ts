/**
 * Coverage/TIA pluggable scoring interface.
 *
 * Defines the swappable-scorer extension point the AC calls for:
 * "given (change, candidate tests, features) → ranked/capped list". A
 * future ML ranker (pr-tia-10) can be dropped in without
 * reworking testSelectionService.ts or weakening safetyNetPolicy.ts's
 * guarantees.
 *
 * A scorer is invoked exactly ONCE per selection, over the FULL diff (every
 * changed unit) and the FULL deduplicated candidate list together — not
 * once per changed unit — since ranking is fundamentally a cross-candidate
 * decision (e.g. "is test A more relevant than test B", "cap to the top N
 * overall") that a per-unit call could only approximate before
 * cross-unit dedup, then need re-doing anyway.
 *
 * CRITICAL INVARIANT (enforced by construction, not just convention): a
 * TestScorer operates ONLY on testSelectionService's own candidate list —
 * it runs BEFORE safetyNetPolicy.applySafetyNetPolicy, which is the module
 * that unions in the always-run baseline set and decides full-suite
 * fallback. A scorer therefore has no way to see, reorder, or drop the
 * baseline set at all: baseline tests are not part of a TestScorer's input
 * or output type, and safetyNetPolicy never imports or calls a TestScorer.
 * See scorer.test.ts's "cannot influence the baseline set" test, which
 * asserts this at the wiring level, not just in prose.
 */

import type { ChangedUnit } from './changeUnitResolver.js';
import type { SelectedTest } from './testSelectionService.js';

/** Contextual signals a scorer may use to rank/cap candidates, beyond the raw candidate list itself. */
export interface ScoringFeatures {
  /** Total number of changed units in this diff — a scorer may use diff size to decide how aggressively to cap. */
  totalChangedUnitCount: number;
}

/**
 * A pluggable ranker: given the full set of changed units and their
 * (already mapping-API-resolved, cross-unit-deduplicated) candidate tests,
 * returns a ranked and optionally-capped list.
 *
 * Never receives the baseline set (see module docblock) and is never
 * responsible for full-suite-fallback decisions — those stay
 * safetyNetPolicy's job, downstream of every scorer.
 */
export interface TestScorer {
  /** Stable identifier for logging/audit — e.g. 'map-based', or a future 'ml-ranker-v1'. */
  readonly id: string;
  score(
    changedUnits: readonly ChangedUnit[],
    candidateTests: readonly SelectedTest[],
    features: ScoringFeatures,
  ): SelectedTest[];
}

/**
 * The default scorer: confidence-first, alphabetical-tie-break ranking —
 * exactly testSelectionService's own earlier `prioritize` logic,
 * now expressed behind the TestScorer interface instead of being a private
 * hardcoded step.
 */
export const mapBasedScorer: TestScorer = {
  id: 'map-based',
  score(_changedUnits, candidateTests) {
    return [...candidateTests].sort((a, b) => {
      if (a.confidenceScore !== b.confidenceScore) {
        if (a.confidenceScore === null) return 1;
        if (b.confidenceScore === null) return -1;
        return b.confidenceScore - a.confidenceScore;
      }
      return a.testId.localeCompare(b.testId);
    });
  },
};
