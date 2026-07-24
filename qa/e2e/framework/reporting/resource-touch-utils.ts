/**
 * Shared types and JSONL helpers for the resource-touch reporter and the
 * conflict-graph builder script.
 *
 * Kept in framework/reporting/ alongside timing-utils.ts so framework-purity
 * checks see no app-domain strings here — resource key strings themselves
 * (e.g. "settings.nav_layout") are supplied by an app-layer reporter
 * subclass, never hardcoded here.
 */

import fs from 'node:fs';

// ── Types ────────────────────────────────────────────────────────────────────

/** One record appended to resource-touch.jsonl per test attempt. */
export interface ResourceTouchRecord {
  /** Epoch ms at the start of the Playwright run — groups records from one run. */
  runId: number;
  /** Spec file path relative to the repo root. */
  file: string;
  /** Full test title: titlePath joined with ' > '. */
  title: string;
  /** Resource keys this test reads, as reported by the app-layer lookup. */
  reads: string[];
  /** Resource keys this test writes, as reported by the app-layer lookup. */
  writes: string[];
  /** ISO-8601 timestamp when the test ended. */
  ts: string;
}

/**
 * App-layer lookup contract: given a spec file (repo-root-relative) and a
 * test's full title, return the resource keys that test reads/writes, or
 * null if the test touches no tracked shared resource. Implemented by an
 * app-layer reporter subclass that supplies this lookup statically —
 * avoiding a dynamically-computed import() path, which cannot resolve its
 * own further imports under the test runner's TS transform step.
 */
export interface ResourceTouchLookup {
  (file: string, title: string): { reads: string[]; writes: string[] } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const RESOURCE_TOUCH_JSONL_FILENAME = 'resource-touch.jsonl';

// ── JSONL helpers ─────────────────────────────────────────────────────────────

/**
 * Appends a single ResourceTouchRecord as a JSON line to the given file path.
 * Wrapped in try/catch — a disk error is logged to stderr but never throws,
 * so a filesystem problem cannot fail the test run.
 */
export function appendResourceTouchRecord(filePath: string, record: ResourceTouchRecord): void {
  try {
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    process.stderr.write(`[ResourceTouchReporter] Failed to append record: ${String(err)}\n`);
  }
}

/**
 * Reads and parses all valid JSON lines from a JSONL file.
 * Invalid lines are silently skipped so a single corrupt record cannot
 * prevent the rest of the history from being read.
 */
export function readResourceTouchRecords(filePath: string): ResourceTouchRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const records: ResourceTouchRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as ResourceTouchRecord);
    } catch {
      // Skip malformed lines
    }
  }
  return records;
}
