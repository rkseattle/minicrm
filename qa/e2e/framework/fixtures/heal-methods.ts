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
  /**
   * Page Object class name that owns this locator. Recorded in heal events
   * so patch-suggester can generate actionable suggestions. MINCRM-225
   */
  pageObject?: string;
  /**
   * Page Object method name that owns this locator. Recorded in heal events
   * so patch-suggester can generate actionable suggestions. MINCRM-225
   */
  method?: string;
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
    timeout?: number,
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
   * Returns true when the element identified by the given strategies is NOT
   * attached to the DOM. Never throws. Does not record a heal event.
   *
   * Probes strategies 0 and 1 (MINCRM-230): if strategy 0 reports absence but
   * strategy 1 finds the element present, returns false (element is present).
   * This guards against stale primary locators producing false-positive absence.
   *
   * @param strategies - One or more LocatorStrategy objects.
   * @param timeoutMs  - How long to wait for the element to detach (default 10 000 ms).
   */
  doesNotExist(strategies: LocatorStrategy[], timeoutMs?: number): Promise<boolean>;

  /**
   * Returns true when the element identified by the given strategies is either
   * absent from the DOM or present but not visible. Never throws.
   * Does not record a heal event.
   *
   * Probes strategies 0 and 1 (MINCRM-230): if strategy 0 reports hidden/absent
   * but strategy 1 finds the element visible, returns false (element is visible).
   * This guards against stale primary locators producing false-positive not-visible.
   *
   * @param strategies - One or more LocatorStrategy objects.
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
  function makeHealingLocator(
    strategies: LocatorStrategy[],
    options: LocateOptions,
  ): HealingLocator {
    return new HealingLocator(page, strategies, {
      intent: options.intent,
      fallbackTimeout: options.fallbackTimeout,
      pageObject: options.pageObject,
      method: options.method,
    });
  }

  async function resolveLocator(strategies: LocatorStrategy[], options: LocateOptions) {
    return makeHealingLocator(strategies, options).resolve(testName);
  }

  return {
    locate(strategies: LocatorStrategy[], options: LocateOptions = {}): BoundHealingLocator {
      return new BoundHealingLocator(makeHealingLocator(strategies, options), testName);
    },

    async click(strategies: LocatorStrategy[], options: LocateOptions = {}): Promise<void> {
      await (await resolveLocator(strategies, options)).click();
    },

    async fill(
      value: string,
      strategies: LocatorStrategy[],
      options: LocateOptions = {},
    ): Promise<void> {
      await (await resolveLocator(strategies, options)).fill(value);
    },

    async waitFor(
      strategies: LocatorStrategy[],
      state: 'visible' | 'hidden' | 'attached' | 'detached',
      options: LocateOptions = {},
      timeout?: number,
    ): Promise<void> {
      await (await resolveLocator(strategies, options)).waitFor({ state, timeout });
    },

    async textContent(
      strategies: LocatorStrategy[],
      options: LocateOptions = {},
    ): Promise<string | null> {
      return (await resolveLocator(strategies, options)).textContent();
    },

    async getAttribute(
      name: string,
      strategies: LocatorStrategy[],
      options: LocateOptions = {},
    ): Promise<string | null> {
      return (await resolveLocator(strategies, options)).getAttribute(name);
    },

    async count(strategies: LocatorStrategy[], options: LocateOptions = {}): Promise<number> {
      return (await resolveLocator(strategies, options)).count();
    },

    async selectOption(
      value: string,
      strategies: LocatorStrategy[],
      options: LocateOptions = {},
    ): Promise<void> {
      await (await resolveLocator(strategies, options)).selectOption(value);
    },

    async check(strategies: LocatorStrategy[], options: LocateOptions = {}): Promise<void> {
      await (await resolveLocator(strategies, options)).check();
    },

    async uncheck(strategies: LocatorStrategy[], options: LocateOptions = {}): Promise<void> {
      await (await resolveLocator(strategies, options)).uncheck();
    },

    async hover(strategies: LocatorStrategy[], options: LocateOptions = {}): Promise<void> {
      await (await resolveLocator(strategies, options)).hover();
    },

    /**
     * Returns true when the element identified by the given strategies is NOT
     * attached to the DOM. Never throws. Does not record a heal event.
     *
     * TWO-STRATEGY PROBE (MINCRM-230):
     * - Full healing is NOT applied because healing "not found" would produce
     *   false negatives — if we healed to a fallback and it also wasn't found,
     *   we'd still conclude absent when the element may just be named differently.
     * - Two strategies ARE probed for drift resilience: if the primary testId is
     *   stale (data-testid renamed), waitFor(detached) resolves immediately
     *   because 0 elements match — a false-positive absence. Checking strategy 1
     *   catches this: if strategy 1 finds the element present, we override to
     *   "present" (false). The probe is intentionally limited to strategies 0
     *   and 1 — extending further increases the risk of finding something
     *   unintended.
     * - No heal event is recorded because probing for absence is not healing;
     *   recording a heal here would misrepresent what happened.
     *
     * @param strategies - One or more LocatorStrategy objects.
     * @param timeoutMs  - How long to wait for the element to detach (default 10 000 ms).
     */
    async doesNotExist(strategies: LocatorStrategy[], timeoutMs = 10_000): Promise<boolean> {
      if (strategies.length === 0) throw new Error('doesNotExist requires at least one strategy');
      const sorted = [...strategies].sort(
        (a, b) => STRATEGY_ORDER[a.type] - STRATEGY_ORDER[b.type],
      );
      const locator = buildLocator(page, sorted[0]!);
      let strategy0Absent: boolean;
      try {
        // Poll until detached rather than snapshotting current DOM presence.
        // waitFor({state:'attached'}) resolves immediately if the element is already
        // in the DOM, so it cannot detect future removal. (MINCRM-211)
        await locator.waitFor({ state: 'detached', timeout: timeoutMs });
        strategy0Absent = true;
      } catch {
        return false;
      }

      // Strategy 0 says absent — probe strategy 1 to guard against a stale
      // primary locator (e.g. data-testid renamed). If strategy 1 finds the
      // element present, it is not absent. No heal event is recorded.
      if (strategy0Absent && sorted.length > 1) {
        const locator1 = buildLocator(page, sorted[1]!);
        try {
          await locator1.waitFor({ state: 'attached', timeout: timeoutMs });
          // Strategy 1 found the element — it is present despite strategy 0 reporting absent.
          return false;
        } catch {
          // Strategy 1 also timed out — element is genuinely absent.
        }
      }

      return true;
    },

    /**
     * Returns true when the element identified by the given strategies is either
     * absent from the DOM or present but not visible. Never throws.
     * Does not record a heal event.
     *
     * TWO-STRATEGY PROBE (MINCRM-230):
     * - Full healing is NOT applied because healing "not visible" would produce
     *   false negatives — a healed locator that also reports hidden would still
     *   conclude absent/hidden when the element may just be named differently.
     * - Two strategies ARE probed for drift resilience: if the primary testId is
     *   stale (data-testid renamed), waitFor(hidden) resolves immediately because
     *   0 elements match — a false-positive not-visible. Checking strategy 1
     *   catches this: if strategy 1 finds the element visible, we override to
     *   "visible" (false). The probe is intentionally limited to strategies 0
     *   and 1 — extending further increases the risk of finding something
     *   unintended.
     * - No heal event is recorded because probing for absence is not healing;
     *   recording a heal here would misrepresent what happened.
     *
     * @param strategies - One or more LocatorStrategy objects.
     * @param timeoutMs  - How long to wait for the element to disappear (default 10 000 ms).
     */
    async isNotVisible(strategies: LocatorStrategy[], timeoutMs = 10_000): Promise<boolean> {
      if (strategies.length === 0) throw new Error('isNotVisible requires at least one strategy');
      const sorted = [...strategies].sort(
        (a, b) => STRATEGY_ORDER[a.type] - STRATEGY_ORDER[b.type],
      );
      const locator = buildLocator(page, sorted[0]!);
      let strategy0Hidden: boolean;
      try {
        // Poll until hidden/absent rather than snapshotting current visibility.
        // waitFor({state:'visible'}) resolves immediately if the element is already
        // visible, so it cannot detect future disappearance. (MINCRM-211)
        await locator.waitFor({ state: 'hidden', timeout: timeoutMs });
        strategy0Hidden = true;
      } catch {
        return false;
      }

      // Strategy 0 says hidden/absent — probe strategy 1 to guard against a
      // stale primary locator (e.g. data-testid renamed). If strategy 1 finds
      // the element visible, it is not hidden. No heal event is recorded.
      if (strategy0Hidden && sorted.length > 1) {
        const locator1 = buildLocator(page, sorted[1]!);
        try {
          await locator1.waitFor({ state: 'visible', timeout: timeoutMs });
          // Strategy 1 found the element visible — it is not hidden.
          return false;
        } catch {
          // Strategy 1 also timed out — element is genuinely hidden/absent.
        }
      }

      return true;
    },
  };
}
