/**
 * AdminSettingsPage — Page Object for the MiniCRM admin settings screen.
 *
 * Encapsulates all UI interactions on `/admin/settings`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-163, MINCRM-192
 */

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by AdminSettingsPage. */
export interface AdminSettingsPageContext {
  page: Page;
  healPage: HealPage;
  /** Current test name, passed to HealingLocator.resolve() for heal audit records. */
  testName: string;
}

// ---------------------------------------------------------------------------
// AdminSettingsPage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM admin settings screen.
 *
 * Usage:
 * ```ts
 * const adminSettings = new AdminSettingsPage({ page, healPage, testName });
 * await adminSettings.navigate();
 * await adminSettings.toggleEmailNotifications();
 * const enabled = await adminSettings.emailNotificationsIsEnabled();
 * ```
 */
export class AdminSettingsPage {
  private readonly page: Page;
  private readonly healPage: HealPage;
  private readonly testName: string;

  /** The URL path for this page. */
  static readonly PATH = '/admin/settings';

  /**
   * @param context - Playwright fixture context containing page, healPage, and testName.
   */
  constructor(context: AdminSettingsPageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
    this.testName = context.testName;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigates directly to the admin settings page URL.
   */
  async navigate(): Promise<void> {
    await this.page.goto(AdminSettingsPage.PATH);
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Returns true when the email notifications section is visible.
   */
  async emailNotificationsSectionIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: 'email-notifications-section' },
          { type: 'css', value: '[data-testid="email-notifications-section"]' },
        ])
        .resolve(this.testName);
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the email notifications toggle is visible.
   */
  async emailNotificationsToggleIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: 'email-notif-toggle' },
          { type: 'css', value: '[data-testid="email-notif-toggle"]' },
        ])
        .resolve(this.testName);
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the email notifications toggle has aria-checked="true".
   */
  async emailNotificationsIsEnabled(): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: 'email-notif-toggle' },
          { type: 'css', value: '[data-testid="email-notif-toggle"]' },
        ])
        .resolve(this.testName);
      const ariaChecked = await resolved.getAttribute('aria-checked');
      return ariaChecked === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the recipient count element is visible.
   */
  async recipientCountIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: 'email-notif-recipient-count' },
          { type: 'css', value: '[data-testid="email-notif-recipient-count"]' },
        ])
        .resolve(this.testName);
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the success message after toggling email notifications is visible.
   */
  async successMessageIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: 'email-notif-success' },
          { type: 'css', value: '[data-testid="email-notif-success"]' },
        ])
        .resolve(this.testName);
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  /**
   * Clicks the email notifications toggle to switch its state.
   */
  async toggleEmailNotifications(): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: 'email-notif-toggle' },
      { type: 'css', value: '[data-testid="email-notif-toggle"]' },
    ]);
  }
}
