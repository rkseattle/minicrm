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
   *
   * The role-based fallback uses an EXACT name match rather than /report/i:
   * the active sub-report (Win/Loss, Activity Volume, or Stage Trend) renders
   * its own <h1> containing "Report" in the same DOM tree, so the loose regex
   * matches both the shell heading and whichever sub-report is active. "Reports"
   * (the shell heading's fixed text) never varies, so exact match is safe here
   * — see AutomationPage.headingLocator() for the identical failure mode.
   */
  async headingLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-page-heading' },
          { type: 'role', value: 'heading', options: { name: 'Reports', exact: true } },
        ],
        { intent: 'main heading on the reports page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the tab list / sub-navigation container.
   */
  async tabListLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-tab-list' },
          { type: 'role', value: 'tablist' },
        ],
        { intent: 'tab list or sub-navigation on the reports page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the mobile tab select dropdown.
   * Throws if not found — only present on mobile viewports.
   */
  async tabListSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-tab-list-select' },
          { type: 'role', value: 'combobox', options: { name: /view|report/i } },
        ],
        { intent: 'mobile sub-navigation dropdown for selecting report view' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the Win/Loss tab button (desktop only).
   */
  async winLossTabLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-tab-win-loss' },
          { type: 'role', value: 'tab', options: { name: /win.loss/i } },
        ],
        { intent: 'Win/Loss report tab button in reports navigation' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the Activity Volume tab button (desktop only).
   */
  async activityTabLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-tab-activity' },
          { type: 'role', value: 'tab', options: { name: /activity/i } },
        ],
        { intent: 'Activity Volume report tab button in reports navigation' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the Pipeline Stage tab button (desktop only).
   */
  async stageTrendTabLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-tab-pipeline-stage' },
          { type: 'role', value: 'tab', options: { name: /pipeline|stage/i } },
        ],
        { intent: 'Pipeline Stage report tab button in reports navigation' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the Win/Loss report heading.
   */
  async winLossHeadingLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'win-loss-report-heading' },
          { type: 'role', value: 'heading', options: { name: /win.loss/i } },
        ],
        { intent: 'Win/Loss report section heading' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the Activity Volume report heading.
   */
  async activityVolumeHeadingLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-volume-report-heading' },
          { type: 'role', value: 'heading', options: { name: /activity/i } },
        ],
        { intent: 'Activity Volume report section heading' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the Stage Trend report heading.
   *
   * The role-based fallback uses an EXACT name match rather than /stage/i:
   * the table sub-heading "Breakdown by stage and period" also matches that
   * regex once the report has data — see AutomationPage.headingLocator() for
   * the identical failure mode.
   */
  async stageTrendHeadingLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stage-trend-report-heading' },
          {
            type: 'role',
            value: 'heading',
            options: { name: 'Pipeline Stage Trend', exact: true },
          },
        ],
        { intent: 'Pipeline Stage Trend report section heading' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the loading indicator.
   * Returns null if not in the DOM (report already loaded).
   */
  async loadingLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'report-loading' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'loading indicator while report data is being fetched' },
      )
      .resolve(timeout)
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the stage trend data table.
   * Returns null if not present (empty state).
   */
  async stageTrendTableLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stage-trend-table' },
          { type: 'role', value: 'table' },
        ],
        { intent: 'stage trend data table on pipeline stage report' },
      )
      .resolve(timeout)
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the stage trend empty state.
   * Returns null if not present (table is shown).
   */
  async stageTrendEmptyLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stage-trend-empty' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'empty state on pipeline stage report when no data exists' },
      )
      .resolve(timeout)
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the days-range select on the stage trend report.
   */
  async daysSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'days-select' },
          { type: 'role', value: 'combobox', options: { name: /days|range/i } },
        ],
        { intent: 'date range selector on stage trend report' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the date preset select on the win-loss report.
   */
  async datePresetSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'date-preset-select' },
          { type: 'role', value: 'combobox', options: { name: /preset|date/i } },
        ],
        { intent: 'date range preset selector dropdown on win/loss report' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the custom date range start input.
   */
  async customStartInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-start-input' },
          { type: 'label', value: 'Start', options: { exact: false } },
        ],
        { intent: 'custom date range start date input on win/loss report' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the custom date range end input.
   */
  async customEndInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-end-input' },
          { type: 'label', value: 'End', options: { exact: false } },
        ],
        { intent: 'custom date range end date input on win/loss report' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the stat cards container.
   */
  async statCardsLocator(timeout?: number) {
    // eslint-disable-next-line local/require-locator-fallback -- container has no accessible name; role:region matches unrelated landmarks
    return this.page
      .locate([{ type: 'testId', value: 'report-stat-cards' }], {
        intent: 'container holding the Won/Lost stat card metrics',
      })
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the won count stat value.
   */
  async wonCountValueLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stat-won-count-value' },
          { type: 'css', value: '[data-testid="stat-won-count-value"]' },
        ],
        { intent: 'displayed count of Closed Won deals on win/loss report' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the lost count stat value.
   */
  async lostCountValueLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stat-lost-count-value' },
          { type: 'css', value: '[data-testid="stat-lost-count-value"]' },
        ],
        { intent: 'displayed count of Closed Lost deals on win/loss report' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the win rate stat value.
   */
  async winRateValueLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stat-win-rate-value' },
          { type: 'css', value: '[data-testid="stat-win-rate-value"]' },
        ],
        { intent: 'displayed win rate percentage on win/loss report' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the Custom Reports tab button. (MINCRM-402)
   */
  async customReportsTabLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reports-tab-custom-reports' },
          { type: 'role', value: 'tab', options: { name: /custom report/i } },
        ],
        { intent: 'Custom Reports tab button in reports navigation' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the custom report builder container. (MINCRM-402)
   */
  async customReportBuilderLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-report-builder' },
          { type: 'role', value: 'region', options: { name: /report builder/i } },
        ],
        { intent: 'custom report builder form and results area' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the run-report button. (MINCRM-402)
   */
  async runReportButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'run-report-button' },
          { type: 'role', value: 'button', options: { name: /run report/i } },
        ],
        { intent: 'button to execute the custom report query' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the save-report button. (MINCRM-402)
   */
  async saveReportButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'save-report-button' },
          { type: 'role', value: 'button', options: { name: /save report/i } },
        ],
        { intent: 'button to open the save report dialog' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the save-report name input inside the dialog. (MINCRM-402)
   */
  async saveReportNameInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'save-report-name-input' },
          { type: 'role', value: 'textbox', options: { name: /report name/i } },
        ],
        { intent: 'text input for the report name in the save dialog' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the save-report confirm button inside the dialog. (MINCRM-402)
   */
  async saveReportConfirmLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'save-report-confirm' },
          { type: 'role', value: 'button', options: { name: /^save$/i } },
        ],
        { intent: 'confirm button to submit the save report dialog' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the results table. (MINCRM-402)
   * Returns null if not present (empty or not yet run).
   */
  async resultsTableLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'results-table' },
          { type: 'role', value: 'table' },
        ],
        { intent: 'results table displaying custom report rows' },
      )
      .resolve(timeout)
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the results empty state. (MINCRM-402)
   * Returns null if not present.
   */
  async resultsEmptyLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'results-empty' },
          { type: 'css', value: '[data-testid="results-empty"]' },
        ],
        { intent: 'empty state message when custom report returns no rows' },
      )
      .resolve(timeout)
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
  async entityTypeSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'entity-type-select' },
          { type: 'role', value: 'combobox', options: { name: /data source/i } },
        ],
        { intent: 'entity type selector in the custom report builder' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the saved-reports list sidebar. (MINCRM-402)
   */
  async savedReportsListLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'saved-reports-list' },
          { type: 'css', value: '[data-testid="saved-reports-list"]' },
        ],
        { intent: 'list of saved custom reports in the sidebar' },
      )
      .resolve(timeout);
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

  // ── Export buttons (MINCRM-601, MINCRM-652) ───────────────────────────────
  // Custom Report Builder and Activity Volume each have distinct testids
  // (custom-reports-export-* / activity-volume-export-*) since MINCRM-652
  // consolidated each view's export controls behind its own ExportMenu.

  /** Opens the Activity Volume report's Export menu. (MINCRM-652) */
  async openActivityVolumeExportMenu(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'activity-volume-export-menu-button' },
        { type: 'role', value: 'button', options: { name: /export/i } },
      ],
      { intent: 'trigger button that opens the activity volume export menu' },
    );
  }

  /** Returns a resolved locator for the Activity Volume Export CSV button. */
  async activityVolumeExportCsvButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-volume-export-csv-button' },
          { type: 'role', value: 'button', options: { name: /export csv/i } },
        ],
        { intent: 'control to export the activity volume report as CSV' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the Activity Volume Export PDF button. */
  async activityVolumeExportPdfButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-volume-export-pdf-button' },
          { type: 'role', value: 'button', options: { name: /export pdf/i } },
        ],
        { intent: 'control to export the activity volume report as PDF' },
      )
      .resolve(timeout);
  }

  /** Opens the Custom Report Builder's Export menu. (MINCRM-652) */
  async openCustomReportExportMenu(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'custom-reports-export-menu-button' },
        { type: 'role', value: 'button', options: { name: /export/i } },
      ],
      { intent: 'trigger button that opens the custom report builder export menu' },
    );
  }

  /**
   * Returns a resolved locator for the Custom Report Builder's Export CSV
   * control — a plain `<a href download>` anchor (role "link"), not a button.
   */
  async customReportExportCsvButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-reports-export-csv-button' },
          { type: 'css', value: '[data-testid="custom-reports-export-csv-button"]' },
        ],
        { intent: 'control to export the current custom report as CSV' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the Custom Report Builder's Export PDF
   * control — a plain `<a href download>` anchor (role "link"), not a button.
   */
  async customReportExportPdfButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-reports-export-pdf-button' },
          { type: 'css', value: '[data-testid="custom-reports-export-pdf-button"]' },
        ],
        { intent: 'control to export the current custom report as PDF' },
      )
      .resolve(timeout);
  }
}
