/**
 * TimingReporter — custom Playwright reporter that appends per-test duration
 * records to test-timing.jsonl for use by the LPT shard assignment pipeline.
 *
 * - Hooks onBegin (captures runId) and onTestEnd (writes one record per final attempt).
 * - Retry attempts are skipped — only the final outcome is recorded so the baseline
 *   reflects real test duration rather than fail-fast abort times.
 * - File writes are wrapped in try/catch; errors go to stderr and never throw,
 *   so a disk problem cannot fail the test run.
 * - Output path: qa/e2e/test-timing.jsonl (relative to process.cwd(), which is the
 *   repo root when invoked via npm scripts or npx playwright from the repo root).
 *   Override with TIMING_JSONL_PATH env var.
 * - test-timing.jsonl is appended, not overwritten, so history accumulates
 *   across runs. It is listed in .gitignore; the committed source of truth is
 *   test-timing-baseline.json (produced by compute-timing-baseline.ts).
 *
 * Register in playwright.config.ts:
 *   ['./framework/reporting/timing-reporter.ts']
 *
 * MINCRM-549
 */

import path from 'node:path';
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { appendTimingRecord } from './timing-utils.js';
import type { TimingRecord } from './timing-utils.js';

const DEFAULT_JSONL_PATH = 'qa/e2e/test-timing.jsonl';

export class TimingReporter implements Reporter {
  private runId: number = 0;
  private jsonlPath: string = '';

  onBegin(_config: FullConfig): void {
    this.runId = Date.now();
    // Anchor to repo root via process.cwd() — consistent with the scripts that
    // read this file, which also resolve from process.cwd() when run via npm scripts.
    this.jsonlPath =
      process.env['TIMING_JSONL_PATH'] ?? path.join(process.cwd(), DEFAULT_JSONL_PATH);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Only record the final attempt. Retry attempts end with 'failed' or 'timedOut'
    // before the last one; recording them would bias the median toward abort times.
    const isFinalAttempt = result.status === 'passed' || result.retry === test.retries;
    if (!isFinalAttempt) return;

    const record: TimingRecord = {
      runId: this.runId,
      file: path.relative(process.cwd(), test.location.file),
      title: test.titlePath().join(' > '),
      duration: result.duration,
      status: result.status as TimingRecord['status'],
      ts: new Date().toISOString(),
    };
    appendTimingRecord(this.jsonlPath, record);
  }
}

export default TimingReporter;
