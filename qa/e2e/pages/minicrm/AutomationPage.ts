/**
 * AutomationPage — Page Object for the MiniCRM automation rules admin screen.
 *
 * Covers the admin view at `/admin/automation`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-202, MINCRM-344
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
   */
  async headingLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'automation-rules-heading' },
          { type: 'role', value: 'heading', options: { name: /automation/i } },
        ],
        { intent: 'automation rules page heading' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the pagination controls bar.
   * Returns null if pagination is not present (fewer records than page size).
   */
  async paginationLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'pagination' },
          { type: 'css', value: '[data-testid="pagination"]' },
        ],
        { intent: 'pagination bar showing record count and page controls' },
      )
      .resolve();
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
