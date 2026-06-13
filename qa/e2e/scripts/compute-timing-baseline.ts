#!/usr/bin/env tsx
/**
 * compute-timing-baseline.ts
 *
 * Reads qa/e2e/test-timing.jsonl and emits qa/e2e/test-timing-baseline.json.
 *
 * Algorithm:
 *   1. Parse all records, dropping lines with status 'skipped' or 'timedOut'.
 *   2. Group qualifying durations by file path.
 *   3. For each file, collect the set of distinct runIds that contributed at
 *      least one qualifying record — this is the "run count" for that file.
 *   4. Files with run count < MIN_RUN_COUNT get the fallback duration and a
 *      stderr warning; all others get the median of their qualifying durations.
 *   5. Write the result to test-timing-baseline.json.
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

  // Group qualifying durations and distinct runIds by file.
  const durationsByFile = new Map<string, number[]>();
  const runIdsByFile = new Map<string, Set<number>>();

  for (const record of records) {
    if (EXCLUDED_STATUSES.has(record.status)) continue;

    if (!durationsByFile.has(record.file)) {
      durationsByFile.set(record.file, []);
      runIdsByFile.set(record.file, new Set());
    }
    durationsByFile.get(record.file)!.push(record.duration); // non-null: set above
    runIdsByFile.get(record.file)!.add(record.runId); // non-null: set above
  }

  const files: Record<string, BaselineEntry> = {};
  let stableCount = 0;
  let fallbackCount = 0;

  for (const [file, durations] of durationsByFile) {
    const runIds = runIdsByFile.get(file)!; // non-null: always set alongside durationsByFile
    const runCount = runIds.size;

    if (runCount < MIN_RUN_COUNT) {
      process.stderr.write(
        `[compute-timing-baseline] WARN: "${file}" has only ${runCount}/${MIN_RUN_COUNT} ` +
          `qualifying runs — using fallback duration of ${DEFAULT_FALLBACK_MS}ms.\n`,
      );
      files[file] = { medianMs: DEFAULT_FALLBACK_MS, runCount };
      fallbackCount++;
    } else {
      files[file] = { medianMs: Math.round(median(durations)), runCount };
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
