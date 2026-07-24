/**
 * BaseResourceTouchReporter — abstract Playwright reporter base class that
 * appends per-test shared-resource read/write records to
 * resource-touch.jsonl, for use by the conflict-graph builder script.
 *
 * This class is domain-agnostic (no application resource key strings appear
 * here), so framework-purity checks pass. It does NOT know how to look up
 * a test's resource touches — subclasses implement `lookup()` and are
 * defined in the app layer, where the app-specific resource registry can
 * be imported statically.
 * A dynamically-computed `import()` path was considered and rejected: it
 * bypasses the test runner's TS transform step, so a lookup module reachable
 * only via a runtime-computed path cannot resolve its own further imports.
 * Static subclassing avoids that entirely.
 *
 * - Hooks onBegin (captures runId) and onTestEnd (writes one record per
 *   final attempt, same retry-skip rule as TimingReporter).
 * - A test with no lookup match is simply skipped — no record is written,
 *   matching "tests with no resource-touch history fall back to the
 *   existing @serial mechanism" (see check-settings-mutations.sh).
 * - File writes are wrapped in try/catch; errors go to stderr and never
 *   throw, so a disk problem cannot fail the test run.
 * - Output path: qa/e2e/resource-touch.jsonl, anchored to __dirname
 *   (qa/e2e/framework/reporting/) so the path is correct regardless of the
 *   working directory when playwright runs. Override with
 *   RESOURCE_TOUCH_JSONL_PATH env var.
 * - resource-touch.jsonl is appended, not overwritten, so history
 *   accumulates across runs, mirroring test-timing.jsonl's gitignored
 *   per-machine-history / committed-baseline split.
 */

import path from 'node:path';
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import {
  appendResourceTouchRecord,
  RESOURCE_TOUCH_JSONL_FILENAME,
} from './resource-touch-utils.js';
import type { ResourceTouchRecord, ResourceTouchLookup } from './resource-touch-utils.js';

// Anchored to qa/e2e/ regardless of working directory when playwright runs.
// __dirname is this file: qa/e2e/framework/reporting/
const DEFAULT_JSONL_PATH = path.resolve(__dirname, '../../resource-touch.jsonl');

// Repo root for relative file paths in resource-touch records.
const REPO_ROOT = path.resolve(__dirname, '../../../..');

export abstract class BaseResourceTouchReporter implements Reporter {
  private runId: number = 0;
  private jsonlPath: string = '';

  /** Subclasses provide the app-specific resource lookup. */
  protected abstract lookup: ResourceTouchLookup;

  onBegin(_config: FullConfig): void {
    this.runId = Date.now();
    this.jsonlPath = process.env['RESOURCE_TOUCH_JSONL_PATH'] ?? DEFAULT_JSONL_PATH;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Only record the final attempt — same rationale as TimingReporter:
    // retry attempts before the last one are not representative outcomes.
    const isFinalAttempt = result.status === 'passed' || result.retry === test.retries;
    if (!isFinalAttempt) return;

    const file = path.relative(REPO_ROOT, test.location.file);
    const title = test.titlePath().join(' > ');

    const touch = this.lookup(file, title);
    if (!touch) return;

    const record: ResourceTouchRecord = {
      runId: this.runId,
      file,
      title,
      reads: touch.reads,
      writes: touch.writes,
      ts: new Date().toISOString(),
    };
    appendResourceTouchRecord(this.jsonlPath, record);
  }
}

export { RESOURCE_TOUCH_JSONL_FILENAME };
export default BaseResourceTouchReporter;
