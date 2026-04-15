/**
 * ProfilePage — Page Object for the MiniCRM user profile screen.
 *
 * Encapsulates all UI interactions on `/profile`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-161, MINCRM-162, MINCRM-192
 */

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by ProfilePage. */
export interface ProfilePageContext {
  page: Page;
  healPage: HealPage;
  /** Current test name, passed to HealingLocator.resolve() for heal audit records. */
  testName: string;
}

// ---------------------------------------------------------------------------
// Notification preference keys
// ---------------------------------------------------------------------------

/** Keys for the three notification preference checkboxes on the profile page. */
export type NotificationPreferenceKey =
  | 'notify_overdue_tasks'
  | 'notify_assignments'
  | 'notify_deal_stage_changes';

// ---------------------------------------------------------------------------
// ProfilePage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM user profile screen.
 *
 * Usage:
 * ```ts
 * const profilePage = new ProfilePage({ page, healPage, testName });
 * await profilePage.navigate();
 * await profilePage.uncheckPreference('notify_overdue_tasks');
 * await profilePage.savePreferences();
 * ```
 */
export class ProfilePage {
  private readonly page: Page;
  private readonly healPage: HealPage;
  private readonly testName: string;

  /** The URL path for this page. */
  static readonly PATH = '/profile';

  /**
   * @param context - Playwright fixture context containing page, healPage, and testName.
   */
  constructor(context: ProfilePageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
    this.testName = context.testName;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigates directly to the profile page URL.
   */
  async navigate(): Promise<void> {
    await this.page.goto(ProfilePage.PATH);
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Returns true when the profile heading is visible (page has loaded).
   */
  async isLoaded(): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: 'profile-heading' },
          { type: 'css', value: '[data-testid="profile-heading"]' },
        ])
        .resolve(this.testName);
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the notifications section is visible.
   */
  async notificationsSectionIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: 'profile-notifications-section' },
          { type: 'css', value: '[data-testid="profile-notifications-section"]' },
        ])
        .resolve(this.testName);
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the checkbox for the given notification preference is visible.
   *
   * @param key - Notification preference key.
   */
  async checkboxIsVisible(key: NotificationPreferenceKey): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: `notif-checkbox-${key}` },
          { type: 'css', value: `[data-testid="notif-checkbox-${key}"]` },
        ])
        .resolve(this.testName);
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the checkbox for the given notification preference is checked.
   *
   * @param key - Notification preference key.
   */
  async checkboxIsChecked(key: NotificationPreferenceKey): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: `notif-checkbox-${key}` },
          { type: 'css', value: `[data-testid="notif-checkbox-${key}"]` },
        ])
        .resolve(this.testName);
      return resolved.isChecked();
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the success message after saving preferences is visible.
   */
  async successMessageIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: 'profile-prefs-success' },
          { type: 'css', value: '[data-testid="profile-prefs-success"]' },
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
   * Clicks (toggles) the checkbox for the given notification preference.
   *
   * @param key - Notification preference key.
   */
  async togglePreference(key: NotificationPreferenceKey): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: `notif-checkbox-${key}` },
      { type: 'css', value: `[data-testid="notif-checkbox-${key}"]` },
    ]);
  }

  /**
   * Unchecks the checkbox for the given notification preference.
   * Does nothing if the checkbox is already unchecked.
   *
   * @param key - Notification preference key.
   */
  async uncheckPreference(key: NotificationPreferenceKey): Promise<void> {
    const resolved = await this.healPage
      .locate([
        { type: 'testId', value: `notif-checkbox-${key}` },
        { type: 'css', value: `[data-testid="notif-checkbox-${key}"]` },
      ])
      .resolve(this.testName);
    await resolved.uncheck();
  }

  /**
   * Checks the checkbox for the given notification preference.
   * Does nothing if the checkbox is already checked.
   *
   * @param key - Notification preference key.
   */
  async checkPreference(key: NotificationPreferenceKey): Promise<void> {
    const resolved = await this.healPage
      .locate([
        { type: 'testId', value: `notif-checkbox-${key}` },
        { type: 'css', value: `[data-testid="notif-checkbox-${key}"]` },
      ])
      .resolve(this.testName);
    await resolved.check();
  }

  /**
   * Clicks the "Save" button to persist notification preferences.
   */
  async savePreferences(): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: 'profile-prefs-save' },
      { type: 'role', value: 'button', options: { name: 'Save', exact: false } },
    ]);
  }
}
