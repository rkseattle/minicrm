/**
 * Cleanup-failure annotations — the contract between a test-data fixture and
 * the reporters that surface leaked records.
 *
 * A fixture that tears down test data reports what it failed to clean up by
 * annotating the test; `step-summary-reporter.ts` collects those annotations
 * into a Cleanup Failures section, including from tests that PASSED. That last
 * part is the point: a failing test is already visible, while a green run that
 * left a row behind has no other signal and accumulates silently until a later
 * run degrades or a stale-data guard trips.
 *
 * The type string lives here rather than in the producer or the consumer so
 * the two cannot drift: a literal copied into both would let a change to one
 * disable the feature end to end with every spec still passing, since neither
 * side asserts against the other's copy.
 *
 * Framework-pure: no application domain, no entity names, no routes. The
 * shape it reports over is supplied by the caller.
 *
 * Introduced alongside the teardown-leak fix that made cleanup failures
 * propagate rather than being swallowed.
 */

/** Annotation type marking a record the run failed to clean up. */
export const CLEANUP_FAILED_ANNOTATION = 'teardown-failed';

/**
 * Annotation type marking an environment fact a doc or constant asserts that no
 * longer holds.
 *
 * For findings that make DOCUMENTATION stale without making the pipeline wrong —
 * where failing the run would block every merge on a change nobody here
 * controls, but staying silent lets the claim rot exactly as the one this ticket
 * fixed did. StepSummaryReporter surfaces these; an annotation no reporter reads
 * is indistinguishable from no annotation at all.
 */
export const ENVIRONMENT_DRIFT_ANNOTATION = 'environment-drift';

/** The subset of Playwright's TestInfo this module writes to. */
export interface AnnotatableTestInfo {
  annotations: { type: string; description?: string }[];
}

/** A single cleanup outcome, as reported by a test-data manager. */
export interface CleanupOutcome {
  /** Human-readable label for what was being cleaned up. */
  entityType: string;
  /** Identifier of the record. */
  id: string | number;
  /** False when the record could not be removed. */
  success: boolean;
  /** Diagnostic message, when one is available. */
  error?: string;
}

/**
 * Records every failed cleanup outcome as an annotation on the test.
 *
 * Annotates rather than fails: cleanup runs after the assertions, so failing
 * there would attribute a teardown problem to the test body.
 *
 * @param testInfo - The running test's info object.
 * @param outcomes - One outcome per registered record.
 */
export function annotateCleanupFailures(
  testInfo: AnnotatableTestInfo,
  outcomes: CleanupOutcome[],
): void {
  for (const failure of outcomes.filter((outcome) => !outcome.success)) {
    testInfo.annotations.push({
      type: CLEANUP_FAILED_ANNOTATION,
      description: `${failure.entityType} ${failure.id} was not cleaned up: ${failure.error ?? 'unknown error'}`,
    });
  }
}
