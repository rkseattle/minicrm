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
 *
 * Parallelism (MINCRM-550):
 *   File-scope parallel mode is enabled below. Safety audit passed:
 *   - beforeEach creates a fresh UUID-suffixed admin via TestDataManager; no
 *     shared user records between tests.
 *   - The stage-trend report is read-only; tests only select date ranges and
 *     assert on empty/populated state — no writes to shared data.
 *   - No system_settings writes in any test.
 */

// Enable intra-file parallelism: tests run concurrently across workers.
// Safety-audited in MINCRM-550: all data is UUID-scoped, no shared state.
test.describe.configure({ mode: 'parallel' });

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToStageTrendReport,
  waitForReportsLoadingHidden,
  isReportsStageTrendTableVisible,
  isReportsStageTrendEmptyVisible,
  selectReportsDays,
  expectReportsDaysSelectHasValue,
} from '@behaviors/minicrm/reports.behaviors.js';
import { createTestAdmin, withFlags } from '@apps/minicrm/helpers.js';
import type { PageFacade } from '@framework/fixtures/index.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  await withFlags(page, { reporting: true });
  await loginViaBrowser(admin.email, admin.password, { page });
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
  await waitForReportsLoadingHidden({ page }, 15_000);
  const tableVisible = await isReportsStageTrendTableVisible({ page });
  const emptyVisible = await isReportsStageTrendEmptyVisible({ page });
  return { tableVisible, emptyVisible };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('stage trend report: table or empty state visible after load @functional', async ({
  page,
}) => {
  await navigateToStageTrendReport({ page });

  const { tableVisible, emptyVisible } = await waitForReportLoaded(page);

  expect(
    tableVisible || emptyVisible,
    'either the stage trend table or the empty-state message must be visible after load',
  ).toBe(true);
});

test('stage trend report: changing date range to 60 days re-fetches and still shows table or empty state @functional', async ({
  page,
}) => {
  await navigateToStageTrendReport({ page });

  // Wait for initial load to settle
  await waitForReportLoaded(page);

  // Switch to 60-day window
  await selectReportsDays('60', { page });
  await expectReportsDaysSelectHasValue('60', { page });

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
  await navigateToStageTrendReport({ page });

  await selectReportsDays('90', { page });
  await expectReportsDaysSelectHasValue('90', { page });
});
