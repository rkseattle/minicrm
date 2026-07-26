/**
 * Shared utilities for the timing reporter and timing scripts.
 *
 * Kept in framework/reporting/ alongside step-summary-reporter.ts and
 * perf-reporter.ts so framework-purity checks see no app-domain strings here.
 *
 * See: qa/e2e/scripts/compute-timing-baseline.ts, gen-shards.ts, gen-shard-config.ts
 */

import fs from 'node:fs';
import path from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────────

/** One record appended to test-timing.jsonl per test attempt. */
export interface TimingRecord {
  /** Epoch ms at the start of the Playwright run — groups all records from one run. */
  runId: number;
  /** Spec file path relative to the repo root (normalized with path.relative). */
  file: string;
  /** Full test title: titlePath joined with ' > '. */
  title: string;
  /** Wall-clock duration of this attempt in milliseconds. */
  duration: number;
  /** Playwright result status for this attempt. */
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  /** ISO-8601 timestamp when the test ended. */
  ts: string;
}

/** One entry in test-timing-baseline.json — the median duration per spec file. */
export interface BaselineEntry {
  /** Median duration in ms across all qualifying runs. */
  medianMs: number;
  /** Number of distinct runIds contributing to this median. */
  runCount: number;
}

/** Full content of test-timing-baseline.json. */
export interface TimingBaseline {
  /** ISO-8601 timestamp when the baseline was generated. */
  generatedAt: string;
  /** Fallback duration used for files below the run-count threshold (ms). */
  fallbackMs: number;
  /** Map of relative file path → baseline entry. */
  files: Record<string, BaselineEntry>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const TIMING_JSONL_FILENAME = 'test-timing.jsonl';
export const TIMING_BASELINE_FILENAME = 'test-timing-baseline.json';

/** Statuses excluded from median calculations — not representative of real duration. */
export const EXCLUDED_STATUSES: ReadonlySet<TimingRecord['status']> = new Set([
  'skipped',
  'timedOut',
]);

/** Minimum distinct run count before a file's baseline is considered stable. */
export const MIN_RUN_COUNT = 3;

/** Default fallback duration (ms) for files below the MIN_RUN_COUNT threshold. */
export const DEFAULT_FALLBACK_MS = 30_000;

// ── JSONL helpers ─────────────────────────────────────────────────────────────

/**
 * Appends a single TimingRecord as a JSON line to the given file path.
 * Wrapped in try/catch — a disk error is logged to stderr but never throws,
 * so a filesystem problem cannot fail the test run.
 */
export function appendTimingRecord(filePath: string, record: TimingRecord): void {
  try {
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    process.stderr.write(`[TimingReporter] Failed to append record: ${String(err)}\n`);
  }
}

/**
 * Reads and parses all valid JSON lines from a JSONL file.
 * Invalid lines are silently skipped so a single corrupt record cannot
 * prevent the rest of the history from being read.
 */
export function readTimingRecords(filePath: string): TimingRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const records: TimingRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as TimingRecord);
    } catch {
      // Skip malformed lines
    }
  }
  return records;
}

// ── Baseline helpers ──────────────────────────────────────────────────────────

/** Writes a TimingBaseline object to the given file path. */
export function writeTimingBaseline(filePath: string, baseline: TimingBaseline): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
}

/**
 * Reads and parses test-timing-baseline.json.
 * Returns null if the file does not exist or cannot be parsed.
 */
export function readTimingBaseline(filePath: string): TimingBaseline | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as TimingBaseline;
  } catch {
    return null;
  }
}

// ── LPT bin-packing ───────────────────────────────────────────────────────────

export interface FileDuration {
  file: string;
  estimatedMs: number;
}

/** Recursively discovers *.spec.ts files under dir, returned as repo-root-relative paths. */
export function discoverSpecFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...discoverSpecFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
      results.push(path.relative(process.cwd(), fullPath));
    }
  }
  return results.sort();
}

/**
 * Reads a selected file list — a JSON file containing either a bare
 * `string[]` of repo-root-relative spec file paths, or an object with a
 * `specFiles: string[]` property (a shape a selection CLI's own JSON
 * result can already produce, so its stdout can be redirected straight to
 * this file with no reshaping). Returns null if the path is unset, the
 * file doesn't exist, or its content doesn't parse as either accepted
 * shape — callers treat null identically to "no selection provided" and
 * fall back to discoverSpecFiles(), never a hard failure, since a
 * malformed/missing selection file must degrade to the safe full-suite
 * behavior, not block shard generation entirely.
 */
export function readSelectedFiles(filePath: string | undefined): string[] | null {
  if (!filePath) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
    return parsed;
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'specFiles' in parsed &&
    Array.isArray((parsed as { specFiles: unknown }).specFiles) &&
    (parsed as { specFiles: unknown[] }).specFiles.every((entry) => typeof entry === 'string')
  ) {
    return (parsed as { specFiles: string[] }).specFiles;
  }
  return null;
}

/**
 * Extracts test title strings from a spec file's `test(...)` / `test.only(...)`
 * / `test.skip(...)` / `test.fixme(...)` calls whose title contains the given
 * tag substring (e.g. "@serial"). This is a best-effort regex scan over the
 * opening title-string argument, not a full TS parse — sufficient to
 * distinguish an actual test tag from the same substring appearing elsewhere
 * in the file (a comment, a variable name, prose in a JSDoc block, etc.),
 * which a plain `content.includes(tag)` check cannot do.
 *
 * Template literal titles (`` test(`... @serial ... ${x}`, ...) ``) ARE
 * matched: the capture group's delimiter class includes backticks, and any
 * `${...}` interpolation is captured as literal text alongside the static
 * portions of the string, so a statically-written tag substring is still
 * found. The one case this (or any static-analysis approach) cannot detect
 * is the tag itself arriving only via interpolation, e.g.
 * `` test(`some test ${tagVar}`, ...) `` where `tagVar` happens to equal
 * '@serial' at runtime — no spec in this repo does that today.
 */
export function findTaggedTestTitles(fileAbsPath: string, tag: string): string[] {
  const content = fs.readFileSync(fileAbsPath, 'utf-8');
  const titles: string[] = [];
  const testCallRegex = /\btest(?:\.(?:only|skip|fixme))?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = testCallRegex.exec(content)) !== null) {
    const title = match[2] ?? '';
    if (title.includes(tag)) {
      titles.push(title);
    }
  }
  return titles;
}

/**
 * LPT (Longest Processing Time) greedy bin-packing.
 * Returns workerCount buckets of file paths, balanced by estimated wall time.
 */
export function lptAssign(files: FileDuration[], workerCount: number): string[][] {
  const sorted = [...files].sort((a, b) => b.estimatedMs - a.estimatedMs);
  const buckets: string[][] = Array.from({ length: workerCount }, () => []);
  const totals: number[] = Array.from({ length: workerCount }, () => 0);

  for (const { file, estimatedMs } of sorted) {
    let minIdx = 0;
    for (let i = 1; i < workerCount; i++) {
      if ((totals[i] as number) < (totals[minIdx] as number)) minIdx = i;
    }
    (buckets[minIdx] as string[]).push(file);
    (totals[minIdx] as number) += estimatedMs;
  }

  return buckets;
}

// ── Math helpers ──────────────────────────────────────────────────────────────

/** Returns the median value of a sorted or unsorted array of numbers. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}
