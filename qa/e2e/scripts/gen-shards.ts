#!/usr/bin/env tsx
/**
 * gen-shards.ts
 *
 * Implements LPT (Longest Processing Time) bin-packing over a spec file
 * list to produce a timing-aware shard assignment.
 *
 * Algorithm:
 *   1. Read test-timing-baseline.json for per-file median durations.
 *   2. Determine the file list: --selected-files=<path> (a TIA-selected
 *      subset, pr-tia-8) when provided and readable, else glob all
 *      functional spec files under qa/e2e/tests/apps/minicrm/functional/
 *      (nightly/post-merge full run, workflow_dispatch — unchanged from
 *      before pr-tia-8).
 *   3. Files absent from the baseline receive the baseline's fallbackMs and a
 *      stderr warning.
 *   4. Sort files descending by estimated duration (LPT order).
 *   5. Greedily assign each file to the worker with the lowest accumulated total
 *      wall time — minimises the maximum worker wall time (makespan).
 *   6. Print the assignment as a JSON string[][] (index = worker, values = files)
 *      and the estimated makespan to stdout.
 *
 * Usage (from repo root):
 *   npm run e2e:timing:shards -- --workers=4
 *   npm run e2e:timing:shards -- --workers=2 --selected-files=/tmp/tia-selection.json
 *
 * MINCRM-549
 */

import path from 'node:path';
import {
  readTimingBaseline,
  readSelectedFiles,
  discoverSpecFiles,
  lptAssign,
  TIMING_BASELINE_FILENAME,
  DEFAULT_FALLBACK_MS,
  type FileDuration,
} from '../framework/reporting/timing-utils.js';

const E2E_DIR = path.resolve(process.cwd(), 'qa/e2e');
const BASELINE_PATH = path.join(E2E_DIR, TIMING_BASELINE_FILENAME);
const FUNCTIONAL_TESTS_DIR = path.join(E2E_DIR, 'tests/apps/minicrm/functional');

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(): { workers: number; selectedFilesPath: string | undefined } {
  const workersArg = process.argv.find((a) => a.startsWith('--workers='));
  const workers = workersArg ? parseInt(workersArg.split('=')[1] ?? '4', 10) : 4;
  if (isNaN(workers) || workers < 1) {
    process.stderr.write(`[gen-shards] Invalid --workers value; must be a positive integer.\n`);
    process.exit(1);
  }
  const selectedFilesArg = process.argv.find((a) => a.startsWith('--selected-files='));
  const selectedFilesPath = selectedFilesArg?.split('=')[1];
  return { workers, selectedFilesPath };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const { workers, selectedFilesPath } = parseArgs();

  const baseline = readTimingBaseline(BASELINE_PATH);
  const fallbackMs = baseline?.fallbackMs ?? DEFAULT_FALLBACK_MS;

  if (!baseline) {
    process.stderr.write(
      `[gen-shards] WARN: ${BASELINE_PATH} not found. ` +
        `All files will use the fallback duration of ${fallbackMs}ms.\n`,
    );
  }

  const selectedFiles = readSelectedFiles(selectedFilesPath);
  if (selectedFilesPath && !selectedFiles) {
    process.stderr.write(
      `[gen-shards] WARN: --selected-files="${selectedFilesPath}" was given but could not be read/parsed — falling back to the full discoverSpecFiles() suite.\n`,
    );
  }
  const specFiles = selectedFiles ?? discoverSpecFiles(FUNCTIONAL_TESTS_DIR);
  if (selectedFiles) {
    process.stderr.write(
      `[gen-shards] Using TIA-selected subset: ${specFiles.length} file(s) from ${selectedFilesPath}.\n`,
    );
  }

  if (specFiles.length === 0) {
    process.stderr.write(`[gen-shards] No spec files found under ${FUNCTIONAL_TESTS_DIR}.\n`);
    process.exit(1);
  }

  const fileDurations: FileDuration[] = specFiles.map((file) => {
    const entry = baseline?.files[file];
    if (!entry) {
      process.stderr.write(
        `[gen-shards] WARN: "${file}" not in baseline — using fallback ${fallbackMs}ms.\n`,
      );
      return { file, estimatedMs: fallbackMs };
    }
    return { file, estimatedMs: entry.medianMs };
  });

  const assignment = lptAssign(fileDurations, workers);

  // Compute estimated makespan for each worker.
  const workerTotals = assignment.map((files) =>
    files.reduce((sum, file) => {
      const entry = fileDurations.find((f) => f.file === file);
      return sum + (entry?.estimatedMs ?? fallbackMs);
    }, 0),
  );
  const makespan = Math.max(...workerTotals, 0);

  process.stdout.write(JSON.stringify(assignment, null, 2) + '\n');
  process.stdout.write(
    `\n[gen-shards] ${specFiles.length} files → ${workers} workers\n` +
      `  Estimated makespan: ${(makespan / 1000).toFixed(1)}s\n` +
      workerTotals
        .map(
          (t, i) =>
            `  Worker ${i}: ${(t / 1000).toFixed(1)}s (${assignment[i]?.length ?? 0} files)`,
        )
        .join('\n') +
      '\n',
  );
}

main();
