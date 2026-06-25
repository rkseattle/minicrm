#!/usr/bin/env tsx
/**
 * find-hotspots.ts
 *
 * Reads test-timing-baseline.json and identifies spec files whose estimated
 * duration exceeds a configurable threshold (default: 2× the median file
 * duration across the suite). Outputs a ranked list to stdout.
 *
 * Algorithm:
 *   1. Read test-timing-baseline.json produced by compute-timing-baseline.ts.
 *   2. Compute the median duration across all files in the baseline.
 *   3. Apply the threshold: files whose medianMs > thresholdMultiplier × median
 *      are classified as hot spots.
 *   4. For each hot-spot file, count top-level describe() blocks via a line scan.
 *   5. Print a ranked table: rank, duration, describe count, file path.
 *
 * Usage (from repo root):
 *   npm run e2e:timing:hotspots
 *   npm run e2e:timing:hotspots -- --threshold-multiplier=3
 *
 * MINCRM-550
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  readTimingBaseline,
  median,
  TIMING_BASELINE_FILENAME,
} from '../framework/reporting/timing-utils.js';

const E2E_DIR = path.resolve(process.cwd(), 'qa/e2e');
const BASELINE_PATH = path.join(E2E_DIR, TIMING_BASELINE_FILENAME);

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(): { thresholdMultiplier: number } {
  const arg = process.argv.find((a) => a.startsWith('--threshold-multiplier='));
  const raw = arg ? parseFloat(arg.split('=')[1] ?? '2') : 2;
  if (isNaN(raw) || raw <= 0) {
    process.stderr.write(
      `[find-hotspots] Invalid --threshold-multiplier value; must be a positive number.\n`,
    );
    process.exit(1);
  }
  return { thresholdMultiplier: raw };
}

// ── Describe-block counter ────────────────────────────────────────────────────

/**
 * Counts the number of top-level test.describe / test.describe.serial /
 * test.describe.parallel blocks in a spec file by scanning source lines.
 *
 * A "top-level" describe is one at column 0 (no leading whitespace), matching
 * the pattern used throughout the minicrm E2E suite. Nested describes inside
 * other describes are indented and are not counted.
 *
 * Returns 0 if the file cannot be read.
 */
function countTopLevelDescribes(filePath: string): number {
  const absPath = path.resolve(process.cwd(), filePath);
  let source: string;
  try {
    source = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return 0;
  }

  let count = 0;
  // Matches test.describe[.serial|.parallel]( at the start of a line (no indent).
  const DESCRIBE_RE = /^test\.describe(?:\.serial|\.parallel)?\s*\(/;
  for (const line of source.split('\n')) {
    if (DESCRIBE_RE.test(line)) {
      count++;
    }
  }
  return count;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const { thresholdMultiplier } = parseArgs();

  const baseline = readTimingBaseline(BASELINE_PATH);
  if (!baseline) {
    process.stderr.write(
      `[find-hotspots] ${BASELINE_PATH} not found.\n` +
        `  Run "npm run e2e:timing:baseline" first to generate the baseline.\n`,
    );
    process.exit(1);
  }

  const entries = Object.entries(baseline.files);
  if (entries.length === 0) {
    process.stderr.write(`[find-hotspots] Baseline contains no file entries.\n`);
    process.exit(1);
  }

  const allDurations = entries.map(([, e]) => e.medianMs);
  const suiteMedian = median(allDurations);
  const threshold = suiteMedian * thresholdMultiplier;

  const hotspots = entries
    .filter(([, e]) => e.medianMs > threshold)
    .sort((a, b) => b[1].medianMs - a[1].medianMs);

  process.stdout.write(
    `Suite median: ${fmtMs(suiteMedian)}  ` +
      `Threshold (${thresholdMultiplier}×): ${fmtMs(threshold)}  ` +
      `Hot spots: ${hotspots.length} of ${entries.length} files\n\n`,
  );

  if (hotspots.length === 0) {
    process.stdout.write(`No hot-spot files found at ${thresholdMultiplier}× threshold.\n`);
    return;
  }

  const RANK_W = 5;
  const DUR_W = 9;
  const DESC_W = 9;
  const RUNS_W = 6;

  const header =
    padLeft('Rank', RANK_W) +
    '  ' +
    padLeft('Duration', DUR_W) +
    '  ' +
    padLeft('Describes', DESC_W) +
    '  ' +
    padLeft('Runs', RUNS_W) +
    '  File\n';

  const sep =
    '-'.repeat(RANK_W) +
    '--' +
    '-'.repeat(DUR_W) +
    '--' +
    '-'.repeat(DESC_W) +
    '--' +
    '-'.repeat(RUNS_W) +
    '--' +
    '-'.repeat(60) +
    '\n';

  process.stdout.write(header);
  process.stdout.write(sep);

  hotspots.forEach(([file, entry], idx) => {
    const rank = padLeft(`${idx + 1}.`, RANK_W);
    const dur = padLeft(fmtMs(entry.medianMs), DUR_W);
    const describes = countTopLevelDescribes(file);
    const desc = padLeft(String(describes), DESC_W);
    const runs = padLeft(String(entry.runCount), RUNS_W);
    process.stdout.write(`${rank}  ${dur}  ${desc}  ${runs}  ${file}\n`);
  });

  process.stdout.write('\n');
}

main();
