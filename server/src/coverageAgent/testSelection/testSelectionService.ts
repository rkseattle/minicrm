/**
 * Coverage/TIA test selection algorithm.
 *
 * Resolves changeUnitResolver.ts's changed units into the minimal set of
 * affected tests via the mapping query API (coverageMappingService's
 * findTestsForUnitAcrossBranches), producing a prioritized,
 * deduplicated list with a per-test rationale. Changed units the mapping
 * API has no record of (new code, or code the map hasn't caught up with
 * yet) inherit candidates from their enclosing/calling unit instead of
 * being silently dropped; units that remain unmapped even after that are
 * surfaced separately for the safety-net policy to widen
 * around.
 *
 * Looks up by unitKey ACROSS EVERY BRANCH (findTestsForUnitAcrossBranches),
 * not the mapping query API's own exact-(unitKey, branchId) lookup
 * (findTestsForUnitWithConfidence) — changeUnitResolver resolves a diff to
 * changed FUNCTIONS, never individual branch arms within a function (every
 * ChangedUnit.branchId is always null), while a branching function's own
 * coverage is stored under one or more NON-null branch_id rows. An exact
 * lookup with branchId: null would therefore always return zero results
 * for exactly the functions most likely to have meaningful branch-level
 * test coverage (found via Greptile PR review) — see
 * coverageMappingService.ts's own docblock on findTestsForUnitAcrossBranches
 * for the full rationale.
 *
 * The direct-lookup step resolves every changed unit's mapping in ONE
 * batched call (coverageMappingService.findTestsForUnitsAcrossBranches,
 *) rather than fanning out one query per changed unit — this
 * collapsed what was up to `ceil(N/MAX_CONCURRENT_MAPPING_LOOKUPS)`
 * sequential round trips into as many queries as
 * findTestsForUnitsAcrossBranches' own chunking needs (typically one, for
 * any diff under its per-batch chunk size). The inheritance-lookup step
 * (changed units with zero direct matches, consulting a caller-supplied
 * enclosing/calling unit) stays per-unit via the singular
 * findTestsForUnitAcrossBranches and MAX_CONCURRENT_MAPPING_LOOKUPS —
 * coverageDb's own pool caps at 10 connections (see coverageDb.ts), and an
 * uncapped Promise.all over that fan-out could exhaust it. That path is
 * unreachable from this module's only production caller today
 * (select-tests.ts never supplies enclosingUnitsByUnitKey), so batching it
 * is deliberately out of scope for that work.
 *
 * Ranking is delegated to a pluggable TestScorer — this module
 * owns only mapping-API resolution, inheritance, and cross-unit dedup;
 * per-unit ranking is entirely the scorer's concern, so a future ML ranker
 * can replace mapBasedScorer without touching any of this module's own
 * logic. See scorer.ts's docblock for the safety-net-ordering invariant
 * this split exists to preserve.
 */

import {
  findTestsForUnitAcrossBranches,
  findTestsForUnitsAcrossBranches,
  unitPairKey,
  type CoverageMappingResult,
} from '../../services/coverageMappingService.js';
import type { ChangedUnit } from './changeUnitResolver.js';
import { mapBasedScorer, type TestScorer } from './scorer.js';

/** How a selected test was determined to be affected by a change. */
export type SelectionReason = 'direct-hit' | 'inherited';

/** One selected test, prioritized and carrying why it was selected. */
export interface SelectedTest {
  testId: string;
  testName: string | null;
  reason: SelectionReason;
  /** The changed unit that produced this selection. */
  sourceUnitKey: string;
  sourceFilePath: string;
  confidenceScore: number | null;
}

/** A changed unit with no known test coverage, even after inheritance — handed to the safety-net policy. */
export interface UnmappedChange {
  filePath: string;
  unitKey: string;
}

export interface TestSelectionResult {
  selectedTests: SelectedTest[];
  unmappedChanges: UnmappedChange[];
}

/** Caps concurrent mapping-query-API calls — see module docblock re: coverageDb's 10-connection pool ceiling. */
const MAX_CONCURRENT_MAPPING_LOOKUPS = 5;

/** Runs `task` for every item in `items`, at most `limit` concurrently, preserving input order in the returned array. */
async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await task(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function toSelectedTest(
  match: CoverageMappingResult,
  reason: SelectionReason,
  sourceUnitKey: string,
  sourceFilePath: string,
): SelectedTest {
  return {
    testId: match.testId,
    testName: match.testName,
    reason,
    sourceUnitKey,
    sourceFilePath,
    confidenceScore: match.confidenceScore,
  };
}

/**
 * Deduplicates selected tests by testId, keeping the highest-confidence
 * (and, on a tie, the 'direct-hit' over 'inherited') occurrence — the same
 * test can easily be reached from more than one changed unit in the same
 * diff, and a per-test rationale should point at its single best-justified
 * source, not repeat the test once per contributing unit.
 */
function dedupeByTestId(tests: readonly SelectedTest[]): SelectedTest[] {
  const byTestId = new Map<string, SelectedTest>();

  for (const test of tests) {
    const existing = byTestId.get(test.testId);
    if (!existing) {
      byTestId.set(test.testId, test);
      continue;
    }

    const testIsBetter =
      test.reason === 'direct-hit' && existing.reason === 'inherited'
        ? true
        : test.reason === existing.reason &&
          (test.confidenceScore ?? -1) > (existing.confidenceScore ?? -1);

    if (testIsBetter) {
      byTestId.set(test.testId, test);
    }
  }

  return Array.from(byTestId.values());
}

/** An enclosing/calling unit to inherit candidates from — carries its OWN filePath, since findTestsForUnitAcrossBranches requires (filePath, unitKey) together (see that function's own docblock on why unitKey alone isn't globally unique). */
export interface EnclosingUnit {
  filePath: string;
  unitKey: string;
}

/**
 * Composite key for enclosingUnitsByUnitKey's map, combining a changed
 * unit's OWN (filePath, unitKey) — not unitKey alone. unit_key has no file
 * path folded into its hash (see coverageMappingService.ts's own docblock
 * on findTestsForUnitAcrossBranches), so two changed units from DIFFERENT
 * files sharing a coincidentally-identical unitKey would otherwise collide
 * on the same map entry: whichever caller last wrote to that key would
 * silently supply BOTH units' inheritance candidates, the same cross-file
 * collision already fixed at the mapping-query layer, reappearing one layer
 * up in this map's own key (found via Greptile PR review).
 *
 * Delegates to coverageMappingService.unitPairKey — the identical
 * (filePath, unitKey) -> string shape this module used to duplicate
 * independently (found during commit review). Kept as its own
 * named export here since this module's own callers/tests already import
 * it under this name for this specific semantic purpose (an
 * enclosing-unit map key, not a mapping-result attribution key) — same
 * underlying key shape, distinct meanings at each call site.
 */
export function enclosingUnitMapKey(filePath: string, unitKey: string): string {
  return unitPairKey(filePath, unitKey);
}

/**
 * Selects the minimal set of affected tests for a set of changed units.
 *
 * @param commitSha - The commit the mapping query API should resolve
 *   against — ordinarily the diff's own head commit, since that's the
 *   revision the map was (or will be) built from.
 * @param changedUnits - Output of changeUnitResolver.resolveChangedUnits.
 * @param enclosingUnitsByUnitKey - For a changed unit with no direct
 *   mapping (new code, or a genuinely unmapped unit), the enclosing/calling
 *   unit to inherit candidates from, if one is known. Keyed by
 *   enclosingUnitMapKey(filePath, unitKey) — the changed unit's OWN
 *   (filePath, unitKey), not unitKey alone (see enclosingUnitMapKey's own
 *   docblock for why unitKey alone would collide across files). Callers
 *   resolve this from the same AST pass that produced changedUnits (e.g. a
 *   new method's enclosing class, or a new top-level function's nearest
 *   previously-mapped sibling) — this service has no AST access of its own
 *   and treats a unit as having no inheritance candidate when absent from
 *   this map, rather than guessing one.
 * @param scorer - Ranks each changed unit's own candidate tests.
 *   Defaults to mapBasedScorer (confidence-first, alphabetical tie-break —
 *   this function's own ranking logic prior to). Swappable for
 *   a future ML ranker; never receives the safety-net baseline set (see
 *   scorer.ts's own docblock).
 */
export async function selectTestsForChangedUnits(
  commitSha: string,
  changedUnits: readonly ChangedUnit[],
  enclosingUnitsByUnitKey: ReadonlyMap<string, EnclosingUnit> = new Map(),
  scorer: TestScorer = mapBasedScorer,
): Promise<TestSelectionResult> {
  // Direct-lookup step: one batched call for every changed unit
  // instead of a per-unit fan-out. batchedDirectMatches always has exactly
  // one entry per (deduplicated) input pair, including pairs with zero
  // matches — see findTestsForUnitsAcrossBranches' own docblock.
  const batchedDirectMatches = await findTestsForUnitsAcrossBranches(
    commitSha,
    changedUnits.map((unit) => ({ filePath: unit.filePath, unitKey: unit.unitKey })),
  );
  const directMatchesByUnitKey = new Map(
    batchedDirectMatches.map((result) => [
      enclosingUnitMapKey(result.filePath, result.unitKey),
      result.matches,
    ]),
  );

  // Units with zero direct matches fall through to the inheritance step —
  // still per-unit (see module docblock for why batching this path is out
  // of scope).
  const unitsNeedingInheritance = changedUnits.filter((unit) => {
    const directMatches = directMatchesByUnitKey.get(
      enclosingUnitMapKey(unit.filePath, unit.unitKey),
    );
    return !directMatches || directMatches.length === 0;
  });

  const inheritedResults = await mapWithConcurrencyLimit(
    unitsNeedingInheritance,
    MAX_CONCURRENT_MAPPING_LOOKUPS,
    async (unit) => {
      // No direct mapping — new code with nothing to look up yet, or a
      // genuinely unmapped unit. Per the AC, inherit candidates
      // from the enclosing/calling unit rather than treating this as
      // unconditionally unmapped.
      const enclosingUnit = enclosingUnitsByUnitKey.get(
        enclosingUnitMapKey(unit.filePath, unit.unitKey),
      );
      if (!enclosingUnit) {
        return { unit, tests: [] };
      }

      const inheritedMatches = await findTestsForUnitAcrossBranches(
        commitSha,
        enclosingUnit.filePath,
        enclosingUnit.unitKey,
      );
      return {
        unit,
        tests: inheritedMatches.map((match) =>
          toSelectedTest(match, 'inherited', unit.unitKey, unit.filePath),
        ),
      };
    },
  );
  const inheritedTestsByUnitKey = new Map(
    inheritedResults.map((r) => [enclosingUnitMapKey(r.unit.filePath, r.unit.unitKey), r.tests]),
  );

  const perUnitResults = changedUnits.map((unit) => {
    const key = enclosingUnitMapKey(unit.filePath, unit.unitKey);
    const directMatches = directMatchesByUnitKey.get(key) ?? [];
    if (directMatches.length > 0) {
      return {
        unit,
        tests: directMatches.map((match) =>
          toSelectedTest(match, 'direct-hit', unit.unitKey, unit.filePath),
        ),
      };
    }
    return { unit, tests: inheritedTestsByUnitKey.get(key) ?? [] };
  });

  const allTests = perUnitResults.flatMap((r) => r.tests);
  const unmappedChanges = perUnitResults
    .filter((r) => r.tests.length === 0)
    .map((r) => ({ filePath: r.unit.filePath, unitKey: r.unit.unitKey }));

  // Ranking is delegated to the scorer, invoked ONCE over the
  // full deduplicated candidate list — see scorer.ts's own docblock for why
  // this is a single cross-unit call rather than one call per changed unit.
  const deduped = dedupeByTestId(allTests);
  const rankedTests = scorer.score(changedUnits, deduped, {
    totalChangedUnitCount: changedUnits.length,
  });

  return {
    selectedTests: rankedTests,
    unmappedChanges,
  };
}
