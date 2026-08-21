/**
 * P1 — Contacts List Page: Performance PoC
 *
 * Proof-of-concept for. Captures and asserts on:
 *   - LCP, CLS, TTFB, INP (Web Vitals via PerformanceObserver injected before load)
 *   - API TTFB for GET /api/v1/contacts (via Playwright response.timing())
 *
 * Tagged @perf — runs only under the `perf` Playwright project.
 * Not tagged @functional — does not run in the functional suite.
 *
 * Thresholds are conservative CI-appropriate values (see perf-thresholds.ts).
 * Override via env vars (PERF_THRESHOLD_LCP_MS, etc.) without code changes.
 *
 *
 */

import { mergeTests, expect } from '@playwright/test';
import { test as baseTest } from '@apps/minicrm/fixtures.js';
import { test as perfBaseTest } from '@framework/performance/perf-fixture.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';

const test = mergeTests(baseTest, perfBaseTest);

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

test('contacts list page load meets performance thresholds @perf', async ({
  page: _page,
  measurePerf,
}) => {
  const result = await measurePerf({
    scenario: 'contacts-list-load',
    navigateTo: '/contacts',
    apiUrlFilter: '/api/v1/contacts',
  });

  // Print metrics to help calibrate thresholds during the spike.
  const { vitals, apiTimings } = result;
  console.log('[perf] Web Vitals:', JSON.stringify(vitals));
  console.log('[perf] API timings:', JSON.stringify(apiTimings));

  // The core assertion: no threshold violations.
  // Violations carry human-readable messages that appear in the test failure output.
  expect(
    result.violations.map((v) => v.message),
    'Performance threshold violations detected',
  ).toEqual([]);
});

test('contacts list page load: LCP and API TTFB captured and non-negative @perf', async ({
  page: _page,
  measurePerf,
}) => {
  const { vitals, apiTimings } = await measurePerf({
    scenario: 'contacts-list-vitals-check',
    navigateTo: '/contacts',
    apiUrlFilter: '/api/v1/contacts',
  });

  // Structural assertions: metrics must be captured and sane.
  // LCP may be null on very fast loads where no image/large-text is painted,
  // but TTFB should always be available after a full page navigation.
  if (vitals.ttfb !== null) {
    expect(vitals.ttfb, 'TTFB must be non-negative').toBeGreaterThanOrEqual(0);
  }
  if (vitals.lcp !== null) {
    expect(vitals.lcp, 'LCP must be non-negative').toBeGreaterThanOrEqual(0);
  }
  if (vitals.cls !== null) {
    expect(vitals.cls, 'CLS must be non-negative').toBeGreaterThanOrEqual(0);
  }

  // At least one API call to /api/v1/contacts should have been captured.
  expect(apiTimings.length, 'Expected at least one /api/v1/contacts response').toBeGreaterThan(0);
  for (const t of apiTimings) {
    expect(t.ttfb, `API TTFB for ${t.url} must be non-negative`).toBeGreaterThanOrEqual(0);
    expect(t.duration, `API duration for ${t.url} must be non-negative`).toBeGreaterThanOrEqual(0);
  }
});
