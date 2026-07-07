/**
 * ReportsPage — Page Object for the MiniCRM reports screen.
 *
 * Covers the reports shell at `/reports` with win-loss, activity-volume,
 * and stage-trend sub-views. Every element uses a HealingLocator with at
 * least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-284, MINCRM-294, MINCRM-312
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by ReportsPage. */
export interface ReportsPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM reports screen.
 */
export class ReportsPage {
  private readonly page: PageFacade;

  static readonly PATH = '/reports';

  constructor(context: ReportsPageContext) {
    this.page = context.page;
  }

  /**
   * Navigates to the reports page, optionally with a view query param.
   *
   * @param view - Optional view name (e.g. 'win-loss', 'activity', 'pipeline-stage').
   */
  async navigate(view?: string): Promise<void> {
    const path = view ? `${ReportsPage.PATH}?view=${view}` : ReportsPage.PATH;
    await this.page.goto(path);
  }

  /**
   * Returns a resolved locator for the reports page heading.
   */
  async headingLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-page-heading' },
          { type: 'role', value: 'heading', options: { name: /report/i } },
        ],
        { intent: 'main heading on the reports page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the tab list / sub-navigation container.
   */
  async tabListLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-tab-list' },
          { type: 'role', value: 'tablist' },
        ],
        { intent: 'tab list or sub-navigation on the reports page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the mobile tab select dropdown.
   * Throws if not found — only present on mobile viewports.
   */
  async tabListSelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-tab-list-select' },
          { type: 'role', value: 'combobox', options: { name: /view|report/i } },
        ],
        { intent: 'mobile sub-navigation dropdown for selecting report view' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the Win/Loss tab button (desktop only).
   */
  async winLossTabLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-tab-win-loss' },
          { type: 'role', value: 'tab', options: { name: /win.loss/i } },
        ],
        { intent: 'Win/Loss report tab button in reports navigation' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the Activity Volume tab button (desktop only).
   */
  async activityTabLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-tab-activity' },
          { type: 'role', value: 'tab', options: { name: /activity/i } },
        ],
        { intent: 'Activity Volume report tab button in reports navigation' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the Pipeline Stage tab button (desktop only).
   */
  async stageTrendTabLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-tab-pipeline-stage' },
          { type: 'role', value: 'tab', options: { name: /pipeline|stage/i } },
        ],
        { intent: 'Pipeline Stage report tab button in reports navigation' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the Win/Loss report heading.
   */
  async winLossHeadingLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'win-loss-report-heading' },
          { type: 'role', value: 'heading', options: { name: /win.loss/i } },
        ],
        { intent: 'Win/Loss report section heading' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the Activity Volume report heading.
   */
  async activityVolumeHeadingLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-volume-report-heading' },
          { type: 'role', value: 'heading', options: { name: /activity/i } },
        ],
        { intent: 'Activity Volume report section heading' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the Stage Trend report heading.
   */
  async stageTrendHeadingLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stage-trend-report-heading' },
          { type: 'role', value: 'heading', options: { name: /stage/i } },
        ],
        { intent: 'Pipeline Stage Trend report section heading' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the loading indicator.
   * Returns null if not in the DOM (report already loaded).
   */
  async loadingLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'report-loading' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'loading indicator while report data is being fetched' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the stage trend data table.
   * Returns null if not present (empty state).
   */
  async stageTrendTableLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stage-trend-table' },
          { type: 'role', value: 'table' },
        ],
        { intent: 'stage trend data table on pipeline stage report' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the stage trend empty state.
   * Returns null if not present (table is shown).
   */
  async stageTrendEmptyLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stage-trend-empty' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'empty state on pipeline stage report when no data exists' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the days-range select on the stage trend report.
   */
  async daysSelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'days-select' },
          { type: 'role', value: 'combobox', options: { name: /days|range/i } },
        ],
        { intent: 'date range selector on stage trend report' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the date preset select on the win-loss report.
   */
  async datePresetSelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'date-preset-select' },
          { type: 'role', value: 'combobox', options: { name: /preset|date/i } },
        ],
        { intent: 'date range preset selector dropdown on win/loss report' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the custom date range start input.
   */
  async customStartInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-start-input' },
          { type: 'label', value: 'Start', options: { exact: false } },
        ],
        { intent: 'custom date range start date input on win/loss report' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the custom date range end input.
   */
  async customEndInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-end-input' },
          { type: 'label', value: 'End', options: { exact: false } },
        ],
        { intent: 'custom date range end date input on win/loss report' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the stat cards container.
   */
  async statCardsLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'report-stat-cards' },
          { type: 'role', value: 'region' },
        ],
        { intent: 'container holding the Won/Lost stat card metrics' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the won count stat value.
   */
  async wonCountValueLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stat-won-count-value' },
          { type: 'css', value: '[data-testid="stat-won-count-value"]' },
        ],
        { intent: 'displayed count of Closed Won deals on win/loss report' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the lost count stat value.
   */
  async lostCountValueLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stat-lost-count-value' },
          { type: 'css', value: '[data-testid="stat-lost-count-value"]' },
        ],
        { intent: 'displayed count of Closed Lost deals on win/loss report' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the win rate stat value.
   */
  async winRateValueLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stat-win-rate-value' },
          { type: 'css', value: '[data-testid="stat-win-rate-value"]' },
        ],
        { intent: 'displayed win rate percentage on win/loss report' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the Custom Reports tab button. (MINCRM-402)
   */
  async customReportsTabLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-tab-custom-reports' },
          { type: 'role', value: 'tab', options: { name: /custom report/i } },
        ],
        { intent: 'Custom Reports tab button in reports navigation' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the custom report builder container. (MINCRM-402)
   */
  async customReportBuilderLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-report-builder' },
          { type: 'role', value: 'region', options: { name: /report builder/i } },
        ],
        { intent: 'custom report builder form and results area' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the run-report button. (MINCRM-402)
   */
  async runReportButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'run-report-button' },
          { type: 'role', value: 'button', options: { name: /run report/i } },
        ],
        { intent: 'button to execute the custom report query' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the save-report button. (MINCRM-402)
   */
  async saveReportButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'save-report-button' },
          { type: 'role', value: 'button', options: { name: /save report/i } },
        ],
        { intent: 'button to open the save report dialog' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the save-report name input inside the dialog. (MINCRM-402)
   */
  async saveReportNameInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'save-report-name-input' },
          { type: 'role', value: 'textbox', options: { name: /report name/i } },
        ],
        { intent: 'text input for the report name in the save dialog' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the save-report confirm button inside the dialog. (MINCRM-402)
   */
  async saveReportConfirmLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'save-report-confirm' },
          { type: 'role', value: 'button', options: { name: /^save$/i } },
        ],
        { intent: 'confirm button to submit the save report dialog' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the results table. (MINCRM-402)
   * Returns null if not present (empty or not yet run).
   */
  async resultsTableLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'results-table' },
          { type: 'role', value: 'table' },
        ],
        { intent: 'results table displaying custom report rows' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the results empty state. (MINCRM-402)
   * Returns null if not present.
   */
  async resultsEmptyLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'results-empty' },
          { type: 'css', value: '[data-testid="results-empty"]' },
        ],
        { intent: 'empty state message when custom report returns no rows' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Waits for either the results table or the empty-state element to appear
   * in the DOM after clicking run, using a short-circuit DOM poll rather than
   * the HealingLocator to avoid AI-tier latency on optional elements. (MINCRM-402)
   */
  async waitForResultsVisible(timeout = 30_000): Promise<boolean> {
    try {
      await this.page.waitForFunction(
        `document.querySelector('[data-testid="results-table"]') !== null || document.querySelector('[data-testid="results-empty"]') !== null`,
        undefined,
        { timeout },
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns a resolved locator for the entity-type selector in the builder. (MINCRM-402)
   */
  async entityTypeSelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'entity-type-select' },
          { type: 'role', value: 'combobox', options: { name: /data source/i } },
        ],
        { intent: 'entity type selector in the custom report builder' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the saved-reports list sidebar. (MINCRM-402)
   */
  async savedReportsListLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'saved-reports-list' },
          { type: 'css', value: '[data-testid="saved-reports-list"]' },
        ],
        { intent: 'list of saved custom reports in the sidebar' },
      )
      .resolve();
  }

  /**
   * Waits for a specific report name to appear in the saved-reports sidebar, then
   * returns a resolved locator for its button. (MINCRM-402)
   *
   * Prefer this over positional locators so stale reports from prior test runs do
   * not cause false matches.
   */
  async savedReportByNameLocator(name: string, timeout = 10_000) {
    const escaped = name.replace(/'/g, "\\'");
    await this.page.waitForFunction(
      `Array.from(document.querySelectorAll('[data-testid="saved-reports-list"] li button')).some(b => b.textContent && b.textContent.trim() === '${escaped}')`,
      undefined,
      { timeout },
    );
    return this.page
      .locate(
        [
          {
            type: 'role',
            value: 'button',
            options: { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) },
          },
          { type: 'css', value: `[data-testid="saved-reports-list"] li button` },
        ],
        { intent: `saved report button with name "${name}" in the sidebar list` },
      )
      .resolve();
  }

  /**
   * Waits for the save-report dialog to close. (MINCRM-402)
   */
  async waitForSaveDialogClosed(timeout = 10_000): Promise<void> {
    await this.page.waitForFunction(
      `document.querySelector('[data-testid="save-report-dialog"]') === null`,
      undefined,
      { timeout },
    );
  }

  /**
   * Waits for the saved-reports list to contain at least one item. (MINCRM-402)
   */
  async waitForSavedReportsListPopulated(timeout = 10_000): Promise<void> {
    await this.page.waitForFunction(
      `document.querySelectorAll('[data-testid="saved-reports-list"] li').length > 0`,
      undefined,
      { timeout },
    );
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }

  // ── Export buttons (MINCRM-601) ───────────────────────────────────────────
  // Shared testids across custom-report-builder and activity-volume views —
  // safe because only one view is mounted at a time (Reports tabs unmount
  // the previous view's content rather than hiding it in the DOM).

  /**
   * Returns a resolved locator for the Export CSV button (custom report
   * builder or activity volume view, whichever is currently mounted).
   */
  async exportCsvButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'export-csv-button' },
          { type: 'role', value: 'button', options: { name: /export csv/i } },
        ],
        { intent: 'button to export the current report view as CSV' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the Export PDF button (custom report
   * builder or activity volume view, whichever is currently mounted).
   */
  async exportPdfButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'export-pdf-button' },
          { type: 'role', value: 'button', options: { name: /export pdf/i } },
        ],
        { intent: 'button to export the current report view as PDF' },
      )
      .resolve();
  }
}
