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

  // ── Threads ────────────────────────────────────────────────────────────────
  //
  // A thread's own test ids carry a hash of its provider id, so a test finds a thread by
  // the subject it seeded, which every spec makes unique, and its messages by their ids.

  private threadCss(subject: string): string {
    return `li[data-testid^="email-thread-"]:has([data-testid="email-thread-subject"]:text-is(${JSON.stringify(subject)}))`;
  }

  /** Returns a resolved locator for the row that opens and closes the thread. */
  async threadRowLocator(subject: string, timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'css', value: `${this.threadCss(subject)} [data-thread-row]` },
          { type: 'css', value: `${this.threadCss(subject)} button[aria-expanded]` },
        ],
        { intent: 'row that expands one email thread' },
      )
      .resolve(timeout);
  }

  /** Opens the thread, leaving it open when it already is. */
  async expandThread(subject: string, timeout?: number): Promise<void> {
    const row = await this.threadRowLocator(subject, timeout);
    if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  }

  /** Opens one message in an expanded thread; only the latest starts open. */
  async openMessage(messageId: string, timeout?: number): Promise<void> {
    const toggle = await this.page
      .locate(
        [
          { type: 'testId', value: `email-message-toggle-${messageId}` },
          {
            type: 'css',
            value: `[data-testid="email-message-${messageId}"] button[aria-expanded]`,
          },
        ],
        { intent: 'header that opens one email message' },
      )
      .resolve(timeout);
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  }

  /** Returns a resolved locator for the thread's Mark private / Make visible button. */
  async threadPrivacyButtonLocator(subject: string, timeout?: number) {
    return this.page
      .locate(
        [
          {
            type: 'css',
            value: `${this.threadCss(subject)} button[data-testid^="email-thread-privacy-"]`,
          },
          {
            type: 'css',
            value: `${this.threadCss(subject)} button[aria-describedby^="email-thread-privacy-hint-"]`,
          },
        ],
        { intent: 'button toggling whether one email thread is private' },
      )
      .resolve(timeout);
  }

  /**
   * Waits for the thread to carry the Private badge, which renders once the list refetches
   * after a privacy change.
   */
  async waitForPrivateBadge(subject: string, timeout?: number): Promise<void> {
    const badge = await this.page
      .locate(
        [
          {
            type: 'css',
            value: `${this.threadCss(subject)} [data-testid^="email-thread-private-"]`,
          },
          {
            type: 'xpath',
            value: `//li[starts-with(@data-testid,"email-thread-")][.//*[@data-testid="email-thread-subject" and normalize-space()=${JSON.stringify(subject)}]]//*[starts-with(@data-testid,"email-thread-private-")]`,
          },
        ],
        { intent: 'Private badge on one email thread' },
      )
      .resolve(timeout);
    await badge.waitFor({ state: 'visible', timeout });
  }

  /** Counts the messages an expanded thread shows. */
  async threadMessageCount(subject: string, timeout?: number): Promise<number> {
    const messages = await this.page
      .locate(
        [
          {
            type: 'css',
            value: `${this.threadCss(subject)} article[data-testid^="email-message-"]`,
          },
          { type: 'css', value: `${this.threadCss(subject)} article` },
        ],
        { intent: 'messages shown in one expanded email thread' },
      )
      .resolve(timeout);
    return messages.count();
  }

  /** Reads every thread subject the section lists, in display order. */
  async threadSubjects(timeout?: number): Promise<string[]> {
    const subjects = await this.page
      .locate(
        [
          {
            type: 'css',
            value: '[data-testid="emails-thread-list"] [data-testid="email-thread-subject"]',
          },
          {
            type: 'css',
            value: '[data-testid="emails-section"] [data-testid="email-thread-subject"]',
          },
        ],
        { intent: 'subject line of each email thread on a record' },
      )
      .resolve(timeout);
    return (await subjects.allTextContents()).map((subject) => subject.trim());
  }

  /** Returns a resolved locator for one message's Reply button. */
  async replyButtonLocator(messageId: string, timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `email-reply-${messageId}` },
          {
            type: 'css',
            value: `[data-testid="email-message-${messageId}"] button[aria-describedby], [data-testid="email-message-${messageId}"] button:not([aria-expanded])`,
          },
        ],
        { intent: 'Reply button on one email message' },
      )
      .resolve(timeout);
  }
}
