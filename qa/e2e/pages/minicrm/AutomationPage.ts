/**
 * AutomationPage — Page Object for the MiniCRM automation rules admin screen.
 *
 * Covers the admin view at `/admin/automation`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 *
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by AutomationPage. */
export interface AutomationPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM automation rules admin screen.
 */
export class AutomationPage {
  private readonly page: PageFacade;

  /** The URL path for this page. */
  static readonly PATH = '/admin/automation';

  constructor(context: AutomationPageContext) {
    this.page = context.page;
  }

  /**
   * Navigates directly to the automation rules admin page.
   */
  async navigate(): Promise<void> {
    await this.page.goto(AutomationPage.PATH);
  }

  /**
   * Returns a resolved locator for the automation rules page heading.
   *
   * The role-based fallback uses an EXACT name match rather than a
   * case-insensitive substring regex: the page's empty state renders its own
   * heading with the text "No automation rules" (automation.emptyTitle),
   * which also matches /automation/i. Under a strict-mode assertion (e.g.
   * expect(locator).toBeVisible()), a fallback that ambiguously matches both
   * the real page heading ("Automation Rules") and the empty-state heading
   * throws instead of healing, if the primary testId strategy ever times out
   * (e.g. under CI load) and this fallback gets returned as the resolved
   * locator. Exact match keeps the fallback unambiguous in that scenario.
   */
  async headingLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'automation-rules-heading' },
          { type: 'role', value: 'heading', options: { name: 'Automation Rules', exact: true } },
        ],
        { intent: 'automation rules page heading' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the pagination controls bar.
   * Returns null if pagination is not present (fewer records than page size).
   */
  async paginationLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'pagination' },
          { type: 'css', value: '[data-testid="pagination"]' },
        ],
        { intent: 'pagination bar showing record count and page controls' },
      )
      .resolve(timeout);
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
