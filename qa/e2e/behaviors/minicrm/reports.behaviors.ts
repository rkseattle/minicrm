/**
 * Reports behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-357
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import { gotoAndSettle, navigateAndSettle } from '@apps/minicrm/helpers.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { ReportsPage } from '@pages/minicrm/ReportsPage.js';

// ---------------------------------------------------------------------------
// API data types (MINCRM-357)
// ---------------------------------------------------------------------------

/** Shape of the win-loss report API response. */
export interface WinLossReport {
  wonCount: number;
  wonValue: string;
  lostCount: number;
  lostValue: string;
  winRate: number | null;
  lossReasonBreakdown: Array<{ reason: string; count: number }>;
}

// ---------------------------------------------------------------------------
// API data-fetch helpers (MINCRM-357)
// ---------------------------------------------------------------------------

/**
 * Fetches the win-loss report from the API for the given date range.
 *
 * @param restClient - Authenticated RestClient.
 * @param start - Start date in YYYY-MM-DD format.
 * @param end - End date in YYYY-MM-DD format.
 * @returns The win-loss report.
 */
export async function getWinLossReport(
  restClient: RestClient,
  start: string,
  end: string,
): Promise<WinLossReport> {
  const res = await restClient.get<WinLossReport>(
    `/api/v1/reports/win-loss?start=${start}&end=${end}`,
  );
  return res.body;
}

// ---------------------------------------------------------------------------
// Locator-accessor behaviors — wrap ReportsPage locators
// so spec files never import @pages/* directly. (MINCRM-367)
// ---------------------------------------------------------------------------

/** Fixture context for reports UI behaviors. */
export interface ReportsBehaviorContext {
  page: PageFacade;
}

/**
 * Navigates to the reports page, optionally deep-linking to a view.
 */
export async function navigateToReports(
  view: string | undefined,
  context: ReportsBehaviorContext,
): Promise<void> {
  const reportsPage = new ReportsPage(context);
  await reportsPage.navigate(view);
}

/**
 * Asserts the reports page heading is visible.
 */
export async function expectReportsHeadingVisible(
  context: ReportsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  await expect(await reportsPage.headingLocator(timeout)).toBeVisible({ timeout });
}

/**
 * Asserts the reports tab list / sub-navigation container is visible.
 */
export async function expectReportsTabListVisible(
  context: ReportsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  await expect(await reportsPage.tabListLocator(timeout)).toBeVisible({ timeout });
}

/**
 * Asserts the mobile tab select dropdown is visible.
 */
export async function expectReportsTabListSelectVisible(
  context: ReportsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  await expect(await reportsPage.tabListSelectLocator()).toBeVisible();
}

/**
 * Asserts the mobile tab select dropdown has the expected value.
 */
export async function expectReportsTabListSelectHasValue(
  value: string,
  context: ReportsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  await expect(await reportsPage.tabListSelectLocator()).toHaveValue(value);
}

/**
 * Selects a tab via the mobile tab select dropdown.
 */
export async function selectReportsMobileTab(
  value: string,
  context: ReportsBehaviorContext,
): Promise<void> {
  const reportsPage = new ReportsPage(context);
  const select = await reportsPage.tabListSelectLocator();
  await select?.selectOption(value);
}

/**
 * Asserts the Win/Loss tab button is visible.
 */
export async function expectReportsWinLossTabVisible(
  context: ReportsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  await expect(await reportsPage.winLossTabLocator()).toBeVisible();
}

/**
 * Asserts the Activity Volume tab button is visible.
 */
export async function expectReportsActivityTabVisible(
  context: ReportsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  await expect(await reportsPage.activityTabLocator()).toBeVisible();
}

/**
 * Clicks the Activity Volume tab button.
 */
export async function clickReportsActivityTab(context: ReportsBehaviorContext): Promise<void> {
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.activityTabLocator();
  await locator.click();
}

/**
 * Asserts the Pipeline Stage Trend tab button is visible.
 */
export async function expectReportsStageTrendTabVisible(
  context: ReportsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  await expect(await reportsPage.stageTrendTabLocator()).toBeVisible();
}

/**
 * Asserts the Win/Loss report heading is visible.
 */
export async function expectReportsWinLossHeadingVisible(
  context: ReportsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  await expect(await reportsPage.winLossHeadingLocator(timeout)).toBeVisible({ timeout });
}

/**
 * Asserts the Activity Volume report heading is visible.
 */
export async function expectReportsActivityVolumeHeadingVisible(
  context: ReportsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  await expect(await reportsPage.activityVolumeHeadingLocator(timeout)).toBeVisible({ timeout });
}

/**
 * Asserts the Stage Trend report heading is visible.
 */
export async function expectReportsStageTrendHeadingVisible(
  context: ReportsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  await expect(await reportsPage.stageTrendHeadingLocator(timeout)).toBeVisible({ timeout });
}

/**
 * Waits for the loading indicator to be hidden (reports finished loading).
 */
export async function waitForReportsLoadingHidden(
  context: ReportsBehaviorContext,
  timeout = 15_000,
): Promise<void> {
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.loadingLocator(timeout);
  await locator?.waitFor({ state: 'hidden', timeout }).catch(() => null);
}

/**
 * Returns true when the stage trend data table is visible.
 */
export async function isReportsStageTrendTableVisible(
  context: ReportsBehaviorContext,
): Promise<boolean> {
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.stageTrendTableLocator();
  return (await locator?.isVisible().catch(() => false)) ?? false;
}

/**
 * Returns true when the stage trend empty state is visible.
 */
export async function isReportsStageTrendEmptyVisible(
  context: ReportsBehaviorContext,
): Promise<boolean> {
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.stageTrendEmptyLocator();
  return (await locator?.isVisible().catch(() => false)) ?? false;
}

/**
 * Waits until the stage trend report has left its loading state AND painted one
 * of its terminal states — table, empty, or error. (MINCRM-703)
 *
 * WHY THIS EXISTS
 * ---------------
 * The two detectors above resolve a healing locator and swallow a miss into
 * `false`, so on their own they ask "is it painted at this instant" and turn a
 * render still in flight into `table || empty === false`.
 *
 * WHY IT WAITS ON FOUR STATES, NOT TWO
 * ------------------------------------
 * The first version of this waited only for table-or-empty and did NOT fix the
 * record-mode failure. Its DOM snapshot is why: the panel had rendered its
 * heading and the "Date range" label and then STOPPED — no table, no empty
 * state, no error, no loading indicator, and not even the days-select the test
 * had already successfully used moments earlier.
 *
 * StageTrendReportPage renders four mutually exclusive branches — isLoading,
 * isError, report+empty, report+data — and there is a fifth, unrendered
 * combination it does not handle. `queryKey` includes `days`, so changing the
 * range mounts a NEW cache entry; in React Query v5 `isLoading` is
 * `isPending && isFetching`, so while the new key is settling there is a window
 * where isLoading is false, isError is false and `report` is still undefined.
 * The component then renders none of its four states, which is precisely the
 * captured DOM. A wait for table-or-empty burns its whole budget in that gap.
 *
 * So loading is a NEGATIVE condition — transient, and matching it would let the
 * caller probe mid-fetch — while error is treated as settled: the page has
 * reached a terminal state, and the caller's assertion should then fail on the
 * missing table rather than time out here with no hint the request errored.
 *
 * waitForReportsLoadingHidden does not cover any of this — it .catch()es its own
 * wait, so when the spinner locator never resolves it returns having waited for
 * nothing at all.
 *
 * ONE race, not sequential budgets. Giving each detector its own generous
 * timeout costs loading + table + empty per call, and callers run this twice in
 * a test with a 60s ceiling — that arithmetic guarantees the very timeout it is
 * meant to prevent. Measured: doing it that way took this spec from 1 failure
 * to 3.
 *
 * Sized to match waitForReportsLoadingHidden rather than the per-test ceiling,
 * for the same reason.
 *
 * Resolves rather than throws on timeout, deliberately: the caller then probes
 * and asserts, so a genuine miss reports WHICH state was absent instead of
 * being masked as a wait failure.
 */
export async function waitForStageTrendSettled(
  context: ReportsBehaviorContext,
  timeout = 15_000,
): Promise<void> {
  await context.page
    .waitForFunction(
      `(() => {
         const q = (id) => document.querySelector('[data-testid="' + id + '"]') !== null;
         // Loading is TRANSIENT, so it is a negative condition, never a match:
         // treating it as settled would let the caller probe mid-fetch.
         if (q('report-loading')) return false;
         // Error counts as settled. The page has finished and reached a terminal
         // state; the caller's assertion should then fail on the missing table,
         // not time out here with no indication the request errored.
         return q('stage-trend-table') || q('stage-trend-empty') || q('report-error');
       })()`,
      undefined,
      { timeout },
    )
    .catch(() => undefined);
}

/**
 * Selects a day-range option on the stage trend report.
 */
export async function selectReportsDays(
  days: string,
  context: ReportsBehaviorContext,
): Promise<void> {
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.daysSelectLocator();
  await locator.selectOption(days);
}

/**
 * Asserts the days-range select has the expected value.
 */
export async function expectReportsDaysSelectHasValue(
  value: string,
  context: ReportsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  await expect(await reportsPage.daysSelectLocator()).toHaveValue(value);
}

/**
 * Selects a date preset option on the win-loss report.
 */
export async function selectReportsDatePreset(
  preset: string,
  context: ReportsBehaviorContext,
): Promise<void> {
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.datePresetSelectLocator();
  await locator.selectOption(preset);
}

/**
 * Fills the custom date range start input.
 */
export async function fillReportsCustomStartInput(
  date: string,
  context: ReportsBehaviorContext,
): Promise<void> {
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.customStartInputLocator();
  await locator.fill(date);
}

/**
 * Fills the custom date range end input.
 */
export async function fillReportsCustomEndInput(
  date: string,
  context: ReportsBehaviorContext,
): Promise<void> {
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.customEndInputLocator();
  await locator.fill(date);
}

/**
 * Asserts the stat cards container is visible.
 */
export async function expectReportsStatCardsVisible(
  context: ReportsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  await expect(await reportsPage.statCardsLocator(timeout)).toBeVisible({ timeout });
}

/**
 * Returns the text content of the won count stat value.
 */
export async function getReportsWonCountText(
  context: ReportsBehaviorContext,
): Promise<string | null> {
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.wonCountValueLocator();
  return locator.textContent();
}

/**
 * Returns the text content of the lost count stat value.
 */
export async function getReportsLostCountText(
  context: ReportsBehaviorContext,
): Promise<string | null> {
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.lostCountValueLocator();
  return locator.textContent();
}

/**
 * Asserts the win rate stat value is visible.
 */
export async function expectReportsWinRateVisible(context: ReportsBehaviorContext): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  await expect(await reportsPage.winRateValueLocator()).toBeVisible();
}

/**
 * Returns the text content of the win rate stat value.
 */
export async function getReportsWinRateText(
  context: ReportsBehaviorContext,
): Promise<string | null> {
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.winRateValueLocator();
  return locator.textContent();
}

// ---------------------------------------------------------------------------
// Navigation helpers — keep direct page.goto() out of spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Navigates to the win/loss report page and waits for network idle.
 */
export async function navigateToWinLossReport(context: ReportsBehaviorContext): Promise<void> {
  await gotoAndSettle(context.page, '/reports?view=win-loss');
}

/**
 * Navigates to the pipeline stage trend report page and waits for network idle.
 */
export async function navigateToStageTrendReport(context: ReportsBehaviorContext): Promise<void> {
  await gotoAndSettle(context.page, '/reports?view=pipeline-stage');
}

/**
 * Reloads the current page and waits for network idle.
 */
export async function reloadPage(context: ReportsBehaviorContext): Promise<void> {
  await navigateAndSettle(context.page, () =>
    context.page.reload({ waitUntil: 'domcontentloaded' }),
  );
}

// ── Custom Reports behaviors (MINCRM-402) ────────────────────────────────────

/**
 * Navigates to the Custom Reports tab on the reports page.
 */
export async function navigateToCustomReports(context: ReportsBehaviorContext): Promise<void> {
  await gotoAndSettle(context.page, '/reports?view=custom-reports');
}

/**
 * Asserts the Custom Reports tab is visible.
 */
export async function expectCustomReportsTabVisible(
  context: ReportsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  expect(await (await reportsPage.customReportsTabLocator()).isVisible()).toBe(true);
}

/**
 * Asserts the custom report builder area is visible.
 */
export async function expectCustomReportBuilderVisible(
  context: ReportsBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  expect(await (await reportsPage.customReportBuilderLocator()).isVisible()).toBe(true);
}

/**
 * Asserts the run-report button is visible.
 */
export async function expectRunReportButtonVisible(context: ReportsBehaviorContext): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  expect(await (await reportsPage.runReportButtonLocator()).isVisible()).toBe(true);
}

/**
 * Runs a report via the builder and returns true once results (table or empty
 * state) are visible in the DOM.
 *
 * Uses waitForFunction to avoid HealingLocator AI-tier latency when checking
 * for optional elements.
 */
export async function runCustomReport(
  context: ReportsBehaviorContext,
  timeout = 30_000,
): Promise<boolean> {
  const reportsPage = new ReportsPage(context);
  const runBtn = await reportsPage.runReportButtonLocator(timeout);
  await runBtn.click();
  return reportsPage.waitForResultsVisible(timeout);
}

/**
 * Saves the current builder config as a new named report.
 *
 * @param name - The name to enter in the save dialog.
 */
export async function saveCustomReport(
  name: string,
  context: ReportsBehaviorContext,
): Promise<void> {
  const reportsPage = new ReportsPage(context);
  const saveBtn = await reportsPage.saveReportButtonLocator();
  await saveBtn.click();
  const nameInput = await reportsPage.saveReportNameInputLocator();
  await nameInput.fill(name);
  const confirmBtn = await reportsPage.saveReportConfirmLocator();
  await confirmBtn.click();
}

/**
 * Waits for the save-report dialog to disappear after submission.
 */
export async function waitForSaveDialogClosed(
  context: ReportsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const reportsPage = new ReportsPage(context);
  await reportsPage.waitForSaveDialogClosed(timeout);
}

/**
 * Waits for the saved-reports list sidebar to have at least one item.
 */
export async function waitForSavedReportsList(
  context: ReportsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const reportsPage = new ReportsPage(context);
  await reportsPage.waitForSavedReportsListPopulated(timeout);
}

/**
 * Waits for a specific report name to appear in the saved-reports sidebar.
 *
 * Use after saveCustomReport() to confirm the new report is visible before asserting.
 */
export async function waitForSavedReportByName(
  name: string,
  context: ReportsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const reportsPage = new ReportsPage(context);
  await reportsPage.savedReportByNameLocator(name, timeout);
}

/**
 * Asserts the named saved report is visible in the sidebar.
 */
export async function expectSavedReportByNameVisible(
  name: string,
  context: ReportsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.savedReportByNameLocator(name, timeout);
  expect(await locator.isVisible()).toBe(true);
}

/**
 * Clicks the named saved report in the sidebar to load it.
 */
export async function clickSavedReportByName(
  name: string,
  context: ReportsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.savedReportByNameLocator(name, timeout);
  await locator.click();
}

/**
 * Returns the current value of the entity-type selector in the report builder.
 */
export async function getReportsEntityTypeSelectValue(
  context: ReportsBehaviorContext,
): Promise<string> {
  const reportsPage = new ReportsPage(context);
  const locator = await reportsPage.entityTypeSelectLocator();
  return locator.inputValue();
}

/**
 * Navigates to the main reports page (no specific view) and waits for network idle.
 */
export async function navigateToReportsPage(context: ReportsBehaviorContext): Promise<void> {
  await gotoAndSettle(context.page, '/reports');
}

// ---------------------------------------------------------------------------
// Export — Custom Report Builder / Activity Volume (MINCRM-601)
// ---------------------------------------------------------------------------

/**
 * Clicks the Activity Volume report's "Export PDF" button (a real button
 * that fetches via blob+axios) and waits for the underlying export.pdf HTTP
 * response, returning its status and content-type so the spec can assert a
 * real download was triggered. Opens the Export menu first (MINCRM-652).
 */
export async function clickReportExportPdfAndAwaitResponse(
  context: ReportsBehaviorContext,
  urlPattern: string,
): Promise<{ status: number; contentType: string }> {
  const reportsPage = new ReportsPage(context);
  await reportsPage.openActivityVolumeExportMenu();
  const responsePromise = context.page.waitForResponse(
    (response) => response.url().includes(urlPattern) && response.request().method() === 'GET',
  );
  const button = await reportsPage.activityVolumeExportPdfButtonLocator();
  await button.click();
  const response = await responsePromise;
  return {
    status: response.status(),
    contentType: response.headers()['content-type'] ?? '',
  };
}

/**
 * Clicks the Custom Report Builder's "Export PDF" control — a plain
 * `<a href download>` anchor, not a button that fetches via JS — and waits
 * for the browser's native download event rather than an HTTP response,
 * since Chromium routes `download`-attribute anchor clicks through its
 * download manager instead of the page's normal navigation/fetch lifecycle
 * (page.waitForResponse does not reliably observe it). Opens the Export
 * menu first (MINCRM-652).
 */
export async function clickCustomReportExportPdfAndAwaitDownload(
  context: ReportsBehaviorContext,
): Promise<{ suggestedFilename: string }> {
  const reportsPage = new ReportsPage(context);
  await reportsPage.openCustomReportExportMenu();
  const downloadPromise = context.page.waitForEvent('download');
  const button = await reportsPage.customReportExportPdfButtonLocator();
  await button.click();
  const download = await downloadPromise;
  return { suggestedFilename: download.suggestedFilename() };
}
