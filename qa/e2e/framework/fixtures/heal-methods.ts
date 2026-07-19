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
  buildLocator,
  STRATEGY_ORDER,
  BoundHealingLocator,
} from '../healing/index.js';
import type { LocatorStrategy } from '../healing/index.js';
import { inferCallSite } from '../healing/call-site-inferrer.js';
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

  /**
   * Polls until the element matching `selector` is attached to the DOM *and*
   * has a positive painted height (getBoundingClientRect().height > 0).
   *
   * Use this before clicking an element that lives inside a container that
   * re-renders after state updates. Standard visibility checks pass as soon as
   * an element is non-hidden in CSS, but on a loaded CI runner a framework can
   * insert the element at zero height during a paint cycle before layout is
   * complete — the element then detaches and re-attaches on the next render,
   * making a previously-resolved element handle go stale mid-click.
   *
   * getBoundingClientRect().height > 0 is the authoritative "layout settled"
   * signal. It works for both position:fixed elements (e.g. mobile action
   * sheets) and normal-flow elements, unlike offsetParent which is null for
   * fixed elements.
   *
   * @param selector - CSS selector for the target element.
   * @param timeout  - Poll timeout in milliseconds (default 8 000).
   */
  waitForPainted(selector: string, timeout?: number): Promise<void>;

  /**
   * Polls until at least one element matching `selector` is present in the DOM.
   *
   * Use this as a guard before locate().resolve() or evaluate() when the element
   * is conditionally rendered — locate().resolve() throws StrategyExhaustedError
   * immediately on an absent element rather than waiting for it to appear.
   *
   * Passed as a browser-evaluated string expression so the Node-targeted QA
   * tsconfig (no dom lib) never sees `document` as a type error.
   *
   * @param selector - CSS selector for the target element.
   * @param timeout  - Poll timeout in milliseconds (default 10 000).
   */
  waitForPresent(selector: string, timeout?: number): Promise<void>;

  /**
   * Polls until no element matching `selector` exists in the DOM.
   *
   * Use this after an action that fully unmounts a component (e.g. a modal or
   * composer that is removed from the DOM rather than hidden). waitFor with
   * state 'detached' requires an already-resolved locator handle; this method
   * re-queries on every poll so it works even when you never held a handle.
   *
   * @param selector - CSS selector for the target element.
   * @param timeout  - Poll timeout in milliseconds (default 8 000).
   */
  waitForAbsent(selector: string, timeout?: number): Promise<void>;

  /**
   * Polls until the number of elements matching `selector` exceeds `countBefore`.
   *
   * Use this to detect a new element appended to a growing list (e.g. a new
   * message bubble, a new row) when the element itself has no distinguishing
   * attribute to locate directly — only re-querying the full set and comparing
   * cardinality can detect the appearance.
   *
   * @param selector - CSS selector matching the repeated element.
   * @param countBefore - The count observed before the triggering action.
   * @param timeout - Poll timeout in milliseconds (default 8 000).
   */
  waitForCountAbove(selector: string, countBefore: number, timeout?: number): Promise<void>;

  /**
   * Polls until the element matching `selector` has text content containing
   * `text`.
   *
   * Use this to wait for a container's rendered text to include a substring
   * without holding a resolved locator handle — this re-queries the DOM on
   * every poll, so it also works across a re-render that replaces the element.
   *
   * @param selector - CSS selector for the container element.
   * @param text - Substring to wait for within the element's text content.
   * @param timeout - Poll timeout in milliseconds (default 8 000).
   */
  waitForTextContent(selector: string, text: string, timeout?: number): Promise<void>;

  /**
   * Arms a one-shot handler that accepts the next native browser dialog
   * (window.confirm / window.alert / window.prompt) as soon as it opens.
   * Must be called BEFORE the action that triggers the dialog — Playwright
   * auto-dismisses native dialogs with no registered handler, so triggering
   * the dialog first would cancel it before this could attach.
   *
   * There is deliberately no raw page.on('dialog', ...) exposed on
   * PageFactory/SafePage — this narrow, purpose-built method is the sanctioned
   * way to drive a UI flow gated behind a native confirm dialog (e.g. a
   * delete-confirmation prompt) without opening up arbitrary Playwright event
   * access.
   */
  acceptNextDialog(): void;
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
 * @param pageObjectPathSegments - File path substrings used to identify
 *   page-object call frames when inferring heal-event attribution from the
 *   stack. Pass app-specific segments (e.g. `['pages/myapp']`) from the
 *   app fixture layer; leave empty (the default) for framework-only usage
 *   where no page objects exist.
 * @returns A HealMethods instance.
 */
export function buildHealPage(
  page: Page,
  testName: string,
  tabFactory?: TabFactory,
  pageObjectPathSegments: string[] = [],
): HealMethods {
  // Tracks all patterns registered via mockRoute() so unmockAllRoutes() can
  // clean them up automatically at fixture teardown.
  const registeredPatterns = new Set<string | RegExp>();

  function makeHealingLocator(
    strategies: LocatorStrategy[],
    options: LocateOptions,
  ): HealingLocator {
    // When explicit attribution is absent, infer it from the call stack so
    // heal events are attributed to the page object method that called locate()
    // rather than falling back to "Unknown.unknown".
    let { pageObject, method } = options;
    if ((pageObject === undefined || method === undefined) && pageObjectPathSegments.length > 0) {
      const inferred = inferCallSite(new Error().stack ?? '', pageObjectPathSegments);
      if (inferred !== null) {
        pageObject ??= inferred.pageObject;
        method ??= inferred.method;
      }
    }

    return new HealingLocator(page, strategies, {
      intent: options.intent,
      fallbackTimeout: options.fallbackTimeout,
      pageObject,
      method,
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

    async count(strategies: LocatorStrategy[], _options: LocateOptions = {}): Promise<number> {
      // Deliberately bypasses resolveLocator()/HealingLocator.resolve(): resolve()
      // is a "find this element or exhaust every strategy and throw" primitive,
      // but a count is legitimately allowed to be zero (e.g. no assistant replies
      // yet). Query the primary (highest-priority) strategy directly and use
      // Playwright's native count(), which never throws — a locator matching
      // zero elements is not a healing scenario.
      const [primary] = [...strategies].sort(
        (a, b) => STRATEGY_ORDER[a.type] - STRATEGY_ORDER[b.type],
      );
      return buildLocator(page, primary).count();
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

      // Strategy 0 says hidden/absent — probe strategy 1 to guard against a
      // stale primary locator (e.g. data-testid renamed). If strategy 1 finds
      // the element visible, it is not hidden. No heal event is recorded.
      if (sorted.length > 1) {
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

    async waitForPainted(selector: string, timeout = 8_000): Promise<void> {
      await page.waitForFunction(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el !== null && el.getBoundingClientRect().height > 0; })()`,
        undefined,
        { timeout },
      );
    },

    async waitForPresent(selector: string, timeout = 10_000): Promise<void> {
      await page.waitForFunction(
        `document.querySelector(${JSON.stringify(selector)}) !== null`,
        undefined,
        { timeout },
      );
    },

    async waitForAbsent(selector: string, timeout = 8_000): Promise<void> {
      await page.waitForFunction(
        `document.querySelector(${JSON.stringify(selector)}) === null`,
        undefined,
        { timeout },
      );
    },

    async waitForCountAbove(selector: string, countBefore: number, timeout = 8_000): Promise<void> {
      await page.waitForFunction(
        `document.querySelectorAll(${JSON.stringify(selector)}).length > ${countBefore}`,
        undefined,
        { timeout },
      );
    },

    async waitForTextContent(selector: string, text: string, timeout = 8_000): Promise<void> {
      await page.waitForFunction(
        `document.querySelector(${JSON.stringify(selector)})?.textContent?.includes(${JSON.stringify(text)}) ?? false`,
        undefined,
        { timeout },
      );
    },

    acceptNextDialog(): void {
      page.once('dialog', (dialog) => {
        void dialog.accept();
      });
    },
  };
}
