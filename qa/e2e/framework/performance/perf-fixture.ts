/**
 * perf-fixture.ts — Playwright fixture that wires up Web Vitals injection,
 * API timing collection, threshold assertion, and PerfRegistry recording
 * for a single measurement window.
 *
 * Provides a `measurePerf` fixture function:
 *
 * ```ts
 * test('item list load perf @perf', async ({ page, measurePerf }) => {
 *   const { vitals, apiTimings, violations } = await measurePerf({
 *     scenario: 'item-list-load',
 *     navigateTo: '/items',
 *     apiUrlFilter: '/api/items',
 *   });
 *   expect(violations).toEqual([]);
 * });
 * ```
 *
 * The fixture:
 *   1. Injects the Web Vitals accumulator script before navigation.
 *   2. Starts API response timing collection.
 *   3. Navigates to the target URL.
 *   4. Waits for networkidle.
 *   5. Collects Web Vitals and API timings.
 *   6. Checks against thresholds and records a PerfSample.
 *   7. Flushes to the worker file via PerfRegistry.
 *
 */

import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import { injectWebVitals, collectWebVitals, startApiTimingCollection } from './perf-metrics.js';
import type { PerfSample, ApiTiming, WebVitals } from './perf-metrics.js';
import { resolveThresholds, checkVitals, checkApiTimings } from './perf-thresholds.js';
import type { ResolvedThresholds, ThresholdViolation } from './perf-thresholds.js';
import { PerfRegistry } from './perf-registry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MeasurePerfOptions {
  /** Scenario identifier used in the report and threshold messages. */
  scenario: string;
  /** Page path to navigate to (e.g. '/contacts'). */
  navigateTo: string;
  /**
   * URL substring to filter API responses for timing collection.
   * Pass an empty string to collect all responses.
   */
  apiUrlFilter: string;
  /** Per-invocation threshold overrides. Defaults to resolveThresholds(). */
  thresholds?: Partial<ResolvedThresholds>;
}

export interface MeasurePerfResult {
  vitals: WebVitals;
  apiTimings: ApiTiming[];
  violations: ThresholdViolation[];
}

export interface PerfFixtures {
  /**
   * Measures performance for one navigation scenario. Injects Web Vitals,
   * navigates, collects metrics, asserts thresholds, and records a sample.
   */
  measurePerf: (options: MeasurePerfOptions) => Promise<MeasurePerfResult>;
}

// ---------------------------------------------------------------------------
// Fixture implementation
// ---------------------------------------------------------------------------

async function runMeasurement(
  page: Page,
  testName: string,
  options: MeasurePerfOptions,
): Promise<MeasurePerfResult> {
  const thresholds = resolveThresholds(options.thresholds);

  // Inject vitals accumulator before navigation.
  await injectWebVitals(page);

  // Start API timing collection before navigation so we catch the initial load.
  const stopCollecting = startApiTimingCollection(page, options.apiUrlFilter);

  await page.goto(options.navigateTo);
  await page.waitForLoadState('networkidle');

  const vitals = await collectWebVitals(page);
  const apiTimings = stopCollecting();

  const vitalViolations = checkVitals(vitals, thresholds, options.scenario);
  const apiViolations = checkApiTimings(apiTimings, thresholds, options.scenario);
  const violations = [...vitalViolations, ...apiViolations];

  const sample: PerfSample = {
    capturedAt: new Date().toISOString(),
    testName,
    scenario: options.scenario,
    vitals,
    apiTimings,
  };

  PerfRegistry.instance.record(sample);

  return { vitals, apiTimings, violations };
}

export const test = base.extend<PerfFixtures>({
  measurePerf: async ({ page }, use, testInfo) => {
    const fn = (options: MeasurePerfOptions) => runMeasurement(page, testInfo.title, options);
    try {
      await use(fn);
    } finally {
      PerfRegistry.instance.flush();
      PerfRegistry.instance._reset();
    }
  },
});
