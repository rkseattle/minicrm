/**
 * WinLossInsightsPage — Page Object for the MiniCRM AI win/loss pattern insights page.
 *
 * Encapsulates all UI interactions on `/insights/win-loss`. Every element uses
 * a HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-464
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by WinLossInsightsPage. */
export interface WinLossInsightsPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM win/loss pattern insights screen.
 */
export class WinLossInsightsPage {
  private readonly page: PageFacade;

  static readonly PATH = '/insights/win-loss';

  constructor(context: WinLossInsightsPageContext) {
    this.page = context.page;
  }

  async navigate(): Promise<void> {
    await this.page.goto(WinLossInsightsPage.PATH);
  }

  /** Returns a resolved locator for the page heading. */
  async headingLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'win-loss-insights-heading' },
          { type: 'role', value: 'heading', options: { name: /win.loss/i } },
        ],
        { intent: 'win/loss pattern insights page heading' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the insufficient-data message. */
  async insufficientDataLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'win-loss-insufficient-data' },
          { type: 'text', value: 'not enough closed deal history' },
        ],
        { intent: 'message shown when there is not enough closed deal history for patterns' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the win patterns section heading. */
  async winPatternsHeadingLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'win-patterns-heading' },
          { type: 'role', value: 'heading', options: { name: /win patterns/i } },
        ],
        { intent: 'win patterns section heading' },
      )
      .resolve();
  }

  /**
   * Returns true when the win patterns section heading is currently visible.
   * Guards presence first — locate().resolve() throws StrategyExhaustedError
   * immediately on an absent element rather than waiting for it, which is
   * unsuitable for "may legitimately be absent" checks.
   */
  async isWinPatternsHeadingVisible(): Promise<boolean> {
    const present = await this.page
      .waitForPresent('[data-testid="win-patterns-heading"]', 500)
      .then(() => true)
      .catch(() => false);
    if (!present) return false;
    const locator = await this.winPatternsHeadingLocator();
    return locator.isVisible().catch(() => false);
  }

  /** Returns a resolved locator for the loss reason trends section heading. */
  async lossReasonTrendsHeadingLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'loss-reason-trends-heading' },
          { type: 'role', value: 'heading', options: { name: /loss reason trends/i } },
        ],
        { intent: 'loss reason trends section heading' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the Export CSV button. */
  async exportCsvButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'win-loss-export-csv-button' },
          { type: 'role', value: 'button', options: { name: /export csv/i } },
        ],
        { intent: 'button to export win/loss insights as CSV' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the Export PDF button. */
  async exportPdfButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'win-loss-export-pdf-button' },
          { type: 'role', value: 'button', options: { name: /export pdf/i } },
        ],
        { intent: 'button to export win/loss insights as PDF' },
      )
      .resolve();
  }
}
