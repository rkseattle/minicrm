/**
 * ProfilePage — Page Object for the MiniCRM user profile screen.
 *
 * Encapsulates all UI interactions on `/profile`. Every element uses a
 * HealingLocator with at least 2 strategies. Text-based strategies call t()
 * so selectors stay locale-correct when E2E_LOCALE is set.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-161, MINCRM-162, MINCRM-192
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by ProfilePage. */
export interface ProfilePageContext {
  page: PageFacade;
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
 * const profilePage = new ProfilePage({ page });
 * await profilePage.navigate();
 * await profilePage.uncheckPreference('notify_overdue_tasks');
 * await profilePage.savePreferences();
 * ```
 */
export class ProfilePage {
  private readonly page: PageFacade;

  /** The URL path for this page. */
  static readonly PATH = '/profile';

  /**
   * @param context - Playwright fixture context containing page.
   */
  constructor(context: ProfilePageContext) {
    this.page = context.page;
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
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'profile-heading' },
            { type: 'css', value: '[data-testid="profile-heading"]' },
          ],
          { intent: 'profile page heading indicating page is loaded' },
        )
        .resolve();
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
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'profile-notifications-section' },
            { type: 'css', value: '[data-testid="profile-notifications-section"]' },
          ],
          { intent: 'notification preferences section on profile page' },
        )
        .resolve();
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
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: `notif-checkbox-${key}` },
            { type: 'css', value: `[data-testid="notif-checkbox-${key}"]` },
          ],
          { intent: `notification preference checkbox for ${key}` },
        )
        .resolve();
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
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: `notif-checkbox-${key}` },
            { type: 'css', value: `[data-testid="notif-checkbox-${key}"]` },
          ],
          { intent: `notification preference checkbox for ${key}` },
        )
        .resolve();
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
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'profile-prefs-success' },
            { type: 'css', value: '[data-testid="profile-prefs-success"]' },
          ],
          { intent: 'success message after saving profile preferences' },
        )
        .resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Waits for the success message to become visible, then resolves.
   * Used by behaviors that need to await the save confirmation before reading state.
   *
   * @param timeout - Maximum ms to wait.
   */
  async waitForSuccessVisible(timeout = 5_000): Promise<void> {
    await this.page
      .locate(
        [
          { type: 'testId', value: 'profile-prefs-success' },
          { type: 'css', value: '[data-testid="profile-prefs-success"]' },
        ],
        { intent: 'success message after saving profile preferences' },
      )
      .resolve()
      .then((el) => el.waitFor({ state: 'visible', timeout }))
      .catch(() => null);
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
    await this.page.click(
      [
        { type: 'testId', value: `notif-checkbox-${key}` },
        { type: 'css', value: `[data-testid="notif-checkbox-${key}"]` },
      ],
      { intent: `notification preference checkbox for ${key}` },
    );
  }

  /**
   * Unchecks the checkbox for the given notification preference.
   * Does nothing if the checkbox is already unchecked.
   *
   * @param key - Notification preference key.
   */
  async uncheckPreference(key: NotificationPreferenceKey): Promise<void> {
    const resolved = await this.page
      .locate(
        [
          { type: 'testId', value: `notif-checkbox-${key}` },
          { type: 'css', value: `[data-testid="notif-checkbox-${key}"]` },
        ],
        { intent: `notification preference checkbox to uncheck for ${key}` },
      )
      .resolve();
    await resolved.uncheck();
  }

  /**
   * Checks the checkbox for the given notification preference.
   * Does nothing if the checkbox is already checked.
   *
   * @param key - Notification preference key.
   */
  async checkPreference(key: NotificationPreferenceKey): Promise<void> {
    const resolved = await this.page
      .locate(
        [
          { type: 'testId', value: `notif-checkbox-${key}` },
          { type: 'css', value: `[data-testid="notif-checkbox-${key}"]` },
        ],
        { intent: `notification preference checkbox to check for ${key}` },
      )
      .resolve();
    await resolved.check();
  }

  /**
   * Clicks the "Save" button to persist notification preferences.
   */
  async savePreferences(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'profile-prefs-save' },
        { type: 'role', value: 'button', options: { name: t('profile.save'), exact: false } },
      ],
      { intent: 'save button to persist notification preferences' },
    );
  }
}
