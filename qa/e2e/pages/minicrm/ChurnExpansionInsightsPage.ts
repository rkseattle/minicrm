/**
 * ChurnExpansionInsightsPage — Page Object for the MiniCRM AI churn/expansion
 * insights page.
 *
 * Encapsulates all UI interactions on `/insights/churn-expansion`. Every
 * element uses a HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 *
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by ChurnExpansionInsightsPage. */
export interface ChurnExpansionInsightsPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM churn/expansion insights screen.
 */
export class ChurnExpansionInsightsPage {
  private readonly page: PageFacade;

  static readonly PATH = '/insights/churn-expansion';

  constructor(context: ChurnExpansionInsightsPageContext) {
    this.page = context.page;
  }

  async navigate(): Promise<void> {
    await this.page.goto(ChurnExpansionInsightsPage.PATH);
  }

  /**
   * Returns a resolved locator for the page heading.
   *
   * The role-based fallback uses an EXACT name match rather than a
   * case-insensitive /at-risk|expansion/ regex: the page also renders two
   * section headings ("At-Risk Accounts", "Expansion Opportunities") that
   * both match that pattern, so a strict-mode assertion (e.g.
   * expect(locator).toBeVisible()) throws instead of healing if the primary
   * testId strategy ever times out (e.g. under CI load) and this fallback is
   * returned as the resolved locator — see AutomationPage.headingLocator()
   * for the identical failure mode and fix.
   */
  async headingLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'churn-expansion-insights-heading' },
          {
            type: 'role',
            value: 'heading',
            options: { name: 'At-Risk & Expansion Accounts', exact: true },
          },
        ],
        { intent: 'churn/expansion insights page heading' },
      )
      .resolve(timeout);
  }

  /**
   * Returns true when the page heading is currently visible. Guards presence
   * first — locate().resolve() throws StrategyExhaustedError immediately on
   * an absent element rather than waiting for it, which is unsuitable for
   * "may legitimately be absent" checks (the whole page is hidden when the
   * ai_churn_expansion_detection flag is off).
   */
  async isHeadingVisible(): Promise<boolean> {
    const present = await this.page
      .waitForPresent('[data-testid="churn-expansion-insights-heading"]', 500)
      .then(() => true)
      .catch(() => false);
    if (!present) return false;
    const locator = await this.headingLocator();
    return locator.isVisible().catch(() => false);
  }

  /** Returns a resolved locator for the at-risk accounts empty state. */
  async atRiskEmptyStateLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'at-risk-accounts-empty' },
          { type: 'text', value: 'No accounts currently at risk' },
        ],
        { intent: 'empty state message when no accounts are at risk' },
      )
      .resolve(timeout);
  }
}
