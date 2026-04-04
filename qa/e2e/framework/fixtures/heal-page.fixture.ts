/**
 * healPage fixture — exposes HealingLocator through Playwright's fixture system.
 *
 * Provides zero-boilerplate access to self-healing interactions from any test
 * spec or behavior file. The fixture teardown always flushes HealingRegistry,
 * even when the test throws.
 *
 * Usage:
 * ```ts
 * import { test, expect } from '@framework/fixtures';
 *
 * test('example', async ({ healPage }) => {
 *   await healPage.click(
 *     { type: 'testId', value: 'submit-btn' },
 *     { type: 'role', value: 'button', options: { name: t('common.save') } },
 *   );
 * });
 * ```
 *
 * MINCRM-126
 */

import { test as base, type Page } from '@playwright/test';
import { HealingLocator, HealingRegistry } from '../healing/index.js';
import type { LocatorStrategy } from '../healing/index.js';

// ---------------------------------------------------------------------------
// HealPage interface
// ---------------------------------------------------------------------------

/** Options accepted by locate() in addition to the strategies array. */
export interface LocateOptions {
  /**
   * Natural-language description of what the locator is looking for.
   * Passed to HealingLocator's AI tier (S3) when all static strategies fail.
   */
  intent?: string;
  /**
   * Milliseconds to wait when probing a fallback strategy.
   * Defaults to HealingLocator's internal default (2000 ms).
   */
  fallbackTimeout?: number;
}

/**
 * The healPage fixture object injected into every test using the extended `test`.
 */
export interface HealPage {
  /**
   * Returns a HealingLocator for the given strategies.
   *
   * @param strategies - One or more LocatorStrategy objects (sorted by priority internally).
   * @param options - Optional intent string and fallback timeout.
   */
  locate(strategies: LocatorStrategy[], options?: LocateOptions): HealingLocator;

  /**
   * Resolves the locator from the given strategies and clicks the element.
   *
   * @param strategies - One or more LocatorStrategy objects.
   * @param options - Optional intent and fallback timeout.
   */
  click(strategies: LocatorStrategy[], options?: LocateOptions): Promise<void>;

  /**
   * Resolves the locator from the given strategies and fills the element with value.
   *
   * @param value - The string to type into the element.
   * @param strategies - One or more LocatorStrategy objects.
   * @param options - Optional intent and fallback timeout.
   */
  fill(value: string, strategies: LocatorStrategy[], options?: LocateOptions): Promise<void>;
}

// ---------------------------------------------------------------------------
// Fixture implementation
// ---------------------------------------------------------------------------

/** Fixtures added by this module. */
interface HealPageFixtures {
  healPage: HealPage;
}

/**
 * Builds a HealPage implementation bound to the given Playwright Page.
 * Extracted so it can be unit-tested without the full fixture machinery.
 *
 * @param page - The Playwright Page object for the current test.
 * @param testName - The name of the currently running test (passed to HealingLocator.resolve).
 * @returns A HealPage instance.
 */
export function buildHealPage(page: Page, testName: string): HealPage {
  return {
    locate(strategies: LocatorStrategy[], options: LocateOptions = {}): HealingLocator {
      return new HealingLocator(page, strategies, {
        intent: options.intent,
        fallbackTimeout: options.fallbackTimeout,
      });
    },

    async click(strategies: LocatorStrategy[], options: LocateOptions = {}): Promise<void> {
      const locator = new HealingLocator(page, strategies, {
        intent: options.intent,
        fallbackTimeout: options.fallbackTimeout,
      });
      const resolved = await locator.resolve(testName);
      await resolved.click();
    },

    async fill(
      value: string,
      strategies: LocatorStrategy[],
      options: LocateOptions = {},
    ): Promise<void> {
      const locator = new HealingLocator(page, strategies, {
        intent: options.intent,
        fallbackTimeout: options.fallbackTimeout,
      });
      const resolved = await locator.resolve(testName);
      await resolved.fill(value);
    },
  };
}

// ---------------------------------------------------------------------------
// Extended test object
// ---------------------------------------------------------------------------

/**
 * Playwright test extended with the `healPage` fixture.
 *
 * Import `test` and `expect` from `@framework/fixtures` rather than
 * `@playwright/test` in all application spec and behavior files.
 */
export const test = base.extend<HealPageFixtures>({
  healPage: async ({ page }, use, testInfo) => {
    const healPage = buildHealPage(page, testInfo.title);

    try {
      await use(healPage);
    } finally {
      // Always flush the registry, even on test failure or unhandled throw.
      HealingRegistry.instance.flush();
      HealingRegistry.instance._reset();
    }
  },
});
