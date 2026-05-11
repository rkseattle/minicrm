/**
 * HealMethods interface and buildHealPage factory.
 *
 * Extracted into its own module so both heal-page.fixture.ts and
 * page-facade.ts can import from here without creating a circular dependency.
 *
 */

import type {
  Page,
  Locator,
  Route,
  Request,
  PageAssertionsToHaveScreenshotOptions,
} from '@playwright/test';
import { expect } from '@playwright/test';
import type { AxeResults } from 'axe-core';
import {
  HealingLocator,
  HealingRegistry,
  buildLocator,
  STRATEGY_ORDER,
  BoundHealingLocator,
  StrategyExhaustedError,
} from '../healing/index.js';
import type { LocatorStrategy, LocatorStrategyRecord } from '../healing/index.js';
import type { SafePage } from '../types/safe-page.js';
import type { SafeLocator } from '../types/safe-locator.js';

// ---------------------------------------------------------------------------
// Accessibility audit option types
// ---------------------------------------------------------------------------

/**
 * Options accepted by auditAccessibility().
 *
 * Mirrors the subset of AxeBuilder's chainable API that callers most commonly
 * need. All fields are optional — omitting them runs a full-page audit with
 * axe-core's default rule set.
 */
export interface AccessibilityAuditOptions {
  /**
   * CSS selectors to exclude from the audit scope. Useful for suppressing
   * violations in third-party widgets whose markup cannot be changed.
   *
   * @example exclude: ['#cookie-banner', '[data-third-party]']
   */
  exclude?: string | string[];
  /**
   * axe-core tag names used to restrict the active rule set.
   * Common values: 'wcag2a', 'wcag2aa', 'wcag21aa'.
   *
   * @example tags: ['wcag2a', 'wcag2aa', 'wcag21aa']
   */
  tags?: string | string[];
}

// ---------------------------------------------------------------------------
// Screenshot option types
// ---------------------------------------------------------------------------

/**
 * Options for full-page visual regression assertions via checkScreenshot().
 * Re-exported from Playwright for callers that need to type their options objects.
 */
export type { PageAssertionsToHaveScreenshotOptions as FullPageScreenshotOptions };

/**
 * Options for element-scoped visual regression assertions via checkLocatorScreenshot().
 * Mirrors the inline options type accepted by expect(locator).toHaveScreenshot().
 */
export interface LocatorScreenshotOptions {
  animations?: 'disabled' | 'allow';
  caret?: 'hide' | 'initial';
  mask?: Locator[];
  maskColor?: string;
  maxDiffPixelRatio?: number;
  maxDiffPixels?: number;
  omitBackground?: boolean;
  scale?: 'css' | 'device';
  stylePath?: string | string[];
  threshold?: number;
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Network route interception types
// ---------------------------------------------------------------------------

/**
 * Handler function passed to mockRoute(). Receives the Playwright Route and
 * Request objects, enabling route.fulfill(), route.continue(), route.abort(),
 * and request inspection. No application-domain references — wraps Playwright
 * built-in types only.
 */
export type MockRouteHandler = (route: Route, request: Request) => Promise<void> | void;

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
   * so patch-suggester can generate actionable suggestions.
   */
  pageObject?: string;
  /**
   * Page Object method name that owns this locator. Recorded in heal events
   * so patch-suggester can generate actionable suggestions.
   */
  method?: string;
}

// ---------------------------------------------------------------------------
// HealMethods interface
// ---------------------------------------------------------------------------

/**
 * Structural intersection of SafePage + HealMethods — used as the return type
 * of newTab() to avoid a circular import between heal-methods.ts and
 * page-facade.ts. (page-facade.ts defines PageFacade = SafePage & HealMethods,
 * which is structurally identical.)
 */
export type PageFacadeShape = SafePage & HealMethods;

/**
 * Factory function injected into buildHealPage to create a wrapped PageFacade
 * for a newly opened browser tab. Defined this way to avoid a circular
 * dependency: heal-methods.ts ← page-facade.ts imports heal-methods.ts, so
 * heal-methods.ts cannot import from page-facade.ts.
 */
export type TabFactory = (rawPage: Page, testName: string) => PageFacadeShape;

// ---------------------------------------------------------------------------
// HealMethods
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

  /**
   * Waits for an element to become visible, trying each strategy in priority
   * order with the full timeout. Unlike waitFor(), this does NOT require the
   * element to already exist in the DOM — it polls each strategy until the
   * element appears or the timeout elapses.
   *
   * Use this wherever you previously needed page.waitForFunction('document.querySelector(...)').
   *
   * Records a heal event when a fallback strategy succeeds before the primary.
   *
   * @param strategies - Ranked strategies; tried in STRATEGY_ORDER priority.
   * @param options    - LocateOptions (intent required for AI tier).
   * @param timeout    - Maximum ms to wait per strategy (default 10 000).
   * @throws StrategyExhaustedError if no strategy finds the element within timeout.
   */
  waitUntilVisible(
    strategies: LocatorStrategy[],
    options?: LocateOptions,
    timeout?: number,
  ): Promise<void>;

  /**
   * Waits for an element to be attached to the DOM (not necessarily visible).
   * Use for elements that are never "visible" in Playwright's sense, such as
   * `<option>` elements inside a `<select>`.
   *
   * @param strategies - Ranked strategies; tried in STRATEGY_ORDER priority.
   * @param options    - LocateOptions (intent required for AI tier).
   * @param timeout    - Maximum ms to wait per strategy (default 10 000).
   * @throws StrategyExhaustedError if no strategy finds the element within timeout.
   */
  waitUntilAttached(
    strategies: LocatorStrategy[],
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
   * Probes strategies 0 and 1: if strategy 0 reports absence but
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
   * Probes strategies 0 and 1: if strategy 0 reports hidden/absent
   * but strategy 1 finds the element visible, returns false (element is visible).
   * This guards against stale primary locators producing false-positive not-visible.
   *
   * @param strategies - One or more LocatorStrategy objects.
   * @param timeoutMs  - How long to wait for the element to disappear (default 10 000 ms).
   */
  isNotVisible(strategies: LocatorStrategy[], timeoutMs?: number): Promise<boolean>;

  /**
   * Opens a new browser tab and returns it as a fully wrapped PageFacade.
   *
   * This is the safe alternative to page.context().newPage(). Calling
   * context().newPage() directly returns a raw Playwright Page — bypassing
   * HealingLocator, HealingRegistry, and SafePage enforcement entirely for
   * the new tab. newTab() wraps the result in createPageFacade() so the new
   * tab participates in the same healing and audit guarantees as the primary
   * tab, registered under the same testName.
   */
  newTab(): Promise<PageFacadeShape>;

  /**
   * Asserts that the full page rendering matches a stored screenshot baseline.
   * On first run (no baseline exists) the snapshot is written automatically.
   * To regenerate a baseline after an intentional UI change, re-run with
   * `--update-snapshots`.
   *
   * The name parameter must include the `.png` extension by convention.
   * Snapshots are stored in `qa/e2e/snapshots/` mirroring the test file path.
   *
   * Default threshold: maxDiffPixels 50 — permissive enough to absorb
   * anti-aliasing and sub-pixel font rendering differences across machines.
   * Callers may tighten per-call by passing options.
   *
   * NOTE: Baselines must be generated on Linux (the same OS as CI) to avoid
   * cross-platform font rendering differences. Use the Docker E2E environment
   * to generate or update baselines. See the framework README for details.
   */
  checkScreenshot(name: string, options?: PageAssertionsToHaveScreenshotOptions): Promise<void>;

  /**
   * Asserts that a specific element's rendering matches a stored screenshot
   * baseline. Accepts a SafeLocator returned by page.locate().resolve().
   *
   * On first run (no baseline exists) the snapshot is written automatically.
   * To regenerate a baseline after an intentional UI change, re-run with
   * `--update-snapshots`.
   *
   * The name parameter must include the `.png` extension by convention.
   * Snapshots are stored in `qa/e2e/snapshots/` mirroring the test file path.
   *
   * Default threshold: maxDiffPixels 50 — permissive enough to absorb
   * anti-aliasing and sub-pixel font rendering differences across machines.
   * Callers may tighten per-call by passing options.
   *
   * NOTE: Baselines must be generated on Linux (the same OS as CI) to avoid
   * cross-platform font rendering differences. Use the Docker E2E environment
   * to generate or update baselines. See the framework README for details.
   */
  checkLocatorScreenshot(
    locator: SafeLocator,
    name: string,
    options?: LocatorScreenshotOptions,
  ): Promise<void>;

  /**
   * Runs an axe-core accessibility audit against the current page and returns
   * the raw AxeResults object. Never throws on violations — all assertion logic
   * belongs in the caller.
   *
   * The method uses a dynamic import so the axe bundle is not loaded on every
   * test file startup; only suites that call this method pay the import cost.
   *
   * @param options - Optional audit scope controls (exclude selectors, WCAG tags).
   *
   * @example
   * const results = await page.auditAccessibility({ tags: ['wcag2a', 'wcag2aa', 'wcag21aa'] });
   * expect(
   *   results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious'),
   *   'No critical or serious WCAG violations',
   * ).toHaveLength(0);
   */
  auditAccessibility(options?: AccessibilityAuditOptions): Promise<AxeResults>;

  /**
   * Registers a network route mock for the given URL pattern. The handler is
   * called for every matching request, allowing route.fulfill(), route.continue(),
   * route.abort(), and request inspection.
   *
   * The pattern is tracked internally. All registered mocks are automatically
   * removed during fixture teardown via unmockAllRoutes(), so mocks never bleed
   * into subsequent tests.
   *
   * Both string and RegExp patterns are supported.
   *
   * @example
   * // Simulate a server error
   * await page.mockRoute('/api/resource', async route => {
   *   await route.fulfill({ status: 500, body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Server error' } }) });
   * });
   *
   * @example
   * // Simulate a slow response to test loading states
   * await page.mockRoute('/api/resource', async route => {
   *   await new Promise(resolve => setTimeout(resolve, 3000));
   *   await route.continue();
   * });
   *
   * @example
   * // Verify request payload
   * await page.mockRoute('/api/resource', async route => {
   *   const body = route.request().postDataJSON();
   *   expect(body.email).toBe('test@example.com');
   *   await route.continue();
   * });
   */
  mockRoute(pattern: string | RegExp, handler: MockRouteHandler): Promise<void>;

  /**
   * Removes the mock registered for the given pattern before fixture teardown.
   * Use this for mid-test cleanup when you need to stop intercepting a route
   * partway through a test. The pattern must match exactly what was passed to
   * mockRoute() (same string value or same RegExp reference).
   */
  unmockRoute(pattern: string | RegExp): Promise<void>;

  /**
   * Removes all registered route mocks and clears the internal tracking set.
   * Called automatically in the fixture finally block — no need to call this
   * manually unless you want to reset mocks mid-test.
   */
  unmockAllRoutes(): Promise<void>;
}

/** Backwards-compatible alias — existing code importing HealPage continues to work. */
export type HealPage = HealMethods;

// ---------------------------------------------------------------------------
// buildHealPage factory
// ---------------------------------------------------------------------------

/**
 * Applies AccessibilityAuditOptions to an AxeBuilder via its chainable API.
 * Exported so unit tests can exercise option-forwarding without a real browser.
 */
export function applyAxeBuilderOptions<
  T extends { withTags(t: string | string[]): T; exclude(s: string | string[]): T },
>(builder: T, options: AccessibilityAuditOptions): T {
  let current = builder;
  if (options.tags) current = current.withTags(options.tags);
  if (options.exclude) current = current.exclude(options.exclude);
  return current;
}

/**
 * Default pixel-difference threshold for visual regression assertions.
 * Set to 50 to absorb anti-aliasing and sub-pixel font rendering differences
 * across machines without masking genuine visual regressions. Callers can
 * tighten this per-assertion by passing a lower maxDiffPixels in options.
 */
const DEFAULT_SCREENSHOT_MAX_DIFF_PIXELS = 50;

/**
 * Builds a HealMethods implementation bound to the given Playwright Page.
 * Extracted so it can be unit-tested without the full fixture machinery.
 *
 * @param page - The Playwright Page object for the current test.
 * @param testName - The name of the currently running test.
 * @param tabFactory - Optional factory for wrapping new tabs in PageFacade.
 *   When provided, newTab() calls page.context().newPage() internally and
 *   passes the raw page to this factory. Injected from page-facade.ts to
 *   avoid a circular import dependency.
 * @returns A HealMethods instance.
 */
export function buildHealPage(page: Page, testName: string, tabFactory?: TabFactory): HealMethods {
  // Tracks all patterns registered via mockRoute() so unmockAllRoutes() can
  // clean them up automatically at fixture teardown.
  const registeredPatterns = new Set<string | RegExp>();

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

    async waitUntilVisible(
      strategies: LocatorStrategy[],
      options: LocateOptions = {},
      timeout = 10_000,
    ): Promise<void> {
      const sorted = [...strategies].sort(
        (a, b) => STRATEGY_ORDER[a.type] - STRATEGY_ORDER[b.type],
      );
      const [primary, ...fallbacks] = sorted;
      const attempted: LocatorStrategyRecord[] = [];

      function toRecord(s: LocatorStrategy): LocatorStrategyRecord {
        const r: LocatorStrategyRecord = { type: s.type, value: s.value };
        if (s.options !== undefined) r.options = s.options;
        if (s.within !== undefined) r.within = s.within;
        return r;
      }

      // Try primary with the full timeout — it gets the first and longest window.
      const primaryLocator = buildLocator(page, primary!);
      try {
        await primaryLocator.first().waitFor({ state: 'visible', timeout });
        return;
      } catch {
        attempted.push(toRecord(primary!));
      }

      // Try each fallback with the full timeout.
      for (const fallback of fallbacks) {
        const fallbackLocator = buildLocator(page, fallback);
        try {
          await fallbackLocator.first().waitFor({ state: 'visible', timeout });
          // Record the heal event — a fallback succeeded where primary did not.
          HealingRegistry.instance.record(
            testName,
            toRecord(primary!),
            toRecord(fallback),
            false,
            options.pageObject,
            options.method,
          );
          return;
        } catch {
          attempted.push(toRecord(fallback));
        }
      }

      throw new StrategyExhaustedError(attempted);
    },

    async waitUntilAttached(
      strategies: LocatorStrategy[],
      options: LocateOptions = {},
      timeout = 10_000,
    ): Promise<void> {
      const sorted = [...strategies].sort(
        (a, b) => STRATEGY_ORDER[a.type] - STRATEGY_ORDER[b.type],
      );
      const [primary, ...fallbacks] = sorted;
      const attempted: LocatorStrategyRecord[] = [];

      function toRecord(s: LocatorStrategy): LocatorStrategyRecord {
        const r: LocatorStrategyRecord = { type: s.type, value: s.value };
        if (s.options !== undefined) r.options = s.options;
        if (s.within !== undefined) r.within = s.within;
        return r;
      }

      const primaryLocator = buildLocator(page, primary!);
      try {
        await primaryLocator.first().waitFor({ state: 'attached', timeout });
        return;
      } catch {
        attempted.push(toRecord(primary!));
      }

      for (const fallback of fallbacks) {
        const fallbackLocator = buildLocator(page, fallback);
        try {
          await fallbackLocator.first().waitFor({ state: 'attached', timeout });
          HealingRegistry.instance.record(
            testName,
            toRecord(primary!),
            toRecord(fallback),
            false,
            options.pageObject,
            options.method,
          );
          return;
        } catch {
          attempted.push(toRecord(fallback));
        }
      }

      throw new StrategyExhaustedError(attempted);
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
     * TWO-STRATEGY PROBE:
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
      try {
        // Poll until detached rather than snapshotting current DOM presence.
        // waitFor({state:'attached'}) resolves immediately if the element is already
        // in the DOM, so it cannot detect future removal.
        await locator.waitFor({ state: 'detached', timeout: timeoutMs });
      } catch {
        return false;
      }

      // Strategy 0 says absent — probe strategy 1 to guard against a stale
      // primary locator (e.g. data-testid renamed). If strategy 1 finds the
      // element present, it is not absent. No heal event is recorded.
      if (sorted.length > 1) {
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
     * TWO-STRATEGY PROBE:
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
      try {
        // Poll until hidden/absent rather than snapshotting current visibility.
        // waitFor({state:'visible'}) resolves immediately if the element is already
        // visible, so it cannot detect future disappearance.
        await locator.waitFor({ state: 'hidden', timeout: timeoutMs });
      } catch {
        return false;
      }

      // Strategy 0 says hidden/absent — do a short probe with strategy 1 to
      // guard against a stale primary locator (e.g. data-testid renamed): if
      // 0 elements match the primary, waitFor(hidden) resolves immediately —
      // a false-positive. Strategy 1 catches this: if it finds the element
      // visible within a short window, the element is not actually gone.
      // Keep the probe window short (2 s) — it must not consume a significant
      // portion of the caller's budget after strategy 0 already ran. (MINCRM-355)
      if (sorted.length > 1) {
        const locator1 = buildLocator(page, sorted[1]!);
        const PROBE_TIMEOUT_MS = 2_000;
        try {
          await locator1.waitFor({ state: 'visible', timeout: PROBE_TIMEOUT_MS });
          // Strategy 1 found the element visible — it is not hidden.
          return false;
        } catch {
          // Strategy 1 also did not find it visible — element is genuinely hidden/absent.
        }
      }

      return true;
    },

    async newTab(): Promise<PageFacadeShape> {
      if (!tabFactory) {
        throw new Error(
          'newTab() requires a tabFactory — pass createPageFacade when calling buildHealPage',
        );
      }
      // Opens a new tab via the raw underlying Page's context (no HealingLocator
      // involvement — this is a browser-level operation, not an element lookup).
      const newRawPage = await page.context().newPage();
      return tabFactory(newRawPage, testName);
    },

    async checkScreenshot(
      name: string,
      options?: PageAssertionsToHaveScreenshotOptions,
    ): Promise<void> {
      await expect(page).toHaveScreenshot(name, {
        maxDiffPixels: DEFAULT_SCREENSHOT_MAX_DIFF_PIXELS,
        ...options,
      });
    },

    async checkLocatorScreenshot(
      locator: SafeLocator,
      name: string,
      options?: LocatorScreenshotOptions,
    ): Promise<void> {
      await expect(locator).toHaveScreenshot(name, {
        maxDiffPixels: DEFAULT_SCREENSHOT_MAX_DIFF_PIXELS,
        ...options,
      });
    },

    async auditAccessibility(options: AccessibilityAuditOptions = {}): Promise<AxeResults> {
      // Dynamic import keeps the axe bundle out of the startup path for suites
      // that never call this method.
      const { AxeBuilder } = await import('@axe-core/playwright');
      const builder = applyAxeBuilderOptions(new AxeBuilder({ page }), options);
      return builder.analyze();
    },

    async mockRoute(pattern: string | RegExp, handler: MockRouteHandler): Promise<void> {
      registeredPatterns.add(pattern);
      await page.route(pattern, handler);
    },

    async unmockRoute(pattern: string | RegExp): Promise<void> {
      registeredPatterns.delete(pattern);
      await page.unroute(pattern);
    },

    async unmockAllRoutes(): Promise<void> {
      for (const pattern of registeredPatterns) {
        await page.unroute(pattern);
      }
      registeredPatterns.clear();
    },
  };
}
