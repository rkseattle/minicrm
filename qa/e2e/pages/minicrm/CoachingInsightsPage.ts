/**
 * CoachingInsightsPage — Page Object for the MiniCRM AI rep coaching insights
 * page.
 *
 * Encapsulates all UI interactions on `/insights/coaching`. Every element uses
 * a HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by CoachingInsightsPage. */
export interface CoachingInsightsPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM manager/admin rep coaching insights screen.
 */
export class CoachingInsightsPage {
  private readonly page: PageFacade;

  static readonly PATH = '/insights/coaching';

  constructor(context: CoachingInsightsPageContext) {
    this.page = context.page;
  }

  async navigate(): Promise<void> {
    await this.page.goto(CoachingInsightsPage.PATH);
  }

  /** Returns a resolved locator for the page heading. */
  async headingLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'coaching-insights-heading' },
          { type: 'role', value: 'heading', options: { name: /coaching/i } },
        ],
        { intent: 'rep coaching insights page main heading' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the rep selector dropdown. */
  async repSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'coaching-rep-select' },
          { type: 'css', value: '[data-testid="coaching-rep-select"]' },
        ],
        { intent: 'rep selector dropdown to switch whose insights are shown' },
      )
      .resolve(timeout);
  }

  /**
   * Selects a rep by ID from the rep selector dropdown. The <select> only
   * mounts once the team overview query resolves (a skeleton placeholder
   * renders until then) — waitForPresent guards against resolving the
   * locator before it exists in the DOM.
   */
  async selectRep(repId: string): Promise<void> {
    await this.page.waitForPresent('[data-testid="coaching-rep-select"]', 10_000);
    const select = await this.repSelectLocator();
    await select.selectOption(repId);
  }

  /** Returns a resolved locator for the insights list container. */
  async insightsListLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'coaching-insights-list' },
          { type: 'css', value: '[data-testid="coaching-insights-list"]' },
        ],
        { intent: 'list of coaching insight rows for the selected rep' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the insufficient-data message. */
  async insufficientDataLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'coaching-insights-insufficient-data' },
          { type: 'css', value: '[data-testid="coaching-insights-insufficient-data"]' },
        ],
        { intent: 'message shown when a rep has too few closed deals for coaching insights' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the no-insights (sufficient data, zero outliers) message. */
  async emptyInsightsLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'coaching-insights-empty' },
          { type: 'css', value: '[data-testid="coaching-insights-empty"]' },
        ],
        { intent: 'message shown when a rep has sufficient data but zero coaching insights' },
      )
      .resolve(timeout);
  }

  /**
   * Returns true once the insights list contains at least one row, polling up
   * to `timeout`. Never throws — callers branch on the boolean.
   */
  async hasAtLeastOneInsightRow(timeout = 10_000): Promise<boolean> {
    try {
      await this.page.waitFor(
        [
          { type: 'testId', value: 'coaching-insights-list' },
          { type: 'css', value: '[data-testid="coaching-insights-list"] li' },
        ],
        'visible',
        { intent: 'at least one coaching insight row rendered in the list' },
        timeout,
      );
      return true;
    } catch {
      return false;
    }
  }
}
