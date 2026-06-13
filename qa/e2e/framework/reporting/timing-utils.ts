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
