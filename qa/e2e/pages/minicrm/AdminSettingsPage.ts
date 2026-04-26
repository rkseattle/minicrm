/**
 * AdminSettingsPage — Page Object for the MiniCRM admin settings screen.
 *
 * Encapsulates all UI interactions on `/admin/settings`. Every element uses a
 * HealingLocator with at least 2 strategies. Text-based strategies call t()
 * so selectors stay locale-correct when E2E_LOCALE is set.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-163, MINCRM-192, MINCRM-259
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by AdminSettingsPage. */
export interface AdminSettingsPageContext {
  page: PageFacade;
}

/** Valid tab keys for the Admin Settings page (MINCRM-259). */
export type AdminSettingsTab =
  | 'general'
  | 'notifications'
  | 'currency'
  | 'customisation'
  | 'data'
  | 'integrations';

// ---------------------------------------------------------------------------
// AdminSettingsPage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM admin settings screen.
 *
 * Usage:
 * ```ts
 * const adminSettings = new AdminSettingsPage({ page });
 * await adminSettings.navigate('notifications');
 * await adminSettings.toggleEmailNotifications();
 * const enabled = await adminSettings.emailNotificationsIsEnabled();
 * ```
 */
export class AdminSettingsPage {
  private readonly page: PageFacade;

  /** The URL path for this page. */
  static readonly PATH = '/admin/settings';

  /**
   * @param context - Playwright fixture context containing page.
   */
  constructor(context: AdminSettingsPageContext) {
    this.page = context.page;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigates directly to the admin settings page, optionally deep-linking to
   * a specific tab via the ?tab= URL param. This avoids viewport-dependent tab
   * interaction (desktop buttons vs mobile <select>) and works in all layouts.
   *
   * @param tab - Optional tab to land on. Defaults to 'general'.
   */
  async navigate(tab?: AdminSettingsTab): Promise<void> {
    const path = tab ? `${AdminSettingsPage.PATH}?tab=${tab}` : AdminSettingsPage.PATH;
    await this.page.goto(path);
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Returns true when the email notifications section is visible.
   */
  async emailNotificationsSectionIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate([
          { type: 'testId', value: 'email-notifications-section' },
          { type: 'text', value: t('settings.emailNotifications.sectionTitle') },
        ])
        .resolve();
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
      const resolved = await this.page
        .locate([
          { type: 'testId', value: 'email-notif-toggle' },
          { type: 'css', value: '[data-testid="email-notif-toggle"]' },
        ])
        .resolve();
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
      const resolved = await this.page
        .locate([
          { type: 'testId', value: 'email-notif-toggle' },
          { type: 'css', value: '[data-testid="email-notif-toggle"]' },
        ])
        .resolve();
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
      const resolved = await this.page
        .locate([
          { type: 'testId', value: 'email-notif-recipient-count' },
          { type: 'css', value: '[data-testid="email-notif-recipient-count"]' },
        ])
        .resolve();
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
      const resolved = await this.page
        .locate([
          { type: 'testId', value: 'email-notif-success' },
          { type: 'css', value: '[data-testid="email-notif-success"]' },
        ])
        .resolve();
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
    await this.page.click([
      { type: 'testId', value: 'email-notif-toggle' },
      { type: 'css', value: '[data-testid="email-notif-toggle"]' },
    ]);
  }
}
