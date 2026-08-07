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
  'notify_overdue_tasks' | 'notify_assignments' | 'notify_deal_stage_changes';

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
      .resolve(timeout)
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
    const el = await this.page
      .locate(
        [
          { type: 'testId', value: 'profile-prefs-save' },
          { type: 'role', value: 'button', options: { name: t('profile.save'), exact: false } },
        ],
        { intent: 'save button to persist notification preferences' },
      )
      .resolve();
    // force:true bypasses the setup-checklist-widget fixed overlay that can
    // intercept pointer events at the bottom-end corner on smaller viewports.
    // The button is confirmed visible and enabled by resolve(); the only blocker
    // is the fixed overlay. (MINCRM-404)
    await el.click({ force: true });
  }

  // ---------------------------------------------------------------------------
  // MFA section (MINCRM-392)
  // ---------------------------------------------------------------------------

  /**
   * Returns true when the MFA section is visible on the profile page.
   */
  async mfaSectionIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'profile-mfa-section' },
            { type: 'css', value: '[data-testid="profile-mfa-section"]' },
          ],
          { intent: 'MFA section on the profile page' },
        )
        .resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Returns the text content of the MFA status badge, or null if not visible.
   * The single badge shows "Enabled" or "Disabled" depending on MFA state.
   */
  async mfaStatusBadgeText(): Promise<string | null> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'profile-mfa-status-badge' },
            { type: 'css', value: '[data-testid="profile-mfa-status-badge"]' },
          ],
          { intent: 'MFA status badge on profile page showing Enabled or Disabled' },
        )
        .resolve();
      return resolved.textContent();
    } catch {
      return null;
    }
  }

  /**
   * Returns true when MFA is enabled (the Disable button is visible on the profile page).
   * The Disable button only renders when `mfaData.enabled === true`.
   */
  async mfaEnabledBadgeIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'profile-mfa-disable-button' },
            { type: 'css', value: '[data-testid="profile-mfa-disable-button"]' },
          ],
          { intent: 'MFA disable button — present only when MFA is enabled' },
        )
        .resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Returns true when MFA is disabled (the Enable button is visible on the profile page).
   * The Enable button only renders when `mfaData.enabled === false`.
   */
  async mfaDisabledBadgeIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'profile-mfa-enable-button' },
            { type: 'css', value: '[data-testid="profile-mfa-enable-button"]' },
          ],
          { intent: 'MFA enable button — present when MFA is disabled' },
        )
        .resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Clicks the "Enable Two-Factor Authentication" button to open the setup modal.
   */
  async clickEnableMfa(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'profile-mfa-enable-button' },
        { type: 'role', value: 'button', options: { name: /enable/i } },
      ],
      { intent: 'button to open the MFA setup modal' },
    );
  }

  /**
   * Clicks the "Disable Two-Factor Authentication" button to open the disable modal.
   */
  async clickDisableMfa(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'profile-mfa-disable-button' },
        { type: 'role', value: 'button', options: { name: /disable/i } },
      ],
      { intent: 'button to open the MFA disable confirmation modal' },
    );
  }

  /**
   * Waits for the MFA setup modal to appear, then clicks Next
   * to advance past the QR code step.
   */
  async clickMfaSetupNext(): Promise<void> {
    const nextBtn = await this.page
      .locate(
        [
          { type: 'testId', value: 'mfa-setup-next' },
          { type: 'role', value: 'button', options: { name: /next/i } },
        ],
        { intent: 'Next button in the MFA setup QR code step' },
      )
      .resolve();
    await nextBtn.waitFor({ state: 'visible' });
    await nextBtn.click();
  }

  /**
   * Fills the TOTP verification code field in the MFA setup modal's verify step.
   *
   * @param code - 6-digit TOTP code.
   */
  async fillMfaSetupCode(code: string): Promise<void> {
    await this.page.fill(
      code,
      [
        { type: 'testId', value: 'mfa-setup-code-input' },
        { type: 'role', value: 'textbox' },
      ],
      { intent: 'TOTP code input in the MFA setup verify step' },
    );
  }

  /**
   * Clicks the Verify button in the MFA setup modal.
   */
  async clickMfaSetupVerify(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'mfa-setup-verify' },
        { type: 'role', value: 'button', options: { name: /verify/i } },
      ],
      { intent: 'Verify button to complete MFA setup' },
    );
  }

  /**
   * Waits for the MFA recovery codes modal to become visible.
   */
  async waitForRecoveryCodesModal(timeout = 10_000): Promise<void> {
    await this.page
      .locate(
        [
          { type: 'testId', value: 'mfa-recovery-codes-modal' },
          { type: 'css', value: '[data-testid="mfa-recovery-codes-modal"]' },
        ],
        { intent: 'recovery codes modal shown after successful MFA setup' },
      )
      .resolve(timeout)
      .then((el) => el.waitFor({ state: 'visible', timeout }))
      .catch(() => null);
  }

  /**
   * Returns true when the MFA recovery codes modal is visible.
   */
  async recoveryCodesModalIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'mfa-recovery-codes-modal' },
            { type: 'css', value: '[data-testid="mfa-recovery-codes-modal"]' },
          ],
          { intent: 'recovery codes modal shown after successful MFA setup' },
        )
        .resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Clicks the Done/Close button on the recovery codes modal.
   */
  async closeMfaRecoveryCodesModal(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'mfa-recovery-done' },
        { type: 'role', value: 'button', options: { name: /done/i } },
      ],
      { intent: 'Done button to close the recovery codes modal' },
    );
  }

  /**
   * Fills the current password field in the MFA disable confirmation modal.
   *
   * @param password - The user's current password.
   */
  async fillMfaDisablePassword(password: string): Promise<void> {
    await this.page.fill(
      password,
      [
        { type: 'testId', value: 'mfa-disable-password-input' },
        { type: 'role', value: 'textbox' },
      ],
      { intent: 'password confirmation input in the MFA disable modal' },
    );
  }

  /**
   * Clicks the Confirm button in the MFA disable modal.
   */
  async confirmMfaDisable(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'mfa-disable-confirm' },
        { type: 'role', value: 'button', options: { name: /confirm|disable/i } },
      ],
      { intent: 'Confirm button to disable MFA' },
    );
  }

  /**
   * Waits for the MFA setup modal's QR code to finish loading (Next button enabled).
   *
   * @param timeout - Maximum ms to wait.
   */
  async waitForMfaSetupQrLoaded(timeout = 10_000): Promise<void> {
    const nextBtn = await this.page
      .locate(
        [
          { type: 'testId', value: 'mfa-setup-next' },
          { type: 'role', value: 'button', options: { name: /next/i } },
        ],
        { intent: 'Next button in the MFA setup QR code step (waiting for QR to load)' },
      )
      .resolve(timeout);
    await nextBtn.waitFor({ state: 'visible', timeout });
  }
}
