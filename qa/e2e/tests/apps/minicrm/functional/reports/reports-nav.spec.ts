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
 *   - No raw Page Object calls in spec — use behaviors or page.locate/goto/click
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import { navigateViaNavLink, setNavLayoutViaAPI } from '@behaviors/minicrm/nav.behaviors.js';

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
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('reports nav: clicking Reports nav link lands on /reports @functional', async ({
  page,
  restClient,
}) => {
  await setNavLayoutViaAPI('left', restClient);
  try {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
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

  const heading = await page
    .locate([
      { type: 'testId', value: 'reports-page-heading' },
      { type: 'css', value: '[data-testid="reports-page-heading"]' },
    ])
    .resolve();
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

test('reports nav: /reports shows SubPageNav with three tabs @functional', async ({ page }) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports', { waitUntil: 'networkidle' });

  const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;

  const tabList = await page
    .locate([
      { type: 'testId', value: 'reports-tab-list' },
      { type: 'css', value: '[data-testid="reports-tab-list"]' },
    ])
    .resolve();
  await expect(tabList).toBeVisible({ timeout: 10_000 });

  if (isMobile) {
    // On mobile SubPageNav renders a <select>; individual tab buttons are not in the DOM.
    const select = await page
      .locate([
        { type: 'testId', value: 'reports-tab-list-select' },
        { type: 'css', value: '[data-testid="reports-tab-list-select"]' },
      ])
      .resolve();
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('win-loss');
  } else {
    const winLossTab = await page
      .locate([
        { type: 'testId', value: 'reports-tab-win-loss' },
        { type: 'css', value: '[data-testid="reports-tab-win-loss"]' },
      ])
      .resolve();
    const activityTab = await page
      .locate([
        { type: 'testId', value: 'reports-tab-activity' },
        { type: 'css', value: '[data-testid="reports-tab-activity"]' },
      ])
      .resolve();
    const stageTab = await page
      .locate([
        { type: 'testId', value: 'reports-tab-pipeline-stage' },
        { type: 'css', value: '[data-testid="reports-tab-pipeline-stage"]' },
      ])
      .resolve();

    await expect(winLossTab).toBeVisible();
    await expect(activityTab).toBeVisible();
    await expect(stageTab).toBeVisible();
  }
});

test('reports nav: /reports defaults to Win/Loss report content @functional', async ({ page }) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports', { waitUntil: 'networkidle' });

  const heading = await page
    .locate([
      { type: 'testId', value: 'win-loss-report-heading' },
      { type: 'css', value: '[data-testid="win-loss-report-heading"]' },
    ])
    .resolve();
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

test('reports nav: /reports?view=activity deep-links to Activity Volume @functional', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports?view=activity', { waitUntil: 'networkidle' });

  const heading = await page
    .locate([
      { type: 'testId', value: 'activity-volume-report-heading' },
      { type: 'css', value: '[data-testid="activity-volume-report-heading"]' },
    ])
    .resolve();
  await expect(heading).toBeVisible({ timeout: 10_000 });
});

test('reports nav: /reports?view=pipeline-stage deep-links to Pipeline Stage report @functional', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/reports?view=pipeline-stage', { waitUntil: 'networkidle' });

  const heading = await page
    .locate([
      { type: 'testId', value: 'stage-trend-report-heading' },
      { type: 'css', value: '[data-testid="stage-trend-report-heading"]' },
    ])
    .resolve();
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

  // Wait for default (win-loss) to load
  const winLossHeading = await page
    .locate([
      { type: 'testId', value: 'win-loss-report-heading' },
      { type: 'css', value: '[data-testid="win-loss-report-heading"]' },
    ])
    .resolve();
  await expect(winLossHeading).toBeVisible({ timeout: 10_000 });

  if (isMobile) {
    // On mobile SubPageNav renders a <select> — switch via selectOption.
    const select = await page
      .locate([
        { type: 'testId', value: 'reports-tab-list-select' },
        { type: 'css', value: '[data-testid="reports-tab-list-select"]' },
      ])
      .resolve();
    await select.selectOption('activity');
  } else {
    const activityTab = await page
      .locate([
        { type: 'testId', value: 'reports-tab-activity' },
        { type: 'css', value: '[data-testid="reports-tab-activity"]' },
      ])
      .resolve();
    await activityTab.click();
  }

  const activityHeading = await page
    .locate([
      { type: 'testId', value: 'activity-volume-report-heading' },
      { type: 'css', value: '[data-testid="activity-volume-report-heading"]' },
    ])
    .resolve();
  await expect(activityHeading).toBeVisible({ timeout: 10_000 });
});
