/**
 * AiUsageDashboardPage — Page Object for the MiniCRM AI usage/cost dashboard.
 *
 * Encapsulates all UI interactions on `/admin/ai/usage`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-459
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by AiUsageDashboardPage. */
export interface AiUsageDashboardPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM AI usage/cost dashboard screen.
 */
export class AiUsageDashboardPage {
  private readonly page: PageFacade;

  static readonly PATH = '/admin/ai/usage';

  constructor(context: AiUsageDashboardPageContext) {
    this.page = context.page;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  async navigate(): Promise<void> {
    await this.page.goto(AiUsageDashboardPage.PATH);
  }

  // ---------------------------------------------------------------------------
  // Locators
  // ---------------------------------------------------------------------------

  /** Returns a resolved locator for the total-tokens summary card. */
  async totalTokensCardLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-usage-total-tokens-card' },
          { type: 'text', value: 'Total Tokens' },
        ],
        { intent: 'summary card showing total input+output tokens for the selected range' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the per-user usage table. */
  async perUserTableLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-usage-per-user-table' },
          { type: 'role', value: 'table' },
        ],
        { intent: 'per-user AI usage/cost breakdown table' },
      )
      .resolve(timeout);
  }

  /** Clicks a date range preset button (e.g. 'last_month', 'custom'). */
  async selectRangePreset(preset: string): Promise<void> {
    await this.page.click([
      { type: 'testId', value: `ai-usage-range-${preset}` },
      { type: 'role', value: 'button' },
    ]);
  }

  /** Opens the Export menu, revealing the CSV/PDF items. (MINCRM-652) */
  async openExportMenu(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'ai-usage-export-menu-button' },
        { type: 'role', value: 'button', options: { name: /export/i } },
      ],
      { intent: 'trigger button that opens the AI usage export menu' },
    );
  }

  /** Clicks the Export CSV button. */
  async clickExportCsv(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'ai-usage-export-csv-button' },
        { type: 'role', value: 'button', options: { name: /export csv/i } },
      ],
      { intent: 'button to export AI usage data as CSV' },
    );
  }

  /** Clicks the Export PDF button. (MINCRM-601) */
  async clickExportPdf(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'ai-usage-export-pdf-button' },
        { type: 'role', value: 'button', options: { name: /export pdf/i } },
      ],
      { intent: 'button to export AI usage data as PDF' },
    );
  }
}
