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
 * Returns a resolved locator for the reports page heading.
 */
export async function getReportsHeadingLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.headingLocator();
}

/**
 * Returns a resolved locator for the tab list / sub-navigation container.
 */
export async function getReportsTabListLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.tabListLocator();
}

/**
 * Returns a resolved locator for the mobile tab select dropdown.
 */
export async function getReportsTabListSelectLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.tabListSelectLocator();
}

/**
 * Returns a resolved locator for the Win/Loss tab button.
 */
export async function getReportsWinLossTabLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.winLossTabLocator();
}

/**
 * Returns a resolved locator for the Activity Volume tab button.
 */
export async function getReportsActivityTabLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.activityTabLocator();
}

/**
 * Returns a resolved locator for the Pipeline Stage tab button.
 */
export async function getReportsStageTrendTabLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.stageTrendTabLocator();
}

/**
 * Returns a resolved locator for the Win/Loss report heading.
 */
export async function getReportsWinLossHeadingLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.winLossHeadingLocator();
}

/**
 * Returns a resolved locator for the Activity Volume report heading.
 */
export async function getReportsActivityVolumeHeadingLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.activityVolumeHeadingLocator();
}

/**
 * Returns a resolved locator for the Stage Trend report heading.
 */
export async function getReportsStageTrendHeadingLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.stageTrendHeadingLocator();
}

/**
 * Returns a resolved locator for the loading indicator (null if not present).
 */
export async function getReportsLoadingLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.loadingLocator();
}

/**
 * Returns a resolved locator for the stage trend data table (null if not present).
 */
export async function getReportsStageTrendTableLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.stageTrendTableLocator();
}

/**
 * Returns a resolved locator for the stage trend empty state (null if not present).
 */
export async function getReportsStageTrendEmptyLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.stageTrendEmptyLocator();
}

/**
 * Returns a resolved locator for the days-range select on the stage trend report.
 */
export async function getReportsDaysSelectLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.daysSelectLocator();
}

/**
 * Returns a resolved locator for the date preset select on the win-loss report.
 */
export async function getReportsDatePresetSelectLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.datePresetSelectLocator();
}

/**
 * Returns a resolved locator for the custom date range start input.
 */
export async function getReportsCustomStartInputLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.customStartInputLocator();
}

/**
 * Returns a resolved locator for the custom date range end input.
 */
export async function getReportsCustomEndInputLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.customEndInputLocator();
}

/**
 * Returns a resolved locator for the stat cards container.
 */
export async function getReportsStatCardsLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.statCardsLocator();
}

/**
 * Returns a resolved locator for the won count stat value.
 */
export async function getReportsWonCountValueLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.wonCountValueLocator();
}

/**
 * Returns a resolved locator for the lost count stat value.
 */
export async function getReportsLostCountValueLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.lostCountValueLocator();
}

/**
 * Returns a resolved locator for the win rate stat value.
 */
export async function getReportsWinRateValueLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.winRateValueLocator();
}

// ---------------------------------------------------------------------------
// Navigation helpers — keep direct page.goto() out of spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Navigates to the win/loss report page and waits for network idle.
 */
export async function navigateToWinLossReport(context: ReportsBehaviorContext): Promise<void> {
  await context.page.goto('/reports?view=win-loss', { waitUntil: 'networkidle' });
}

/**
 * Navigates to the pipeline stage trend report page and waits for network idle.
 */
export async function navigateToStageTrendReport(context: ReportsBehaviorContext): Promise<void> {
  await context.page.goto('/reports?view=pipeline-stage', { waitUntil: 'networkidle' });
}

/**
 * Reloads the current page and waits for network idle.
 */
export async function reloadPage(context: ReportsBehaviorContext): Promise<void> {
  await context.page.reload({ waitUntil: 'networkidle' });
}

// ── Custom Reports behaviors (MINCRM-402) ────────────────────────────────────

/**
 * Navigates to the Custom Reports tab on the reports page.
 */
export async function navigateToCustomReports(context: ReportsBehaviorContext): Promise<void> {
  await context.page.goto('/reports?view=custom-reports', { waitUntil: 'networkidle' });
}

/**
 * Returns a resolved locator for the Custom Reports tab.
 */
export async function getCustomReportsTabLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.customReportsTabLocator();
}

/**
 * Returns a resolved locator for the custom report builder area.
 */
export async function getCustomReportBuilderLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.customReportBuilderLocator();
}

/**
 * Returns a resolved locator for the run-report button.
 */
export async function getRunReportButtonLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.runReportButtonLocator();
}

/**
 * Returns a resolved locator for the results table (null if not present).
 */
export async function getCustomReportResultsTableLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.resultsTableLocator();
}

/**
 * Returns a resolved locator for the results empty state (null if not present).
 */
export async function getCustomReportResultsEmptyLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.resultsEmptyLocator();
}

/**
 * Returns a resolved locator for the saved-reports list sidebar.
 */
export async function getSavedReportsListLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.savedReportsListLocator();
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
  const runBtn = await reportsPage.runReportButtonLocator();
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
 * Waits for a specific report name to appear in the saved-reports sidebar and
 * returns a resolved locator for its button.
 *
 * Use this instead of positional locators to avoid matching stale reports from
 * prior test runs.
 */
export async function getSavedReportByNameLocator(
  name: string,
  context: ReportsBehaviorContext,
  timeout = 10_000,
) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.savedReportByNameLocator(name, timeout);
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
  // savedReportByNameLocator already performs the waitForFunction internally
  await getSavedReportByNameLocator(name, context, timeout);
}

/**
 * Returns a resolved locator for the entity-type selector in the builder.
 */
export async function getEntityTypeSelectLocator(context: ReportsBehaviorContext) {
  const reportsPage = new ReportsPage(context);
  return reportsPage.entityTypeSelectLocator();
}

/**
 * Navigates to the main reports page (no specific view) and waits for network idle.
 */
export async function navigateToReportsPage(context: ReportsBehaviorContext): Promise<void> {
  await context.page.goto('/reports', { waitUntil: 'networkidle' });
}
