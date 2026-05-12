/**
 * Stage trend report functional tests (MINCRM-284).
 *
 * Tests that an authenticated user can view the stage trend report page,
 * reach it via the reports nav link, interact with the date range filter, and see
 * the expected UI elements after the report loads.
 *
 * Updated for MINCRM-294: stage trend is now served at /reports?view=pipeline-stage
 * via the Reports shell page. The old /reports/stage-trend route redirects there.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - data-testid selectors only — no CSS class or positional selectors
 *   - No raw Page Object calls in spec — use behaviors or page objects
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login, loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { navigateViaNavLink, setNavLayoutViaAPI } from '@behaviors/minicrm/nav.behaviors.js';
import { ReportsPage } from '@pages/minicrm/ReportsPage.js';

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
  await loginAsAdmin(restClient);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigates to the stage trend report and waits for the loading indicator to
 * disappear, then returns whether the table or empty state is visible.
 */
async function waitForReportLoaded(reportsPage: ReportsPage): Promise<{
  tableVisible: boolean;
  emptyVisible: boolean;
}> {
  const loadingEl = await reportsPage.loadingLocator();
  await loadingEl?.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => null);

  const tableEl = await reportsPage.stageTrendTableLocator();
  const emptyEl = await reportsPage.stageTrendEmptyLocator();

  const tableVisible = (await tableEl?.isVisible().catch(() => false)) ?? false;
  const emptyVisible = (await emptyEl?.isVisible().catch(() => false)) ?? false;
  return { tableVisible, emptyVisible };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('stage trend report: nav link navigates to /reports @functional', async ({
  page,
  restClient,
}) => {
  const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
  test.skip(isMobile, 'left nav not rendered on mobile — mobile always uses NavTop');

  // Use left layout so links are always visible regardless of viewport width
  await setNavLayoutViaAPI('left', restClient);
  try {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
    await page.waitForLoadState('networkidle');
    // The left-nav layout is applied via a React Query setting; the nav link may
    // not be in the DOM immediately after networkidle if the setting fetch is still
    // in flight. Wait explicitly before attempting the click.
    await page.waitFor(
      [
        { type: 'testId', value: 'nav-left-reports' },
        { type: 'css', value: '[data-testid="nav-left-reports"]' },
      ],
      'visible',
      { intent: 'Reports nav link in left navigation bar' },
      10_000,
    );

    // Nav now has a single "Reports" link (MINCRM-294)
    const result = await navigateViaNavLink('left', 'reports', { page });

    expect(result.linkClicked).toBe(true);
    expect(new URL(result.finalUrl).pathname).toBe('/reports');
  } finally {
    await setNavLayoutViaAPI('top', restClient).catch(() => null);
  }
});

test('stage trend report: direct URL /reports?view=pipeline-stage shows heading and filter @functional', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports?view=pipeline-stage', { waitUntil: 'networkidle' });

  const reportsPage = new ReportsPage({ page });
  const heading = await reportsPage.stageTrendHeadingLocator();
  await expect(heading).toBeVisible({ timeout: 10_000 });

  const daysSelect = await reportsPage.daysSelectLocator();
  await expect(daysSelect).toBeVisible();
  await expect(daysSelect).toHaveValue('30');
});

test('stage trend report: old URL /reports/stage-trend redirects to /reports @functional', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports/stage-trend', { waitUntil: 'networkidle' });

  expect(new URL(page.url()).pathname).toBe('/reports');
});

test('stage trend report: table or empty state visible after load @functional', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports?view=pipeline-stage', { waitUntil: 'networkidle' });

  const reportsPage = new ReportsPage({ page });
  const { tableVisible, emptyVisible } = await waitForReportLoaded(reportsPage);

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

  const reportsPage = new ReportsPage({ page });

  // Wait for initial load to settle
  await waitForReportLoaded(reportsPage);

  // Switch to 60-day window
  const daysSelect = await reportsPage.daysSelectLocator();
  await daysSelect.selectOption('60');
  await expect(daysSelect).toHaveValue('60');

  // Wait for the new fetch to complete
  const { tableVisible, emptyVisible } = await waitForReportLoaded(reportsPage);
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

  const reportsPage = new ReportsPage({ page });
  const daysSelect = await reportsPage.daysSelectLocator();
  await daysSelect.selectOption('90');
  await expect(daysSelect).toHaveValue('90');
});
