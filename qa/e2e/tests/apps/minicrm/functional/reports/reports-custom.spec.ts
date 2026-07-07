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
  expectCustomReportsTabVisible,
  expectCustomReportBuilderVisible,
  expectRunReportButtonVisible,
  saveCustomReport,
  runCustomReport,
  waitForSaveDialogClosed,
  expectSavedReportByNameVisible,
  waitForSavedReportByName,
  clickSavedReportByName,
  getReportsEntityTypeSelectValue,
  clickReportExportPdfAndAwaitResponse,
} from '@behaviors/minicrm/reports.behaviors.js';
import { createTestAdmin, withFlags } from '@apps/minicrm/helpers.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  await withFlags(page, { reporting: true });
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

  await expectCustomReportsTabVisible({ page });
});

test('custom reports: navigating to custom-reports view renders the builder @functional', async ({
  page,
}) => {
  await navigateToCustomReports({ page });

  await expectCustomReportBuilderVisible({ page });
});

// ── Run report ────────────────────────────────────────────────────────────────

test('custom reports: running a report shows the results area @functional', async ({ page }) => {
  await navigateToCustomReports({ page });

  await expectRunReportButtonVisible({ page });

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
  await expectSavedReportByNameVisible(reportName, { page });
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
  await clickSavedReportByName(reportName, { page });

  // Entity type selector should switch to 'deal'
  const selectedValue = await getReportsEntityTypeSelectValue({ page });
  expect(selectedValue).toBe('deal');
});

// ── Export PDF (MINCRM-601) ───────────────────────────────────────────────────

test('custom reports: clicking Export PDF on a saved, run report downloads a PDF file @functional', async ({
  page,
  restClient,
}) => {
  const reportName = `E2E PDF Export Report ${Date.now()}`;

  await restClient.post('/api/v1/reports/custom', {
    name: reportName,
    entity_type: 'deal',
    config: {
      selected_fields: ['id', 'name', 'stage'],
      filters: [],
    },
  });

  await navigateToCustomReports({ page });
  await clickSavedReportByName(reportName, { page });

  // Export PDF only renders once the loaded report has been run (activeReportId && result)
  const resultsVisible = await runCustomReport({ page });
  expect(resultsVisible).toBe(true);

  const { status, contentType } = await clickReportExportPdfAndAwaitResponse(
    { page },
    '/export.pdf',
  );

  expect(status, 'export.pdf response should return 200').toBe(200);
  expect(contentType, 'response Content-Type should be application/pdf').toContain(
    'application/pdf',
  );
});
