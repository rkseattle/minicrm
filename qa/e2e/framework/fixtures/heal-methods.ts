/**
 * HealMethods interface and buildHealPage factory.
 *
 * Extracted into its own module so both heal-page.fixture.ts and
 * page-facade.ts can import from here without creating a circular dependency.
 *
 * MINCRM-209
 */

import type { Page } from '@playwright/test';
import {
  HealingLocator,
  buildLocator,
  STRATEGY_ORDER,
  BoundHealingLocator,
} from '../healing/index.js';
import type { LocatorStrategy } from '../healing/index.js';

// ---------------------------------------------------------------------------
// LocateOptions
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

// ---------------------------------------------------------------------------
// HealMethods interface
// ---------------------------------------------------------------------------

/**
 * All element-interaction methods exposed by the healPage fixture and PageFacade.
 */
export interface HealMethods {
  /**
   * Returns a BoundHealingLocator for the given strategies.
   * testName is captured at fixture creation — callers never pass it.
   */
  locate(strategies: LocatorStrategy[], options?: LocateOptions): BoundHealingLocator;

  /** Resolves the locator from the given strategies and clicks the element. */
  click(strategies: LocatorStrategy[], options?: LocateOptions): Promise<void>;

  /** Resolves the locator from the given strategies and fills the element with value. */
  fill(value: string, strategies: LocatorStrategy[], options?: LocateOptions): Promise<void>;

  /** Resolves the locator and waits for the given element state. */
  waitFor(
    strategies: LocatorStrategy[],
    state: 'visible' | 'hidden' | 'attached' | 'detached',
    options?: LocateOptions,
  ): Promise<void>;

  /** Resolves the locator and returns the element's text content. */
  textContent(strategies: LocatorStrategy[], options?: LocateOptions): Promise<string | null>;

  /** Resolves the locator and returns the named attribute value. */
  getAttribute(
    name: string,
    strategies: LocatorStrategy[],
    options?: LocateOptions,
  ): Promise<string | null>;

  /** Resolves the locator and returns the number of matching elements. */
  count(strategies: LocatorStrategy[], options?: LocateOptions): Promise<number>;

  /** Resolves the locator and selects the given option value. */
  selectOption(
    value: string,
    strategies: LocatorStrategy[],
    options?: LocateOptions,
  ): Promise<void>;

  /** Resolves the locator and checks the checkbox. */
  check(strategies: LocatorStrategy[], options?: LocateOptions): Promise<void>;

  /** Resolves the locator and unchecks the checkbox. */
  uncheck(strategies: LocatorStrategy[], options?: LocateOptions): Promise<void>;

  /** Resolves the locator and hovers over the element. */
  hover(strategies: LocatorStrategy[], options?: LocateOptions): Promise<void>;

  /**
   * Returns true when the element identified by the first strategy is NOT
   * attached to the DOM. Never throws. Does not record a heal event.
   *
   * @param strategies - One or more LocatorStrategy objects (only the first is used).
   * @param timeoutMs  - How long to wait for the element to detach (default 10 000 ms).
   */
  doesNotExist(strategies: LocatorStrategy[], timeoutMs?: number): Promise<boolean>;

  /**
   * Returns true when the element identified by the first strategy is either
   * absent from the DOM or present but not visible. Never throws.
   * Does not record a heal event.
   *
   * @param strategies - One or more LocatorStrategy objects (only the first is used).
   * @param timeoutMs  - How long to wait for the element to disappear (default 10 000 ms).
   */
  isNotVisible(strategies: LocatorStrategy[], timeoutMs?: number): Promise<boolean>;
}

/** Backwards-compatible alias — existing code importing HealPage continues to work. */
export type HealPage = HealMethods;

// ---------------------------------------------------------------------------
// buildHealPage factory
// ---------------------------------------------------------------------------

/**
 * Builds a HealMethods implementation bound to the given Playwright Page.
 * Extracted so it can be unit-tested without the full fixture machinery.
 *
 * @param page - The Playwright Page object for the current test.
 * @param testName - The name of the currently running test.
 * @returns A HealMethods instance.
 */
export function buildHealPage(page: Page, testName: string): HealMethods {
  return {
    locate(strategies: LocatorStrategy[], options: LocateOptions = {}): BoundHealingLocator {
      const inner = new HealingLocator(page, strategies, {
        intent: options.intent,
        fallbackTimeout: options.fallbackTimeout,
      });
      return new BoundHealingLocator(inner, testName);
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

    async waitFor(
      strategies: LocatorStrategy[],
      state: 'visible' | 'hidden' | 'attached' | 'detached',
      options: LocateOptions = {},
    ): Promise<void> {
      const locator = new HealingLocator(page, strategies, {
        intent: options.intent,
        fallbackTimeout: options.fallbackTimeout,
      });
      const resolved = await locator.resolve(testName);
      await resolved.waitFor({ state });
    },

    async textContent(
      strategies: LocatorStrategy[],
      options: LocateOptions = {},
    ): Promise<string | null> {
      const locator = new HealingLocator(page, strategies, {
        intent: options.intent,
        fallbackTimeout: options.fallbackTimeout,
      });
      const resolved = await locator.resolve(testName);
      return resolved.textContent();
    },

    async getAttribute(
      name: string,
      strategies: LocatorStrategy[],
      options: LocateOptions = {},
    ): Promise<string | null> {
      const locator = new HealingLocator(page, strategies, {
        intent: options.intent,
        fallbackTimeout: options.fallbackTimeout,
      });
      const resolved = await locator.resolve(testName);
      return resolved.getAttribute(name);
    },

    async count(strategies: LocatorStrategy[], options: LocateOptions = {}): Promise<number> {
      const locator = new HealingLocator(page, strategies, {
        intent: options.intent,
        fallbackTimeout: options.fallbackTimeout,
      });
      const resolved = await locator.resolve(testName);
      return resolved.count();
    },

    async selectOption(
      value: string,
      strategies: LocatorStrategy[],
      options: LocateOptions = {},
    ): Promise<void> {
      const locator = new HealingLocator(page, strategies, {
        intent: options.intent,
        fallbackTimeout: options.fallbackTimeout,
      });
      const resolved = await locator.resolve(testName);
      await resolved.selectOption(value);
    },

    async check(strategies: LocatorStrategy[], options: LocateOptions = {}): Promise<void> {
      const locator = new HealingLocator(page, strategies, {
        intent: options.intent,
        fallbackTimeout: options.fallbackTimeout,
      });
      const resolved = await locator.resolve(testName);
      await resolved.check();
    },

    async uncheck(strategies: LocatorStrategy[], options: LocateOptions = {}): Promise<void> {
      const locator = new HealingLocator(page, strategies, {
        intent: options.intent,
        fallbackTimeout: options.fallbackTimeout,
      });
      const resolved = await locator.resolve(testName);
      await resolved.uncheck();
    },

    async hover(strategies: LocatorStrategy[], options: LocateOptions = {}): Promise<void> {
      const locator = new HealingLocator(page, strategies, {
        intent: options.intent,
        fallbackTimeout: options.fallbackTimeout,
      });
      const resolved = await locator.resolve(testName);
      await resolved.hover();
    },

    async doesNotExist(strategies: LocatorStrategy[], timeoutMs = 10_000): Promise<boolean> {
      if (strategies.length === 0) throw new Error('doesNotExist requires at least one strategy');
      const sorted = [...strategies].sort(
        (a, b) => STRATEGY_ORDER[a.type] - STRATEGY_ORDER[b.type],
      );
      const locator = buildLocator(page, sorted[0]!);
      try {
        // Poll until detached rather than snapshotting current DOM presence.
        // waitFor({state:'attached'}) resolves immediately if the element is already
        // in the DOM, so it cannot detect future removal. (MINCRM-211)
        await locator.waitFor({ state: 'detached', timeout: timeoutMs });
        return true;
      } catch {
        return false;
      }
    },

    async isNotVisible(strategies: LocatorStrategy[], timeoutMs = 10_000): Promise<boolean> {
      if (strategies.length === 0) throw new Error('isNotVisible requires at least one strategy');
      const sorted = [...strategies].sort(
        (a, b) => STRATEGY_ORDER[a.type] - STRATEGY_ORDER[b.type],
      );
      const locator = buildLocator(page, sorted[0]!);
      try {
        // Poll until hidden/absent rather than snapshotting current visibility.
        // waitFor({state:'visible'}) resolves immediately if the element is already
        // visible, so it cannot detect future disappearance. (MINCRM-211)
        await locator.waitFor({ state: 'hidden', timeout: timeoutMs });
        return true;
      } catch {
        return false;
      }
    },
  };
}
