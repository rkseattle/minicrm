/**
 * HealingLocator — self-healing UI locator with ranked strategy fallback.
 *
 * Accepts a prioritized array of LocatorStrategy objects and tries them in
 * order. When the primary strategy fails, it attempts each fallback in turn.
 * A successful fallback triggers a heal event recorded in HealingRegistry.
 *
 * Strategy priority order (enforced by STRATEGY_ORDER constant):
 *   testId → role → label → text → css → xpath
 *
 * The `intent` field is reserved for the AI tier (S3) to describe what the
 * locator is trying to find in natural language.
 *
 * MINCRM-124
 */

import type { Locator, Page } from '@playwright/test';
import { HealingRegistry } from './healing-registry.js';
import type { LocatorStrategyRecord } from './healing-registry.js';

/** All supported locator strategy types in priority order. */
export type StrategyType = 'testId' | 'role' | 'label' | 'text' | 'css' | 'xpath';

/**
 * Enforced priority order. When the caller provides strategies in a different
 * order, HealingLocator sorts them by this table before attempting resolution.
 */
export const STRATEGY_ORDER: Record<StrategyType, number> = {
  testId: 0,
  role: 1,
  label: 2,
  text: 3,
  css: 4,
  xpath: 5,
};

/** A single locator strategy with its type, selector value, and optional options. */
export interface LocatorStrategy {
  type: StrategyType;
  value: string;
  /** Optional extra options forwarded to the Playwright locator factory (e.g. `{ exact: true }`). */
  options?: Record<string, unknown>;
}

/** Options accepted by HealingLocator constructor. */
export interface HealingLocatorOptions {
  /**
   * Milliseconds to wait when probing a fallback strategy.
   * Defaults to 2000 ms to keep healing fast.
   */
  fallbackTimeout?: number;
  /**
   * Natural-language description of what this locator is looking for.
   * Used by the AI tier (S3) when all static strategies are exhausted.
   */
  intent?: string;
}

/**
 * Thrown when every strategy in the ranked list has been tried and none resolved.
 */
export class StrategyExhaustedError extends Error {
  constructor(public readonly attempted: LocatorStrategyRecord[]) {
    const descriptions = attempted.map((s) => `${s.type}(${JSON.stringify(s.value)})`).join(', ');
    super(`HealingLocator: all strategies exhausted. Attempted: [${descriptions}]`);
    this.name = 'StrategyExhaustedError';
  }
}

/**
 * The default fallback probe timeout in milliseconds.
 * Short enough that failed strategies fail fast; long enough for typical renders.
 */
const DEFAULT_FALLBACK_TIMEOUT_MS = 2_000;

/**
 * Builds a Playwright Locator from a LocatorStrategy using the correct
 * Playwright factory method for the strategy type.
 */
function buildLocator(page: Page, strategy: LocatorStrategy): Locator {
  const { type, value, options } = strategy;
  switch (type) {
    case 'testId':
      // getByTestId does not accept extra options
      return page.getByTestId(value);
    case 'role':
      // value is the ARIA role; options may include { name, exact, ... }
      return page.getByRole(
        value as Parameters<Page['getByRole']>[0],
        options as Parameters<Page['getByRole']>[1],
      );
    case 'label':
      return page.getByLabel(value, options as Parameters<Page['getByLabel']>[1]);
    case 'text':
      return page.getByText(value, options as Parameters<Page['getByText']>[1]);
    case 'css':
      return page.locator(value);
    case 'xpath':
      return page.locator(value);
    default: {
      // Exhaustive check — TypeScript will error if a new StrategyType is added
      // without updating this switch.
      const _exhaustive: never = type;
      throw new Error(`Unknown strategy type: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Probes a locator by waiting for it to be attached to the DOM within the
 * given timeout. Returns `true` if it resolves, `false` if it times out.
 */
async function probeLocator(locator: Locator, timeoutMs: number): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'attached', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/** Converts a LocatorStrategy to the serializable record stored in HealingRegistry. */
function toRecord(strategy: LocatorStrategy): LocatorStrategyRecord {
  return {
    type: strategy.type,
    value: strategy.value,
    ...(strategy.options !== undefined ? { options: strategy.options } : {}),
  };
}

/**
 * Self-healing locator that tries strategies in priority order.
 *
 * Usage:
 * ```ts
 * const locator = await new HealingLocator(page, [
 *   { type: 'testId', value: 'submit-button' },
 *   { type: 'role',   value: 'button', options: { name: 'Submit' } },
 *   { type: 'css',    value: 'button[type="submit"]' },
 * ], { intent: 'Submit form button' }).resolve('My Test');
 * ```
 */
export class HealingLocator {
  /** Sorted strategies (by STRATEGY_ORDER). */
  private readonly strategies: LocatorStrategy[];
  private readonly fallbackTimeout: number;

  /** Natural-language description for the AI tier (S3). */
  readonly intent: string;

  /**
   * @param page - Playwright Page object.
   * @param strategies - Ranked array of strategies. Will be sorted by STRATEGY_ORDER.
   * @param options - Configuration options.
   */
  constructor(
    private readonly page: Page,
    strategies: LocatorStrategy[],
    options: HealingLocatorOptions = {},
  ) {
    if (strategies.length === 0) {
      throw new Error('HealingLocator requires at least one strategy');
    }
    // Sort by the canonical priority order so callers can provide strategies
    // in any order without accidentally breaking priority enforcement.
    this.strategies = [...strategies].sort(
      (a, b) => STRATEGY_ORDER[a.type] - STRATEGY_ORDER[b.type],
    );
    this.fallbackTimeout = options.fallbackTimeout ?? DEFAULT_FALLBACK_TIMEOUT_MS;
    this.intent = options.intent ?? '';
  }

  /**
   * Resolves the locator by trying strategies in priority order.
   *
   * - The first strategy is the "primary". If it resolves immediately (using
   *   the fallback timeout), it is returned without recording a heal event.
   * - On primary failure, each subsequent strategy is probed in order.
   * - The first fallback that resolves triggers a heal event in HealingRegistry.
   * - If all strategies are exhausted, throws StrategyExhaustedError.
   *
   * @param testName - Name of the currently running test (used in heal records).
   * @returns A resolved Playwright Locator.
   */
  async resolve(testName: string): Promise<Locator> {
    const attempted: LocatorStrategyRecord[] = [];
    const [primary, ...fallbacks] = this.strategies;

    // Try the primary strategy first.
    const primaryLocator = buildLocator(this.page, primary);
    const primaryResolved = await probeLocator(primaryLocator, this.fallbackTimeout);

    if (primaryResolved) {
      return primaryLocator;
    }

    attempted.push(toRecord(primary));

    // Try each fallback in order.
    for (const fallback of fallbacks) {
      const fallbackLocator = buildLocator(this.page, fallback);
      const resolved = await probeLocator(fallbackLocator, this.fallbackTimeout);

      if (resolved) {
        // Record the heal event.
        HealingRegistry.instance.record(
          testName,
          toRecord(primary),
          toRecord(fallback),
          false, // wasAiHeal — AI tier is S3
        );
        return fallbackLocator;
      }

      attempted.push(toRecord(fallback));
    }

    throw new StrategyExhaustedError(attempted);
  }
}
