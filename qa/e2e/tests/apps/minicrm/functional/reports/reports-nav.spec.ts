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
  waitForNavLayoutFetched,
  waitForNavLink,
} from '@behaviors/minicrm/nav.behaviors.js';
import { navigateToPath } from '@behaviors/minicrm/layout.behaviors.js';
import {
  expectReportsHeadingVisible,
  expectReportsTabListVisible,
  expectReportsTabListSelectVisible,
  expectReportsTabListSelectHasValue,
  selectReportsMobileTab,
  expectReportsWinLossTabVisible,
  expectReportsActivityTabVisible,
  clickReportsActivityTab,
  expectReportsStageTrendTabVisible,
  expectReportsWinLossHeadingVisible,
  expectReportsActivityVolumeHeadingVisible,
  expectReportsStageTrendHeadingVisible,
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

    // Await the nav-layout API response AFTER navigating so we know the browser
    // has received the updated layout before asserting nav link visibility (MINCRM-554).
    const navLayoutReady = waitForNavLayoutFetched({ page }, 10_000);
    await navigateToPath('/', { page });
    await navLayoutReady;

    // waitForNavLink provides an additional guard in case React state propagation
    // lags behind the network response under heavy 2-worker load.
    await waitForNavLink('nav-left-reports', { page }, 5_000);
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

  await expectReportsHeadingVisible({ page }, 10_000);
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

  await expectReportsTabListVisible({ page }, 10_000);

  if (isMobile) {
    // On mobile SubPageNav renders a <select>; individual tab buttons are not in the DOM.
    await expectReportsTabListSelectVisible({ page });
    await expectReportsTabListSelectHasValue('win-loss', { page });
  } else {
    await expectReportsWinLossTabVisible({ page });
    await expectReportsActivityTabVisible({ page });
    await expectReportsStageTrendTabVisible({ page });
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

  await expectReportsWinLossHeadingVisible({ page }, 10_000);
});

test('reports nav: /reports?view=activity deep-links to Activity Volume @functional', async ({
  page,
  testData,
  restClient,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToPath('/reports?view=activity', { page });

  await expectReportsActivityVolumeHeadingVisible({ page }, 10_000);
});

test('reports nav: /reports?view=pipeline-stage deep-links to Pipeline Stage report @functional', async ({
  page,
  testData,
  restClient,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToPath('/reports?view=pipeline-stage', { page });

  await expectReportsStageTrendHeadingVisible({ page }, 10_000);
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
  await expectReportsWinLossHeadingVisible({ page }, 10_000);

  if (isMobile) {
    // On mobile SubPageNav renders a <select> — switch via selectOption.
    await selectReportsMobileTab('activity', { page });
  } else {
    await clickReportsActivityTab({ page });
  }

  await expectReportsActivityVolumeHeadingVisible({ page }, 10_000);
});
