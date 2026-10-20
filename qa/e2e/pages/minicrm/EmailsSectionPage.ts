/**
 * EmailsSectionPage — Page Object for the Emails section on record detail pages.
 *
 * The section is embedded by contact, lead, account and deal detail pages and renders
 * nothing at all when email sync is off or the user cannot manage mailboxes, so its
 * absence is a real state rather than a missing element. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls, no assertions.
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by EmailsSectionPage. */
export interface EmailsSectionPageContext {
  page: PageFacade;
}

/**
 * Page Object for the EmailsSection component.
 *
 * Does NOT navigate — callers navigate to the parent record's detail page first.
 */
export class EmailsSectionPage {
  private readonly page: PageFacade;

  constructor(context: EmailsSectionPageContext) {
    this.page = context.page;
  }

  /** Returns a resolved locator for the section container. */
  async sectionLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'emails-section' },
          { type: 'role', value: 'region', options: { name: /^emails$/i } },
        ],
        { intent: 'Emails section on a record detail page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns true when the section is absent from the DOM.
   *
   * @param timeout - How long each strategy is probed for absence.
   */
  async sectionIsAbsent(timeout: number): Promise<boolean> {
    return this.page.doesNotExist(
      [
        { type: 'testId', value: 'emails-section' },
        { type: 'role', value: 'region', options: { name: /^emails$/i } },
      ],
      timeout,
    );
  }

  /** Returns a resolved locator for the empty-state message. */
  async emptyStateLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'emails-empty' },
          { type: 'css', value: '[data-testid="emails-section"] [data-testid="emails-empty"]' },
        ],
        { intent: 'message saying no email is linked to this record' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the Compose button. */
  async composeButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'emails-compose' },
          {
            type: 'role',
            value: 'button',
            options: { name: /^compose$/i },
            within: 'emails-section',
          },
        ],
        { intent: 'Compose button that starts a new email' },
      )
      .resolve(timeout);
  }
}
