/**
 * perf-metrics.ts — Web Vitals capture via web-vitals injected into the page,
 * and API response timing via Playwright's page.on('response') event.
 *
 * Web Vitals strategy: inject the web-vitals library via page.addInitScript()
 * so that measurement starts before the first navigation, then collect the
 * accumulated values via page.evaluate() after load. This handles edge cases
 * (LCP finalization, CLS accumulation) correctly without reinventing the wheel.
 *
 * API timing strategy: use response.timing() on each page.on('response') event
 * to record per-URL TTFB (responseStart − requestStart). This avoids HAR file
 * I/O while providing sub-millisecond precision directly from Playwright.
 *
 */

import type { Page, Response } from '@playwright/test';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Core Web Vitals captured from a single page load. */
export interface WebVitals {
  /** Largest Contentful Paint (ms). null if not yet available (SPA nav, short load). */
  lcp: number | null;
  /** Cumulative Layout Shift (unitless score). */
  cls: number | null;
  /**
   * Time to First Byte (ms) — measured from navigation.timing on the page side
   * because the web-vitals library does not export TTFB in all environments.
   */
  ttfb: number | null;
  /** Interaction to Next Paint (ms). null when no interaction occurred. */
  inp: number | null;
}

/** Timing entry for a single API response captured via page.on('response'). */
export interface ApiTiming {
  /** URL of the request (full path, no origin). */
  url: string;
  /** HTTP method. */
  method: string;
  /** HTTP status code. */
  status: number;
  /**
   * Time from request start to first byte of the response body (ms).
   * Equivalent to TTFB from the browser's perspective.
   */
  ttfb: number;
  /** Total round-trip duration from request start to response end (ms). */
  duration: number;
}

/** All performance data captured for one measurement window. */
export interface PerfSample {
  /** ISO timestamp when the sample was taken. */
  capturedAt: string;
  /** Test name that produced this sample. */
  testName: string;
  /** Scenario label for grouping in the report (e.g. "contacts-list-load"). */
  scenario: string;
  vitals: WebVitals;
  /** API timings collected during the measurement window. */
  apiTimings: ApiTiming[];
}

// ---------------------------------------------------------------------------
// web-vitals injection script
// ---------------------------------------------------------------------------

/**
 * Inline web-vitals v4 attribution build (UMD/IIFE) injected via addInitScript.
 *
 * We inline only the subset needed: LCP, CLS, TTFB, INP accumulators that
 * write results onto `window.__webVitals`. The full library is not bundled
 * here — instead we use PerformanceObserver directly, following the same logic
 * as the web-vitals library but in a compact form suitable for addInitScript.
 *
 * This avoids a network dependency on unpkg/CDN and keeps the framework
 * self-contained.
 */
const WEB_VITALS_INIT_SCRIPT = `
(function () {
  if (window.__webVitals) return;
  var vitals = { lcp: null, cls: 0, ttfb: null, inp: null };
  window.__webVitals = vitals;

  // LCP
  try {
    var lcpObs = new PerformanceObserver(function(list) {
      var entries = list.getEntries();
      if (entries.length > 0) {
        vitals.lcp = entries[entries.length - 1].startTime;
      }
    });
    lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch(e) {}

  // CLS
  try {
    var clsObs = new PerformanceObserver(function(list) {
      for (var e of list.getEntries()) {
        if (!e.hadRecentInput) vitals.cls = (vitals.cls || 0) + e.value;
      }
    });
    clsObs.observe({ type: 'layout-shift', buffered: true });
  } catch(e) {}

  // INP (Interaction to Next Paint — replaced FID in CWV 2024)
  try {
    var inpObs = new PerformanceObserver(function(list) {
      for (var e of list.getEntries()) {
        if (vitals.inp === null || e.duration > vitals.inp) {
          vitals.inp = e.duration;
        }
      }
    });
    inpObs.observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch(e) {}

  // TTFB from navigation timing
  try {
    var navEntries = performance.getEntriesByType('navigation');
    if (navEntries.length > 0) {
      var nav = navEntries[0];
      vitals.ttfb = nav.responseStart - nav.requestStart;
    }
  } catch(e) {}
})();
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Injects the Web Vitals accumulator script into the page.
 * Must be called before the first page.goto() so that LCP and CLS observers
 * are registered prior to content loading.
 *
 * @example
 * ```ts
 * await injectWebVitals(page);
 * await page.goto('/some-route');
 * await page.waitForLoadState('networkidle');
 * const vitals = await collectWebVitals(page);
 * ```
 */
export async function injectWebVitals(page: Page): Promise<void> {
  await page.addInitScript(WEB_VITALS_INIT_SCRIPT);
}

/**
 * Collects the accumulated Web Vitals from the page.
 * Call after page load is complete (waitForLoadState('networkidle') or equivalent).
 *
 * Also reads TTFB from navigation.timing at collection time as a fallback —
 * navigation.timing is only available after load so this is safe to call here.
 */
export async function collectWebVitals(page: Page): Promise<WebVitals> {
  // page.evaluate() runs inside the browser context. The callback is serialized
  // and evaluated by V8, so browser globals (window, performance, etc.) are
  // available at runtime even though the Node.js tsconfig has no DOM lib.
  // We use `unknown` casts to satisfy the compiler without adding DOM to the
  // lib (which would conflict with Node.js types across the QA workspace).
  const vitals = await page.evaluate<WebVitals>(() => {
    interface BrowserWebVitals {
      lcp: number | null;
      cls: number | null;
      ttfb: number | null;
      inp: number | null;
    }
    interface NavTiming {
      responseStart: number;
      requestStart: number;
    }
    const win = globalThis as unknown as { __webVitals?: BrowserWebVitals };
    const raw = win.__webVitals;
    if (!raw) return { lcp: null, cls: null, ttfb: null, inp: null };

    // Prefer navigation timing TTFB read at collection time — more reliable
    // than the init-script attempt which runs before navigation.
    let ttfb = raw.ttfb;
    if (ttfb === null) {
      const perf = globalThis.performance as unknown as {
        getEntriesByType: (type: string) => NavTiming[];
      };
      const navEntries = perf.getEntriesByType('navigation');
      if (navEntries.length > 0) {
        const nav = navEntries[0];
        ttfb = nav.responseStart - nav.requestStart;
      }
    }

    return { lcp: raw.lcp, cls: raw.cls ?? null, ttfb, inp: raw.inp };
  });
  return vitals;
}

/**
 * Starts collecting API response timings for all responses that match
 * `urlFilter`. Returns a stop function that returns the collected timings.
 *
 * Uses `response.timing()` (Playwright built-in) rather than HAR parsing —
 * this avoids file I/O and gives precise sub-millisecond timing directly
 * from the browser's network stack.
 *
 * @param page - The Playwright Page to listen on.
 * @param urlFilter - Only responses whose URL includes this string are recorded.
 *
 * @example
 * ```ts
 * const stopCollecting = startApiTimingCollection(page, '/api/items');
 * await page.goto('/items');
 * await page.waitForLoadState('networkidle');
 * const timings = stopCollecting();
 * ```
 */
export function startApiTimingCollection(page: Page, urlFilter: string): () => ApiTiming[] {
  const collected: ApiTiming[] = [];

  const handler = (response: Response): void => {
    if (!response.url().includes(urlFilter)) return;
    // timing() is on Request, not Response — call response.request().timing()
    const t = response.request().timing();
    collected.push({
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
      // responseStart − requestStart = time to first byte
      ttfb: t.responseStart - t.requestStart,
      // responseEnd − requestStart = full round-trip
      duration: t.responseEnd - t.requestStart,
    });
  };

  page.on('response', handler);
  return () => {
    page.off('response', handler);
    return [...collected];
  };
}
