/**
 * Reports page sub-navigation functional tests. (MINCRM-294)
 *
 * Tests that the Reports page:
 * - Is reachable via the "Reports" nav link
 * - Shows the SubPageNav with three items
 * - Defaults to the Win/Loss report
 * - Responds to direct ?view=activity deep-links
 * - Old /reports/win-loss URL redirects to /reports
 * - SubPageNav tab switching renders the correct content
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
if (!ADMIN_PASSWORD) throw new Error('[reports-nav-spec] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeAll(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('reports nav: clicking Reports nav link lands on /reports @functional', async ({
  page,
  restClient,
}) => {
  const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
  test.skip(isMobile, 'left nav not rendered on mobile — mobile always uses NavTop');

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
    const result = await navigateViaNavLink('left', 'reports', { page });
    expect(result.linkClicked).toBe(true);
    expect(new URL(result.finalUrl).pathname).toBe('/reports');
  } finally {
    await setNavLayoutViaAPI('top', restClient).catch(() => null);
  }
});

test('reports nav: /reports shows the page heading @functional', async ({ page }) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports', { waitUntil: 'networkidle' });

  const reportsPage = new ReportsPage({ page });
  const heading = await reportsPage.headingLocator();
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

test('reports nav: /reports shows SubPageNav with three tabs @functional', async ({ page }) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports', { waitUntil: 'networkidle' });

  const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
  const reportsPage = new ReportsPage({ page });

  const tabList = await reportsPage.tabListLocator();
  await expect(tabList).toBeVisible({ timeout: 10_000 });

  if (isMobile) {
    // On mobile SubPageNav renders a <select>; individual tab buttons are not in the DOM.
    const select = await reportsPage.tabListSelectLocator();
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('win-loss');
  } else {
    const winLossTab = await reportsPage.winLossTabLocator();
    const activityTab = await reportsPage.activityTabLocator();
    const stageTab = await reportsPage.stageTrendTabLocator();

    await expect(winLossTab).toBeVisible();
    await expect(activityTab).toBeVisible();
    await expect(stageTab).toBeVisible();
  }
});

test('reports nav: /reports defaults to Win/Loss report content @functional', async ({ page }) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports', { waitUntil: 'networkidle' });

  const reportsPage = new ReportsPage({ page });
  const heading = await reportsPage.winLossHeadingLocator();
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

test('reports nav: /reports?view=activity deep-links to Activity Volume @functional', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports?view=activity', { waitUntil: 'networkidle' });

  const reportsPage = new ReportsPage({ page });
  const heading = await reportsPage.activityVolumeHeadingLocator();
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

test('reports nav: /reports?view=pipeline-stage deep-links to Pipeline Stage report @functional', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports?view=pipeline-stage', { waitUntil: 'networkidle' });

  const reportsPage = new ReportsPage({ page });
  const heading = await reportsPage.stageTrendHeadingLocator();
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

test('reports nav: old /reports/win-loss URL redirects to /reports @functional', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports/win-loss', { waitUntil: 'networkidle' });
  expect(new URL(page.url()).pathname).toBe('/reports');
});

test('reports nav: switching tabs renders the selected report @functional', async ({ page }) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports', { waitUntil: 'networkidle' });

  const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
  const reportsPage = new ReportsPage({ page });

  // Wait for default (win-loss) to load
  const winLossHeading = await reportsPage.winLossHeadingLocator();
  await expect(winLossHeading).toBeVisible({ timeout: 10_000 });

  if (isMobile) {
    // On mobile SubPageNav renders a <select> — switch via selectOption.
    const select = await reportsPage.tabListSelectLocator();
    await select?.selectOption('activity');
  } else {
    const activityTab = await reportsPage.activityTabLocator();
    await activityTab.click();
  }

  const activityHeading = await reportsPage.activityVolumeHeadingLocator();
  await expect(activityHeading).toBeVisible({ timeout: 10_000 });
});
