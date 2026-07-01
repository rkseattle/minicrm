/**
 * TimingReporter — custom Playwright reporter that appends per-test duration
 * records to test-timing.jsonl for use by the LPT shard assignment scripts.
 *
 * - Hooks onBegin (captures runId) and onTestEnd (writes one record per final attempt).
 * - Retry attempts are skipped — only the final outcome is recorded so the baseline
 *   reflects real test duration rather than fail-fast abort times.
 * - File writes are wrapped in try/catch; errors go to stderr and never throw,
 *   so a disk problem cannot fail the test run.
 * - Output path: qa/e2e/test-timing.jsonl, anchored to __dirname (qa/e2e/framework/reporting/)
 *   so the path is correct regardless of the working directory when playwright runs.
 *   Override with TIMING_JSONL_PATH env var.
 * - test-timing.jsonl is appended, not overwritten, so history accumulates
 *   across runs. It is listed in .gitignore; the committed source of truth is
 *   test-timing-baseline.json (produced by compute-timing-baseline.ts).
 *
 * Register in playwright.config.ts:
 *   ['./framework/reporting/timing-reporter.ts']
 */

import path from 'node:path';
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { appendTimingRecord } from './timing-utils.js';
import type { TimingRecord } from './timing-utils.js';

// Anchored to qa/e2e/ regardless of working directory when playwright runs.
// __dirname is this file: qa/e2e/framework/reporting/
const DEFAULT_JSONL_PATH = path.resolve(__dirname, '../../test-timing.jsonl');

// Repo root for relative file paths in timing records.
const REPO_ROOT = path.resolve(__dirname, '../../../..');

export class TimingReporter implements Reporter {
  private runId: number = 0;
  private jsonlPath: string = '';

  onBegin(_config: FullConfig): void {
    this.runId = Date.now();
    this.jsonlPath = process.env['TIMING_JSONL_PATH'] ?? DEFAULT_JSONL_PATH;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Only record the final attempt. Retry attempts end with 'failed' or 'timedOut'
    // before the last one; recording them would bias the median toward abort times.
    const isFinalAttempt = result.status === 'passed' || result.retry === test.retries;
    if (!isFinalAttempt) return;

    const record: TimingRecord = {
      runId: this.runId,
      file: path.relative(REPO_ROOT, test.location.file),
      title: test.titlePath().join(' > '),
      duration: result.duration,
      status: result.status as TimingRecord['status'],
      ts: new Date().toISOString(),
    };
    appendTimingRecord(this.jsonlPath, record);
  }
}

export default TimingReporter;
