/**
 * Stage trend report functional tests (MINCRM-284).
 *
 * Tests that an authenticated user can view the stage trend report page,
 * reach it via the reports nav link, interact with the date range filter, and see
 * the expected UI elements after the report loads.
 *
 * Navigation tests (nav link, direct URL, redirect) were removed in MINCRM-409
 * because they duplicate coverage in reports-nav.spec.ts.
 * This file now covers only filter interaction and data rendering.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - data-testid selectors only — no CSS class or positional selectors
 *   - No raw Page Object calls in spec — use behaviors or page objects
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login, loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import {
  getReportsLoadingLocator,
  getReportsStageTrendTableLocator,
  getReportsStageTrendEmptyLocator,
  getReportsDaysSelectLocator,
} from '@behaviors/minicrm/reports.behaviors.js';
import type { PageFacade } from '@framework/fixtures/index.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[stage-trend-spec] E2E_ADMIN_PASSWORD is not set');

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Waits for the stage trend report loading indicator to disappear, then returns
 * whether the table or empty state is visible.
 */
async function waitForReportLoaded(page: PageFacade): Promise<{
  tableVisible: boolean;
  emptyVisible: boolean;
}> {
  const loadingEl = await getReportsLoadingLocator({ page });
  await loadingEl?.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => null);

  const tableEl = await getReportsStageTrendTableLocator({ page });
  const emptyEl = await getReportsStageTrendEmptyLocator({ page });

  const tableVisible = (await tableEl?.isVisible().catch(() => false)) ?? false;
  const emptyVisible = (await emptyEl?.isVisible().catch(() => false)) ?? false;
  return { tableVisible, emptyVisible };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('stage trend report: table or empty state visible after load @functional', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports?view=pipeline-stage', { waitUntil: 'networkidle' });

  const { tableVisible, emptyVisible } = await waitForReportLoaded(page);

  expect(
    tableVisible || emptyVisible,
    'either the stage trend table or the empty-state message must be visible after load',
  ).toBe(true);
});

test('stage trend report: changing date range to 60 days re-fetches and still shows table or empty state @functional', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports?view=pipeline-stage', { waitUntil: 'networkidle' });

  // Wait for initial load to settle
  await waitForReportLoaded(page);

  // Switch to 60-day window
  const daysSelect = await getReportsDaysSelectLocator({ page });
  await daysSelect.selectOption('60');
  await expect(daysSelect).toHaveValue('60');

  // Wait for the new fetch to complete
  const { tableVisible, emptyVisible } = await waitForReportLoaded(page);
  expect(
    tableVisible || emptyVisible,
    'table or empty state must still be visible after switching to 60-day window',
  ).toBe(true);
});

test('stage trend report: changing date range to 90 days updates the select @functional', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports?view=pipeline-stage', { waitUntil: 'networkidle' });

  const daysSelect = await getReportsDaysSelectLocator({ page });
  await daysSelect.selectOption('90');
  await expect(daysSelect).toHaveValue('90');
});
