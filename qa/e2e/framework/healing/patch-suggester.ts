/**
 * patch-suggester — generates human-readable strategy-array patch suggestions
 * from a merged HealingReport, closing the self-healing loop by telling
 * developers exactly which Page Object strategy to promote.
 *
 * MINCRM-225
 */

import type { HealingReport } from './healing-reporter.js';
import type { LocatorStrategyRecord } from './healing-registry.js';

/** A single patch suggestion derived from a unique heal event. */
export interface PatchSuggestion {
  /** Page Object class name (or "Unknown" when not recorded). */
  pageObject: string;
  /** Page Object method name (or "unknown" when not recorded). */
  method: string;
  /** The strategy type that succeeded (e.g. "role", "css"). */
  winningStrategyType: string;
  /** The strategy value that succeeded. */
  winningStrategyValue: string;
  /** Plain-English instruction for the developer. */
  instruction: string;
}

function formatStrategy(strategy: LocatorStrategyRecord): string {
  return JSON.stringify({ type: strategy.type, value: strategy.value });
}

/**
 * Derives patch suggestions from a merged HealingReport.
 *
 * Deduplication key: pageObject + method + originalStrategy.type + originalStrategy.value.
 * Including the value ensures two different locators on the same method that share a
 * strategy type (e.g. two testId strategies with different values) each get a suggestion.
 * When multiple heals for the same locator occur in one run, only the first winning
 * strategy is surfaced (earliest timestamp wins after sort).
 */
export function generatePatchSuggestions(report: HealingReport): PatchSuggestion[] {
  const seen = new Set<string>();
  const suggestions: PatchSuggestion[] = [];

  // Sort by timestamp so earliest-recorded win is used on dedup collision.
  const sorted = [...report.events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  for (const event of sorted) {
    const pageObject = event.pageObject ?? 'Unknown';
    const method = event.method ?? 'unknown';
    const dedupKey = `${pageObject}::${method}::${event.originalStrategy.type}::${event.originalStrategy.value}`;

    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const strategyLiteral = formatStrategy(event.healedStrategy);
    const instruction = `Move ${strategyLiteral} to position 0 in the strategy array for ${pageObject}.${method}`;

    suggestions.push({
      pageObject,
      method,
      winningStrategyType: event.healedStrategy.type,
      winningStrategyValue: event.healedStrategy.value,
      instruction,
    });
  }

  return suggestions;
}
