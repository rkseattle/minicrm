/**
 * NotificationBellPage — Page Object for the MiniCRM in-app notification bell.
 *
 * Encapsulates all UI interactions with the notification bell in the nav
 * header, present on every authenticated page. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-469
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by NotificationBellPage. */
export interface NotificationBellPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM in-app notification bell.
 */
export class NotificationBellPage {
  private readonly page: PageFacade;

  constructor(context: NotificationBellPageContext) {
    this.page = context.page;
  }

  /** Returns a resolved locator for the bell button. */
  async bellButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'notification-bell-button' },
          { type: 'role', value: 'button', options: { name: /notifications/i } },
        ],
        { intent: 'notification bell button in the nav header' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the unread-count badge. */
  async unreadBadgeLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'notification-unread-badge' },
          { type: 'css', value: '[data-testid="notification-unread-badge"]' },
        ],
        { intent: 'unread notification count badge' },
      )
      .resolve(timeout);
  }

  /**
   * Returns true when the unread-count badge is currently visible. Guards
   * presence first — locate().resolve() throws StrategyExhaustedError
   * immediately on an absent element rather than waiting for it, which is
   * unsuitable for "may legitimately be absent" checks (the badge is hidden
   * whenever unread count is zero).
   */
  async isUnreadBadgeVisible(): Promise<boolean> {
    const present = await this.page
      .waitForPresent('[data-testid="notification-unread-badge"]', 500)
      .then(() => true)
      .catch(() => false);
    if (!present) return false;
    const locator = await this.unreadBadgeLocator();
    return locator.isVisible().catch(() => false);
  }

  /** Returns a resolved locator for the dropdown empty state. */
  async emptyStateLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'notification-empty' },
          { type: 'text', value: 'No notifications yet' },
        ],
        { intent: 'empty state message in the notification dropdown' },
      )
      .resolve(timeout);
  }

  /** Clicks the bell button to open/close the dropdown. */
  async toggle(): Promise<void> {
    const locator = await this.bellButtonLocator();
    await locator.click();
  }
}
