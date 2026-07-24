/**
 * Coverage/TIA test selection algorithm. (MINCRM-624)
 *
 * Resolves changeUnitResolver.ts's changed units into the minimal set of
 * affected tests via the mapping query API (coverageMappingService's
 * findTestsForUnitWithConfidence, MINCRM-621), producing a prioritized,
 * deduplicated list with a per-test rationale. Changed units the mapping
 * API has no record of (new code, or code the map hasn't caught up with
 * yet) inherit candidates from their enclosing/calling unit instead of
 * being silently dropped; units that remain unmapped even after that are
 * surfaced separately for the safety-net policy (MINCRM-626) to widen
 * around.
 *
 * No batch lookup endpoint exists on the mapping query API (single
 * commitSha+unitKey+branchId per call) — this service fans out with bounded
 * concurrency (MAX_CONCURRENT_MAPPING_LOOKUPS) rather than one call per
 * changed unit unbounded, since coverageDb's own pool caps at 10 connections
 * (see coverageDb.ts) and an uncapped Promise.all over a large diff's
 * changed units could exhaust it.
 */

import {
  findTestsForUnitWithConfidence,
  type CoverageMappingResult,
} from '../../services/coverageMappingService.js';
import type { ChangedUnit } from './changeUnitResolver.js';

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
 * Ranks selected tests for output: highest confidence first (nulls last,
 * since a null confidence means "no coverage_units row was found to score
 * against" — treated as least-trustworthy, not zero), then alphabetically
 * by testId for a stable, deterministic tie-break.
 */
function prioritize(tests: readonly SelectedTest[]): SelectedTest[] {
  return [...tests].sort((a, b) => {
    if (a.confidenceScore !== b.confidenceScore) {
      if (a.confidenceScore === null) return 1;
      if (b.confidenceScore === null) return -1;
      return b.confidenceScore - a.confidenceScore;
    }
    return a.testId.localeCompare(b.testId);
  });
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

/**
 * Selects the minimal set of affected tests for a set of changed units.
 *
 * @param commitSha - The commit the mapping query API should resolve
 *   against — ordinarily the diff's own head commit, since that's the
 *   revision the map was (or will be) built from.
 * @param changedUnits - Output of changeUnitResolver.resolveChangedUnits.
 * @param enclosingUnitKeysByUnitKey - For a changed unit with no direct
 *   mapping (new code, or a genuinely unmapped unit), the enclosing/calling
 *   unit's key to inherit candidates from, if one is known. Callers resolve
 *   this from the same AST pass that produced changedUnits (e.g. a new
 *   method's enclosing class, or a new top-level function's nearest
 *   previously-mapped sibling) — this service has no AST access of its own
 *   and treats a unit as having no inheritance candidate when absent from
 *   this map, rather than guessing one.
 */
export async function selectTestsForChangedUnits(
  commitSha: string,
  changedUnits: readonly ChangedUnit[],
  enclosingUnitKeysByUnitKey: ReadonlyMap<string, string> = new Map(),
): Promise<TestSelectionResult> {
  const perUnitResults = await mapWithConcurrencyLimit(
    changedUnits,
    MAX_CONCURRENT_MAPPING_LOOKUPS,
    async (unit) => {
      const directMatches = await findTestsForUnitWithConfidence(
        commitSha,
        unit.unitKey,
        unit.branchId,
      );

      if (directMatches.length > 0) {
        return {
          unit,
          tests: directMatches.map((match) =>
            toSelectedTest(match, 'direct-hit', unit.unitKey, unit.filePath),
          ),
        };
      }

      // No direct mapping — new code with nothing to look up yet, or a
      // genuinely unmapped unit. Per MINCRM-624's AC, inherit candidates
      // from the enclosing/calling unit rather than treating this as
      // unconditionally unmapped.
      const enclosingUnitKey = enclosingUnitKeysByUnitKey.get(unit.unitKey);
      if (!enclosingUnitKey) {
        return { unit, tests: [] };
      }

      const inheritedMatches = await findTestsForUnitWithConfidence(
        commitSha,
        enclosingUnitKey,
        unit.branchId,
      );
      return {
        unit,
        tests: inheritedMatches.map((match) =>
          toSelectedTest(match, 'inherited', unit.unitKey, unit.filePath),
        ),
      };
    },
  );

  const allTests = perUnitResults.flatMap((r) => r.tests);
  const unmappedChanges = perUnitResults
    .filter((r) => r.tests.length === 0)
    .map((r) => ({ filePath: r.unit.filePath, unitKey: r.unit.unitKey }));

  return {
    selectedTests: prioritize(dedupeByTestId(allTests)),
    unmappedChanges,
  };
}
