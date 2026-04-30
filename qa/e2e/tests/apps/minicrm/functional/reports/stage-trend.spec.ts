/**
 * Stage trend report functional tests (MINCRM-284).
 *
 * Tests that an authenticated user can view the stage trend report page,
 * reach it via the nav link, interact with the date range filter, and see
 * the expected UI elements after the report loads.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - data-testid selectors only — no CSS class or positional selectors
 *   - No raw Page Object calls in spec — use behaviors or page.locate/goto/click
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import { navigateViaNavLink, setNavLayoutViaAPI } from '@behaviors/minicrm/nav.behaviors.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[stage-trend-spec] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Setup — authenticate once before all tests
// ---------------------------------------------------------------------------

test.beforeAll(async ({ restClient }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigates to the stage trend report and waits for the loading indicator to
 * disappear, then returns whether the table or empty state is visible.
 */
async function waitForReportLoaded(page: PageFacade): Promise<{
  tableVisible: boolean;
  emptyVisible: boolean;
}> {
  // Wait for the loading indicator to disappear (it may already be gone)
  const loadingEl = await page
    .locate([{ type: 'testId', value: 'report-loading' }])
    .resolve()
    .catch(() => null);
  await loadingEl?.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => null);

  const tableEl = await page
    .locate([{ type: 'testId', value: 'stage-trend-table' }])
    .resolve()
    .catch(() => null);
  const emptyEl = await page
    .locate([{ type: 'testId', value: 'stage-trend-empty' }])
    .resolve()
    .catch(() => null);

  const tableVisible = (await tableEl?.isVisible().catch(() => false)) ?? false;
  const emptyVisible = (await emptyEl?.isVisible().catch(() => false)) ?? false;
  return { tableVisible, emptyVisible };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('stage trend report: nav link navigates to /reports/stage-trend @functional', async ({
  page,
  restClient,
}) => {
  // Use left layout so links are always visible regardless of viewport width
  await setNavLayoutViaAPI('left', restClient);
  try {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    const result = await navigateViaNavLink('left', 'stage-trend', { page });

    expect(result.linkClicked).toBe(true);
    expect(new URL(result.finalUrl).pathname).toBe('/reports/stage-trend');
  } finally {
    await setNavLayoutViaAPI('top', restClient).catch(() => null);
  }
});

test('stage trend report: page heading and date range filter are visible @functional', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports/stage-trend', { waitUntil: 'networkidle' });

  const heading = await page
    .locate([{ type: 'testId', value: 'stage-trend-report-heading' }])
    .resolve();
  await expect(heading).toBeVisible({ timeout: 10_000 });

  const daysSelect = await page.locate([{ type: 'testId', value: 'days-select' }]).resolve();
  await expect(daysSelect).toBeVisible();
  await expect(daysSelect).toHaveValue('30');
});

test('stage trend report: table or empty state visible after load @functional', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports/stage-trend', { waitUntil: 'networkidle' });

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
  await page.goto('/reports/stage-trend', { waitUntil: 'networkidle' });

  // Wait for initial load to settle
  await waitForReportLoaded(page);

  // Switch to 60-day window
  const daysSelect = await page.locate([{ type: 'testId', value: 'days-select' }]).resolve();
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
  await page.goto('/reports/stage-trend', { waitUntil: 'networkidle' });

  const daysSelect = await page.locate([{ type: 'testId', value: 'days-select' }]).resolve();
  await daysSelect.selectOption('90');
  await expect(daysSelect).toHaveValue('90');
});
