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
 */

import type { Reporter, TestResult, TestCase, FullResult } from '@playwright/test/reporter';
import fs from 'node:fs';
import path from 'node:path';
import { HealingRegistry } from './healing-registry.js';
import type { HealEvent } from './healing-registry.js';
import { generatePatchSuggestions } from './patch-suggester.js';
import type { PatchSuggestion } from './patch-suggester.js';
import { readTrends, mergeTrends, writeTrends, quarantineCandidates } from './heal-trends.js';
import type { HealTrendEntry } from './heal-trends.js';
import { readWorkerArtifact } from '../reporting/worker-artifact-utils.js';

const OUTPUT_DIR = 'test-results';
// Matches both the original format (healing-0.json) and the shard-aware format
// (healing-shard1-worker0.json) produced when SHARD_INDEX is set.
const WORKER_FILE_PATTERN = /^healing-(shard\d+-worker\d+|\d+)\.json$/;
const REPORT_FILE = path.join(OUTPUT_DIR, 'healing-report.json');
const SUGGESTIONS_FILE = path.join(OUTPUT_DIR, 'healing-suggestions.md');

/** Schema of the merged healing report file. */
export interface HealingReport {
  generatedAt: string;
  totalHeals: number;
  aiHeals: number;
  staticHeals: number;
  /** Count of AI heal events this run. Computed from events at report-generation time. */
  aiHealCount: number;
  /** Sum of tokenCost across all AI heal events. Computed at report-generation time. */
  estimatedTokenCost: number;
  events: HealEvent[];
  /** Accumulated heal counts across all runs, keyed by deduplicated locator key. */
  trends?: Record<string, HealTrendEntry>;
  /** Locators that meet or exceed the quarantine threshold this run. */
  quarantineEligible?: HealTrendEntry[];
}

/**
 * Builds the markdown content for healing-suggestions.md from a list of
 * PatchSuggestion objects. Exported for unit testing.
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
  return readWorkerArtifact<HealEvent>(filePath, 'events', 'HealingReporter');
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

    const aiHealEvents = allEvents.filter((e) => e.wasAiHeal);
    const aiHeals = aiHealEvents.length;
    const staticHeals = allEvents.length - aiHeals;
    const estimatedTokenCost = aiHealEvents.reduce((sum, e) => sum + (e.tokenCost ?? 0), 0);

    // Merge this run's events into the persistent cross-run trend store.
    let mergedTrends: Record<string, HealTrendEntry> = {};
    try {
      const existing = readTrends();
      mergedTrends = mergeTrends(existing, allEvents);
      if (allEvents.length > 0) {
        writeTrends(mergedTrends);
      }
    } catch (err) {
      console.error(`[HealingReporter] Failed to update heal-trends.json: ${String(err)}`);
    }

    const eligible = quarantineCandidates(mergedTrends, this._quarantineThreshold());

    const report: HealingReport = {
      generatedAt: new Date().toISOString(),
      totalHeals: allEvents.length,
      aiHeals,
      staticHeals,
      aiHealCount: aiHeals,
      estimatedTokenCost,
      events: allEvents,
      trends: mergedTrends,
      quarantineEligible: eligible,
    };

    // Write the merged report.
    try {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[HealingReporter] Failed to write report: ${String(err)}`);
    }

    // Write patch suggestions alongside the report.
    this._writeSuggestions(report);

    // Emit a warning when AI heal count exceeds the configured threshold.
    this._checkThreshold(report);

    // Emit quarantine-eligible warnings.
    this._checkQuarantine(eligible);

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
   * Emits a stdout warning when aiHealCount exceeds AI_HEAL_COST_WARNING_THRESHOLD.
   * Threshold defaults to 50. Warning fires only when count is strictly greater than
   * the threshold.
   */
  _checkThreshold(report: HealingReport): void {
    const threshold = parseInt(process.env['AI_HEAL_COST_WARNING_THRESHOLD'] ?? '50', 10);
    if (report.aiHealCount > threshold) {
      console.log(
        `⚠ AI healing threshold exceeded: ${report.aiHealCount} AI heals this run (threshold: ${threshold}). Review healing-suggestions.md for locators to repair.`,
      );
    }
  }

  /** Returns the configured quarantine threshold (default 3). */
  _quarantineThreshold(): number {
    return parseInt(process.env['HEAL_QUARANTINE_THRESHOLD'] ?? '3', 10);
  }

  /**
   * Logs a warning block listing quarantine-eligible locators.
   * A quarantine-eligible locator has accumulated heal count >= HEAL_QUARANTINE_THRESHOLD.
   * Quarantine is a human decision — this method only surfaces the signal.
   */
  _checkQuarantine(eligible: HealTrendEntry[]): void {
    if (eligible.length === 0) return;
    const threshold = this._quarantineThreshold();
    console.warn(
      `\n[HealingReporter] ⚠ ${eligible.length} locator(s) are quarantine-eligible (healed ≥ ${threshold} times across runs):`,
    );
    for (const entry of eligible) {
      console.warn(
        `  - ${entry.pageObject}.${entry.method} [${entry.originalStrategyType}="${entry.originalStrategyValue}"] — healed ${entry.count} time(s)`,
      );
    }
    console.warn(
      `  Review these locators and update their strategy arrays. See healing-suggestions.md for details.\n`,
    );
  }

  /**
   * Generates patch suggestions from the report and writes healing-suggestions.md.
   * Always writes the file — an absent file is harder to distinguish from a CI
   * artifact upload failure than an empty one.
   */
  _writeSuggestions(report: HealingReport): void {
    const suggestions = generatePatchSuggestions(report, report.trends);
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
