/**
 * TimingReporter — custom Playwright reporter that appends per-test duration
 * records to test-timing.jsonl for use by the LPT shard assignment pipeline.
 *
 * - Hooks onBegin (captures runId) and onTestEnd (writes one record per attempt).
 * - File writes are wrapped in try/catch; errors go to stderr and never throw,
 *   so a disk problem cannot fail the test run.
 * - Output path defaults to test-timing.jsonl next to playwright.config.ts
 *   (qa/e2e/test-timing.jsonl); override with TIMING_JSONL_PATH env var.
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

export class TimingReporter implements Reporter {
  private runId: number = 0;
  private jsonlPath: string = '';

  onBegin(config: FullConfig): void {
    this.runId = Date.now();
    this.jsonlPath =
      process.env['TIMING_JSONL_PATH'] ??
      path.join(path.dirname(config.configFile ?? ''), 'test-timing.jsonl');
  }

  onTestEnd(test: TestCase, result: TestResult): void {
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
