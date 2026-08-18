/**
 * annotateCleanupFailures — unit specs.
 *
 * `TestDataManager.teardown()` catches per entry and returns a
 * `TeardownResult[]`. The `testData` fixture used to discard that array, so a
 * record that failed to clean up produced a `console.error` line and nothing
 * else. Narrowing `registerAdminTeardown` to propagate non-404s (Defect B) only
 * matters if something downstream reads the result — this is that consumer.
 *
 * WHY THE LOOP IS AN EXPORTED FUNCTION IN framework/reporting/
 * ------------------------------------------------------------
 * A fixture's `testInfo` cannot be driven from a unit spec, so an inline loop
 * would be uncoverable — and an unverified reporting path is the same
 * silent-failure shape this ticket exists to close. It sits beside the reporter
 * that consumes it so the producer and consumer share one annotation-type
 * constant rather than a literal each — separate copies would let a change to
 * one disable the feature end to end with every spec still green. Importing it
 * from
 * @framework/ also keeps this spec off the fixture graph, which drags in pg
 * and the whole behaviors layer at module load.
 *
 * `TestDataManager.teardown()`'s own behavior — per-entry isolation, the
 * success/failure shape of each result — is covered by
 * test-data-manager.spec.ts, which runs in the same CI job
 * (`test:framework:coverage` names it explicitly). This file asserts only what
 * that one does not: the translation into annotations.
 */

import { test, expect } from '@playwright/test';
import {
  annotateCleanupFailures,
  CLEANUP_FAILED_ANNOTATION,
  type CleanupOutcome,
} from '@framework/reporting/cleanup-annotations.js';

/** Minimal stand-in for the slice of testInfo the function touches. */
function makeTestInfo(): { annotations: { type: string; description?: string }[] } {
  return { annotations: [] };
}

test.describe('annotateCleanupFailures', () => {
  test('annotates a failed entry with what leaked and why', async () => {
    const testInfo = makeTestInfo();
    const results: CleanupOutcome[] = [
      { entityType: 'contact', id: '42', success: false, error: 'HTTP 500' },
    ];

    annotateCleanupFailures(testInfo, results);

    expect(testInfo.annotations, 'one failure produces one annotation').toHaveLength(1);
    expect(testInfo.annotations[0]?.type).toBe(CLEANUP_FAILED_ANNOTATION);
    expect(
      testInfo.annotations[0]?.description,
      'the description must name the entity, its id, and the cause',
    ).toBe('contact 42 was not cleaned up: HTTP 500');
  });

  test('annotates nothing when every entry succeeded', async () => {
    // The common case. A green run must stay silent, or the annotation becomes
    // noise that readers learn to skip — the failure mode the swallowed 404 in
    // registerAdminTeardown was avoiding.
    const testInfo = makeTestInfo();
    const results: CleanupOutcome[] = [
      { entityType: 'contact', id: '1', success: true },
      { entityType: 'deactivate-user-2', id: '(custom)', success: true },
    ];

    annotateCleanupFailures(testInfo, results);

    expect(testInfo.annotations, 'a clean teardown must annotate nothing').toHaveLength(0);
  });

  test('annotates every failure, not just the first', async () => {
    // teardown() continues past a failing entry, so one test can leak several
    // records. Reporting only the first would hide the rest.
    const testInfo = makeTestInfo();
    const results: CleanupOutcome[] = [
      { entityType: 'contact', id: '1', success: false, error: 'HTTP 403' },
      { entityType: 'account', id: '2', success: true },
      { entityType: 'deal', id: '3', success: false, error: 'ECONNREFUSED' },
    ];

    annotateCleanupFailures(testInfo, results);

    expect(testInfo.annotations, 'both failures must be reported').toHaveLength(2);
    expect(testInfo.annotations.map((a) => a.description)).toEqual([
      'contact 1 was not cleaned up: HTTP 403',
      'deal 3 was not cleaned up: ECONNREFUSED',
    ]);
  });

  test('still reports a failure that carries no error message', async () => {
    // `error` is optional on TeardownResult. A missing message must not produce
    // "undefined" in the report, and must not drop the annotation entirely.
    const testInfo = makeTestInfo();
    const results: CleanupOutcome[] = [{ entityType: 'contact', id: '9', success: false }];

    annotateCleanupFailures(testInfo, results);

    expect(testInfo.annotations, 'a failure without a message is still a failure').toHaveLength(1);
    expect(testInfo.annotations[0]?.description).toBe(
      'contact 9 was not cleaned up: unknown error',
    );
  });
});
