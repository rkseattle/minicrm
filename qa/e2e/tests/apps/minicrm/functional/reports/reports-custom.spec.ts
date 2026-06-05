/**
 * Custom report builder functional tests. (MINCRM-402)
 *
 * Tests that:
 * - The Custom Reports tab is visible in the Reports navigation
 * - Clicking it renders the builder UI
 * - Running a report shows the results area (empty state or rows)
 * - Saving a report adds it to the saved reports list
 * - A saved report is accessible from the saved list
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - data-testid selectors only — no CSS class or positional selectors
 *   - No raw Page Object calls in spec — use behaviors
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToCustomReports,
  navigateToReportsPage,
  getCustomReportsTabLocator,
  getCustomReportBuilderLocator,
  getRunReportButtonLocator,
  saveCustomReport,
  runCustomReport,
  waitForSaveDialogClosed,
  getSavedReportByNameLocator,
  waitForSavedReportByName,
  getEntityTypeSelectLocator,
} from '@behaviors/minicrm/reports.behaviors.js';
import { createTestAdmin } from '@apps/minicrm/helpers.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
});

// ── Navigation ────────────────────────────────────────────────────────────────

test('custom reports: Custom Reports tab appears in reports navigation @functional @smoke', async ({
  page,
}) => {
  // Mobile renders a <select> combobox instead of tab buttons — skip on mobile viewports
  const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
  test.skip(isMobile, 'custom reports tab button not rendered on mobile — mobile uses combobox');

  await navigateToReportsPage({ page });

  const tabLocator = await getCustomReportsTabLocator({ page });
  expect(await tabLocator.isVisible()).toBe(true);
});

test('custom reports: navigating to custom-reports view renders the builder @functional', async ({
  page,
}) => {
  await navigateToCustomReports({ page });

  const builder = await getCustomReportBuilderLocator({ page });
  expect(await builder.isVisible()).toBe(true);
});

// ── Run report ────────────────────────────────────────────────────────────────

test('custom reports: running a report shows the results area @functional', async ({ page }) => {
  await navigateToCustomReports({ page });

  const runBtn = await getRunReportButtonLocator({ page });
  expect(await runBtn.isVisible()).toBe(true);

  // runCustomReport returns true when either results-table or results-empty appears
  const resultsVisible = await runCustomReport({ page });
  expect(resultsVisible).toBe(true);
});

// ── Save report ───────────────────────────────────────────────────────────────

test('custom reports: saving a report adds it to the saved list @functional', async ({ page }) => {
  await navigateToCustomReports({ page });

  const reportName = `E2E Test Report ${Date.now()}`;
  await saveCustomReport(reportName, { page });
  await waitForSaveDialogClosed({ page });

  // Wait specifically for the new report name to appear — avoids stale list from prior runs
  await waitForSavedReportByName(reportName, { page });
  const reportBtn = await getSavedReportByNameLocator(reportName, { page });
  expect(await reportBtn.isVisible()).toBe(true);
});

// ── Load saved report ─────────────────────────────────────────────────────────

test('custom reports: clicking a saved report loads its config into the builder @functional', async ({
  page,
  restClient,
}) => {
  const reportName = `E2E Load Report ${Date.now()}`;

  // Create a report via the API first to avoid a second UI save flow
  await restClient.post('/api/v1/reports/custom', {
    name: reportName,
    entity_type: 'deal',
    config: {
      selected_fields: ['id', 'name', 'stage'],
      filters: [],
    },
  });

  await navigateToCustomReports({ page });

  // Wait for the specific report we created — avoids clicking stale reports from prior runs
  const reportItem = await getSavedReportByNameLocator(reportName, { page });
  await reportItem.click();

  // Entity type selector should switch to 'deal'
  const entitySelect = await getEntityTypeSelectLocator({ page });
  const selectedValue = await entitySelect.inputValue();
  expect(selectedValue).toBe('deal');
});
