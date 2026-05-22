/**
 * HealTrendStore — persistent cross-run heal count accumulator.
 *
 * Reads and writes `qa/e2e/heal-trends.json`, a git-tracked file that
 * accumulates per-locator heal counts across runs. Stored outside test-results/
 * so it is never gitignored and survives across CI runs without force-adding.
 *
 * Deduplication key: `pageObject::method::originalStrategy.type::originalStrategy.value`
 * — the same key used by PatchSuggester, ensuring the two systems agree on
 * what constitutes a "unique locator".
 */

import fs from 'node:fs';
import path from 'node:path';
import type { HealEvent } from './healing-registry.js';

// Resolve relative to this source file so the path is correct regardless of
// the working directory from which Playwright is invoked.
const E2E_DIR = path.resolve(__dirname, '..', '..');
let trendsFile = path.join(E2E_DIR, 'heal-trends.json');

const DEFAULT_TRENDS_FILE = trendsFile;

/**
 * Override the trends file path. For testing only — never call in production code.
 */
export function setTrendsFileForTesting(p: string): void {
  trendsFile = p;
}

/**
 * Restore the trends file path to its production default. For testing only.
 */
export function resetTrendsFileForTesting(): void {
  trendsFile = DEFAULT_TRENDS_FILE;
}

/** Per-locator trend entry stored in heal-trends.json. */
export interface HealTrendEntry {
  pageObject: string;
  method: string;
  originalStrategyType: string;
  originalStrategyValue: string;
  /** Accumulated heal count across all runs. */
  count: number;
  /** ISO timestamp of the first heal ever recorded for this locator. */
  firstSeenAt: string;
  /** ISO timestamp of the most recent heal recorded for this locator. */
  lastSeenAt: string;
}

/** Shape of the heal-trends.json file on disk. */
export interface HealTrendsFile {
  updatedAt: string;
  entries: Record<string, HealTrendEntry>;
}

/**
 * Builds the deduplication key for a heal event.
 * Identical to the key used in PatchSuggester.
 */
export function buildTrendKey(event: HealEvent): string {
  const pageObject = event.pageObject ?? 'Unknown';
  const method = event.method ?? 'unknown';
  return `${pageObject}::${method}::${event.originalStrategy.type}::${event.originalStrategy.value}`;
}

/**
 * Reads the current heal-trends.json from disk.
 * Returns an empty trend map when the file is absent or malformed.
 */
export function readTrends(): Record<string, HealTrendEntry> {
  try {
    const raw = fs.readFileSync(trendsFile, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HealTrendsFile>;
    if (parsed.entries && typeof parsed.entries === 'object') {
      return parsed.entries;
    }
  } catch {
    // File absent or corrupt — start fresh.
  }
  return {};
}

/**
 * Merges current-run heal events into an existing trend map (mutates in place)
 * and returns it. Each unique locator key has its count incremented by the
 * number of times it healed this run (not just once — a locator can heal
 * multiple times in a single run if the same test is parameterised or retried).
 */
export function mergeTrends(
  existing: Record<string, HealTrendEntry>,
  events: HealEvent[],
): Record<string, HealTrendEntry> {
  for (const event of events) {
    const key = buildTrendKey(event);
    const now = event.timestamp;
    if (existing[key]) {
      existing[key].count += 1;
      existing[key].lastSeenAt = now;
    } else {
      existing[key] = {
        pageObject: event.pageObject ?? 'Unknown',
        method: event.method ?? 'unknown',
        originalStrategyType: event.originalStrategy.type,
        originalStrategyValue: event.originalStrategy.value,
        count: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      };
    }
  }
  return existing;
}

/**
 * Writes the merged trend map back to heal-trends.json.
 * Creates the output directory if absent.
 */
export function writeTrends(entries: Record<string, HealTrendEntry>): void {
  const file: HealTrendsFile = {
    updatedAt: new Date().toISOString(),
    entries,
  };
  fs.mkdirSync(path.dirname(trendsFile), { recursive: true });
  fs.writeFileSync(trendsFile, JSON.stringify(file, null, 2), 'utf-8');
}

/**
 * Returns all trend entries whose accumulated count meets or exceeds the
 * quarantine threshold.
 */
export function quarantineCandidates(
  entries: Record<string, HealTrendEntry>,
  threshold: number,
): HealTrendEntry[] {
  return Object.values(entries).filter((e) => e.count >= threshold);
}
