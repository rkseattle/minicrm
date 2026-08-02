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

/**
 * Splits argv into this script's options.
 *
 * Takes argv as a parameter and returns errors rather than reading
 * `process.argv` and calling `process.exit` inline — the latter is untestable
 * by construction, which is why the `=`-preserving split below went unpinned
 * for as long as it did. `main()` does the exiting. (MINCRM-696)
 */
export function parseGenShardsArgs(
  argv: readonly string[],
): { workers: number; selectedFilesPath: string | undefined; error: null } | { error: string } {
  // /^\d+$/ before Number, not isNaN after parseInt. parseInt('8x') → 8 and
  // parseInt('2.9') → 2, both of which pass the range check below — so a typo'd
  // worker count silently shards differently than asked. Same reject-don't-coerce
  // rule as gen-shard-config.ts's --shard-index. (MINCRM-696)
  const workersArg = argv.find((a) => a.startsWith('--workers='));
  const workersRaw = workersArg?.split('=').slice(1).join('=');
  const workersValid = workersRaw === undefined || /^\d+$/.test(workersRaw);
  const workers = workersRaw === undefined ? 4 : Number(workersRaw);
  const selectedFilesArg = argv.find((a) => a.startsWith('--selected-files='));
  // .slice(1).join('=') rather than [1], so a path containing '=' survives —
  // POSIX paths admit it freely. A truncated path is unreadable, and the caller
  // below then warns and widens to the full suite: the safe direction, but still
  // not what the operator asked for. (MINCRM-696)
  const selectedFilesPath = selectedFilesArg?.split('=').slice(1).join('=');

  // Discriminated union, matching gen-shard-config.ts's parser: on the error
  // arm the invalid value is UNREACHABLE rather than merely accompanied by an
  // error string. A flat `{ workers, error }` would hand a caller that ignored
  // `error` a NaN or a 2.9 to shard on — re-enabling one call frame away the
  // exact silent-coercion this validation exists to prevent. (MINCRM-696)
  if (!workersValid || workers < 1) {
    return {
      error: `[gen-shards] Invalid --workers value; must be a positive integer, got "${workersRaw}".`,
    };
  }

  return { workers, selectedFilesPath, error: null };
}

function parseArgs(): { workers: number; selectedFilesPath: string | undefined } {
  const parsed = parseGenShardsArgs(process.argv);
  if (parsed.error !== null) {
    process.stderr.write(`${parsed.error}\n`);
    process.exit(1);
  }
  return parsed;
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

// Direct-invocation guard, matching verify-test-attestation.ts's endsWith form
// (the sibling server scripts use exact __filename equality, which needs
// fileURLToPath — unavailable here, since Playwright transpiles these specs to
// CJS where import.meta is a syntax error).
// Without it, importing this module to unit-test parseGenShardsArgs RUNS the
// whole script — it discovers specs, reads the timing baseline and writes to
// stdout at import time. (MINCRM-696)
if (process.argv[1] && path.resolve(process.argv[1]).endsWith('gen-shards.ts')) {
  main();
}
