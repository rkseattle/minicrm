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
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateViaNavLink,
  setNavLayoutViaAPI,
  waitForNavLink,
} from '@behaviors/minicrm/nav.behaviors.js';
import { navigateToPath } from '@behaviors/minicrm/layout.behaviors.js';
import {
  getReportsHeadingLocator,
  getReportsTabListLocator,
  getReportsTabListSelectLocator,
  getReportsWinLossTabLocator,
  getReportsActivityTabLocator,
  getReportsStageTrendTabLocator,
  getReportsWinLossHeadingLocator,
  getReportsActivityVolumeHeadingLocator,
  getReportsStageTrendHeadingLocator,
} from '@behaviors/minicrm/reports.behaviors.js';
import { createTestAdmin, withFlags } from '@apps/minicrm/helpers.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, page }) => {
  await loginAsAdmin(restClient);
  await ensureSystemDefaults(restClient);
  await withFlags(page, { reporting: true });
});

test.afterEach(async ({ restClient }) => {
  await ensureSystemDefaults(restClient);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('reports nav: clicking Reports nav link lands on /reports @functional @serial', async ({
  page,
  restClient,
  testData,
}) => {
  const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
  test.skip(isMobile, 'left nav not rendered on mobile — mobile always uses NavTop');

  try {
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });

    // Set nav layout to 'left' AFTER login so the browser's initial nav-layout
    // fetch completes first. Then navigate to a page that will trigger a
    // React Query refetch of the (now-left) layout.
    await setNavLayoutViaAPI('left', restClient);
    await navigateToPath('/', { page });

    // The left-nav layout is applied via a React Query setting; the nav link may
    // not be in the DOM immediately after networkidle if the setting fetch is still
    // in flight. Wait explicitly before attempting the click.
    await waitForNavLink('nav-left-reports', { page }, 10_000);
    const result = await navigateViaNavLink('left', 'reports', { page });
    expect(result.linkClicked).toBe(true);
    expect(new URL(result.finalUrl).pathname).toBe('/reports');
  } finally {
    await setNavLayoutViaAPI('top', restClient).catch(() => null);
  }
});

test('reports nav: /reports shows the page heading @functional', async ({
  page,
  testData,
  restClient,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToPath('/reports', { page });

  const heading = await getReportsHeadingLocator({ page });
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

test('reports nav: /reports shows SubPageNav with three tabs @functional', async ({
  page,
  testData,
  restClient,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToPath('/reports', { page });

  const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;

  const tabList = await getReportsTabListLocator({ page });
  await expect(tabList).toBeVisible({ timeout: 10_000 });

  if (isMobile) {
    // On mobile SubPageNav renders a <select>; individual tab buttons are not in the DOM.
    const select = await getReportsTabListSelectLocator({ page });
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('win-loss');
  } else {
    const winLossTab = await getReportsWinLossTabLocator({ page });
    const activityTab = await getReportsActivityTabLocator({ page });
    const stageTab = await getReportsStageTrendTabLocator({ page });

    await expect(winLossTab).toBeVisible();
    await expect(activityTab).toBeVisible();
    await expect(stageTab).toBeVisible();
  }
});

test('reports nav: /reports defaults to Win/Loss report content @functional', async ({
  page,
  testData,
  restClient,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToPath('/reports', { page });

  const heading = await getReportsWinLossHeadingLocator({ page });
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

test('reports nav: /reports?view=activity deep-links to Activity Volume @functional', async ({
  page,
  testData,
  restClient,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToPath('/reports?view=activity', { page });

  const heading = await getReportsActivityVolumeHeadingLocator({ page });
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

test('reports nav: /reports?view=pipeline-stage deep-links to Pipeline Stage report @functional', async ({
  page,
  testData,
  restClient,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToPath('/reports?view=pipeline-stage', { page });

  const heading = await getReportsStageTrendHeadingLocator({ page });
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

test('reports nav: old /reports/win-loss URL redirects to /reports @functional', async ({
  page,
  testData,
  restClient,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToPath('/reports/win-loss', { page });
  expect(new URL(page.url()).pathname).toBe('/reports');
});

test('reports nav: switching tabs renders the selected report @functional', async ({
  page,
  testData,
  restClient,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToPath('/reports', { page });

  const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;

  // Wait for default (win-loss) to load
  const winLossHeading = await getReportsWinLossHeadingLocator({ page });
  await expect(winLossHeading).toBeVisible({ timeout: 10_000 });

  if (isMobile) {
    // On mobile SubPageNav renders a <select> — switch via selectOption.
    const select = await getReportsTabListSelectLocator({ page });
    await select?.selectOption('activity');
  } else {
    const activityTab = await getReportsActivityTabLocator({ page });
    await activityTab.click();
  }

  const activityHeading = await getReportsActivityVolumeHeadingLocator({ page });
  await expect(activityHeading).toBeVisible({ timeout: 10_000 });
});
