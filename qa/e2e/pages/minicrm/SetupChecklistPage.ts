/**
 * SetupChecklistPage — Page Object for the MiniCRM setup checklist widget.
 *
 * Encapsulates UI interactions with the floating setup checklist widget that
 * appears for first-run admin sessions. Every element uses a HealingLocator
 * with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-379
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by SetupChecklistPage. */
export interface SetupChecklistPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM setup checklist widget.
 */
export class SetupChecklistPage {
  private readonly page: PageFacade;

  constructor(context: SetupChecklistPageContext) {
    this.page = context.page;
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Returns a resolved locator for the expanded setup checklist widget.
   * Throws if the widget is not found — use `page.isNotVisible` to assert absence.
   */
  async widgetLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'setup-checklist-widget' },
          { type: 'role', value: 'region', options: { name: /setup checklist/i } },
        ],
        { intent: 'expanded setup checklist widget container', fallbackTimeout: 10_000 },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the collapsed pill.
   * Throws if the pill is not found.
   */
  async pillLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'setup-checklist-pill' },
          { type: 'role', value: 'button', options: { name: /setup checklist/i } },
        ],
        {
          intent: 'collapsed setup checklist pill in the bottom-right corner',
          fallbackTimeout: 10_000,
        },
      )
      .resolve(timeout);
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  /**
   * Clicks the X dismiss button to permanently close the setup checklist widget.
   */
  async dismiss(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'setup-checklist-dismiss-button' },
        { type: 'role', value: 'button', options: { name: /dismiss/i } },
      ],
      { intent: 'dismiss button to permanently close the setup checklist' },
    );
  }

  /**
   * Clicks the collapse chevron to minimise the widget to a pill.
   */
  async collapse(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'setup-checklist-collapse-button' },
        { type: 'role', value: 'button', options: { name: /collapse/i } },
      ],
      { intent: 'collapse chevron to minimise the setup checklist widget to a pill' },
    );
  }
}
