/**
 * HealingReporter — custom Playwright reporter that merges per-worker heal logs.
 *
 * On onEnd(), reads all `test-results/healing-<workerId>.json` files produced
 * by worker processes, merges them into a single `test-results/healing-report.json`,
 * and logs a summary to CI output.
 *
 * AI heals (wasAiHeal=true) are flagged separately in the summary — none are
 * expected until S3 is implemented.
 *
 * Sharded runs: in a sharded CI setup, each shard runner executes its own
 * Playwright process and its own HealingReporter.onEnd(). The per-shard
 * reporter produces a partial healing-report.json containing only that shard's
 * events. The complete merged report across all shards is produced by the
 * standalone merge script (qa/scripts/merge-healing-artifacts.ts), which runs
 * in a post-shard CI step after artifacts from all shards are downloaded.
 *
 * Register in playwright.config.ts:
 *   reporters: [['./framework/healing/healing-reporter.ts']]
 *
 * MINCRM-124, MINCRM-216
 */

import type { Reporter, TestResult, TestCase, FullResult } from '@playwright/test/reporter';
import fs from 'node:fs';
import path from 'node:path';
import { HealingRegistry } from './healing-registry.js';
import type { HealEvent } from './healing-registry.js';
import { generatePatchSuggestions } from './patch-suggester.js';
import type { PatchSuggestion } from './patch-suggester.js';

const OUTPUT_DIR = 'test-results';
// Matches both the original format (healing-0.json) and the shard-aware format
// (healing-shard1-worker0.json) produced when SHARD_INDEX is set. MINCRM-216
const WORKER_FILE_PATTERN = /^healing-(shard\d+-worker\d+|\d+)\.json$/;
const REPORT_FILE = path.join(OUTPUT_DIR, 'healing-report.json');
const SUGGESTIONS_FILE = path.join(OUTPUT_DIR, 'healing-suggestions.md');

/** Schema of the merged healing report file. */
export interface HealingReport {
  generatedAt: string;
  totalHeals: number;
  aiHeals: number;
  staticHeals: number;
  events: HealEvent[];
}

/**
 * Builds the markdown content for healing-suggestions.md from a list of
 * PatchSuggestion objects. Exported for unit testing. MINCRM-225
 */
export function buildSuggestionsMarkdown(suggestions: PatchSuggestion[]): string {
  if (suggestions.length === 0) {
    return 'No heal events this run.\n';
  }
  const lines: string[] = ['# Healing Patch Suggestions', ''];
  for (const s of suggestions) {
    lines.push(`## ${s.pageObject}.${s.method}`);
    lines.push('');
    lines.push(s.instruction);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Reads a single worker healing file and returns its events.
 * Returns an empty array if the file is missing or malformed.
 */
function readWorkerFile(filePath: string): HealEvent[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { events?: HealEvent[] };
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

/**
 * Custom Playwright reporter that produces a merged healing report at the end
 * of the test run. Implements the minimal Reporter interface surface needed.
 */
export class HealingReporter implements Reporter {
  /**
   * Called by Playwright when the entire run finishes.
   * Merges per-worker files, writes the combined report, and logs a summary.
   */
  onEnd(_result: FullResult): void {
    // Only flush in worker processes. PW_WORKER_INDEX is set by Playwright on
    // worker processes but is unset in the main (reporter) process. Flushing in
    // the main process would write an empty healing-0.json (the fallback worker
    // ID), silently overwriting any real events written by worker 0.
    if (process.env['PW_WORKER_INDEX'] !== undefined) {
      HealingRegistry.instance.flush();
    }

    const allEvents: HealEvent[] = [];

    // Collect all worker healing files.
    let workerFiles: string[] = [];
    try {
      workerFiles = fs
        .readdirSync(OUTPUT_DIR)
        .filter((name) => WORKER_FILE_PATTERN.test(name))
        .map((name) => path.join(OUTPUT_DIR, name));
    } catch {
      // Output dir may not exist if no tests ran.
    }

    for (const filePath of workerFiles) {
      allEvents.push(...readWorkerFile(filePath));
    }

    const aiHeals = allEvents.filter((e) => e.wasAiHeal).length;
    const staticHeals = allEvents.length - aiHeals;

    const report: HealingReport = {
      generatedAt: new Date().toISOString(),
      totalHeals: allEvents.length,
      aiHeals,
      staticHeals,
      events: allEvents,
    };

    // Write the merged report.
    try {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[HealingReporter] Failed to write report: ${String(err)}`);
    }

    // Write patch suggestions alongside the report. MINCRM-225
    this._writeSuggestions(report);

    // Log summary to CI output.
    this._logSummary(report);
  }

  /**
   * Logs the heal summary. Kept as a separate method so tests can spy on it.
   */
  _logSummary(report: HealingReport): void {
    console.log(
      `\n[HealingReporter] Heal summary — total: ${report.totalHeals}, static: ${report.staticHeals}, AI: ${report.aiHeals}`,
    );
    if (report.aiHeals > 0) {
      console.warn(
        `[HealingReporter] ⚠ ${report.aiHeals} AI heal(s) detected — review before merging.`,
      );
    }
    if (report.totalHeals === 0) {
      console.log('[HealingReporter] No heals recorded. All primary locators resolved.');
    }
  }

  /**
   * Generates patch suggestions from the report and writes healing-suggestions.md.
   * Always writes the file — an absent file is harder to distinguish from a CI
   * artifact upload failure than an empty one. MINCRM-225
   */
  _writeSuggestions(report: HealingReport): void {
    const suggestions = generatePatchSuggestions(report);
    const markdown = buildSuggestionsMarkdown(suggestions);
    try {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      fs.writeFileSync(SUGGESTIONS_FILE, markdown, 'utf-8');
    } catch (err) {
      console.error(`[HealingReporter] Failed to write suggestions: ${String(err)}`);
    }
  }

  // Playwright Reporter interface stubs — not used but required by the type.
  onTestBegin(_test: TestCase, _result: TestResult): void {}
  onTestEnd(_test: TestCase, _result: TestResult): void {}
}

// Playwright requires reporter files to export a single default class.
export default HealingReporter;
