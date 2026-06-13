#!/usr/bin/env tsx
/**
 * compute-timing-baseline.ts
 *
 * Reads qa/e2e/test-timing.jsonl and emits qa/e2e/test-timing-baseline.json.
 *
 * Algorithm:
 *   1. Parse all records, dropping lines with status 'skipped' or 'timedOut'.
 *   2. Group per-test durations by (file, runId) and sum within each group,
 *      producing one total wall-clock duration per spec file per run.
 *   3. Files with fewer than MIN_RUN_COUNT distinct runIds get the fallback
 *      duration and a stderr warning; all others get the median of their
 *      per-run totals.
 *   4. Write the result to test-timing-baseline.json.
 *
 * Usage (from repo root):
 *   npm run e2e:timing:baseline
 *   # or directly:
 *   npx tsx qa/e2e/scripts/compute-timing-baseline.ts
 *
 * MINCRM-549
 */

import path from 'node:path';
import {
  readTimingRecords,
  writeTimingBaseline,
  median,
  EXCLUDED_STATUSES,
  MIN_RUN_COUNT,
  DEFAULT_FALLBACK_MS,
  TIMING_JSONL_FILENAME,
  TIMING_BASELINE_FILENAME,
} from '../framework/reporting/timing-utils.js';
import type { TimingBaseline, BaselineEntry } from '../framework/reporting/timing-utils.js';

// Scripts are invoked from repo root via npm scripts, so process.cwd() is reliable.
const E2E_DIR = path.resolve(process.cwd(), 'qa/e2e');
const JSONL_PATH = path.join(E2E_DIR, TIMING_JSONL_FILENAME);
const BASELINE_PATH = path.join(E2E_DIR, TIMING_BASELINE_FILENAME);

function main(): void {
  const records = readTimingRecords(JSONL_PATH);

  if (records.length === 0) {
    process.stderr.write(
      `[compute-timing-baseline] No records found in ${JSONL_PATH}. ` +
        `Run the E2E suite at least ${MIN_RUN_COUNT} times to build a baseline.\n`,
    );
    process.exit(0);
  }

  // Group per-test durations by (file, runId) so we can sum per-run totals.
  // Each JSONL record is one test's duration; a spec file's wall-clock time is the
  // sum of all its tests in a single run. Taking the median over per-run totals
  // gives an accurate estimate of how long Playwright spends on that file end-to-end.
  const runTotalsByFile = new Map<string, Map<number, number>>();

  for (const record of records) {
    if (EXCLUDED_STATUSES.has(record.status)) continue;

    if (!runTotalsByFile.has(record.file)) {
      runTotalsByFile.set(record.file, new Map());
    }
    const byRun = runTotalsByFile.get(record.file)!; // non-null: set above
    byRun.set(record.runId, (byRun.get(record.runId) ?? 0) + record.duration);
  }

  const files: Record<string, BaselineEntry> = {};
  let stableCount = 0;
  let fallbackCount = 0;

  for (const [file, byRun] of runTotalsByFile) {
    const runCount = byRun.size;

    if (runCount < MIN_RUN_COUNT) {
      process.stderr.write(
        `[compute-timing-baseline] WARN: "${file}" has only ${runCount}/${MIN_RUN_COUNT} ` +
          `qualifying runs — using fallback duration of ${DEFAULT_FALLBACK_MS}ms.\n`,
      );
      files[file] = { medianMs: DEFAULT_FALLBACK_MS, runCount };
      fallbackCount++;
    } else {
      const perRunTotals = [...byRun.values()];
      files[file] = { medianMs: Math.round(median(perRunTotals)), runCount };
      stableCount++;
    }
  }

  const baseline: TimingBaseline = {
    generatedAt: new Date().toISOString(),
    fallbackMs: DEFAULT_FALLBACK_MS,
    files,
  };

  writeTimingBaseline(BASELINE_PATH, baseline);

  process.stdout.write(
    `[compute-timing-baseline] Wrote ${BASELINE_PATH}\n` +
      `  Stable files:   ${stableCount}\n` +
      `  Fallback files: ${fallbackCount}\n`,
  );
}

main();
