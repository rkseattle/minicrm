/**
 * ChangePasswordPage — Page Object for the MiniCRM change-password screen.
 *
 * Encapsulates all UI interactions on `/change-password`. Every element uses
 * a HealingLocator with at least 2 strategies. Text-based strategies call t()
 * so selectors stay locale-correct when E2E_LOCALE is set.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-137
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by ChangePasswordPage. */
export interface ChangePasswordPageContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// ChangePasswordPage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM change-password screen.
 *
 * Usage:
 * ```ts
 * const changePasswordPage = new ChangePasswordPage({ page });
 * await changePasswordPage.navigate();
 * await changePasswordPage.fillCurrentPassword('OldPass1!');
 * await changePasswordPage.fillNewPassword('NewPass2!');
 * await changePasswordPage.fillConfirmPassword('NewPass2!');
 * await changePasswordPage.submit();
 * ```
 */
export class ChangePasswordPage {
  /** URL path for this page. */
  static readonly PATH = '/change-password';

  private readonly page: PageFacade;

  /**
   * @param context - Playwright fixture context containing page.
   */
  constructor(context: ChangePasswordPageContext) {
    this.page = context.page;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigates directly to the change-password page.
   */
  async navigate(): Promise<void> {
    await this.page.goto(ChangePasswordPage.PATH);
  }

  // ---------------------------------------------------------------------------
  // Form interactions
  // ---------------------------------------------------------------------------

  /**
   * Fills the current-password input field.
   *
   * @param password - The user's current (old) password.
   */
  async fillCurrentPassword(password: string): Promise<void> {
    await this.page.fill(
      password,
      [
        { type: 'testId', value: 'change-password-current' },
        {
          type: 'label',
          value: t('changePassword.currentPasswordLabel'),
          options: { exact: true },
        },
      ],
      { intent: 'current password input on change password form' },
    );
  }

  /**
   * Fills the new-password input field.
   *
   * @param password - The desired new password.
   */
  async fillNewPassword(password: string): Promise<void> {
    await this.page.fill(
      password,
      [
        { type: 'testId', value: 'change-password-new' },
        { type: 'label', value: t('changePassword.newPasswordLabel'), options: { exact: true } },
      ],
      { intent: 'new password input on change password form' },
    );
  }

  /**
   * Fills the confirm-new-password input field.
   *
   * @param password - Must match the value supplied to fillNewPassword().
   */
  async fillConfirmPassword(password: string): Promise<void> {
    await this.page.fill(
      password,
      [
        { type: 'testId', value: 'change-password-confirm' },
        {
          type: 'label',
          value: t('changePassword.confirmPasswordLabel'),
          options: { exact: true },
        },
      ],
      { intent: 'confirm new password input on change password form' },
    );
  }

  /**
   * Clicks the submit button to attempt a password change.
   */
  async submit(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'change-password-submit' },
        {
          type: 'role',
          value: 'button',
          options: { name: t('changePassword.submitButton'), exact: true },
        },
      ],
      { intent: 'submit button to save changed password' },
    );
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Returns the text content of the error alert, or null if no error is shown.
   *
   * Uses HealingLocator with 2 strategies. The alert has no testId, so role +
   * css are used — same pattern as LoginPage.errorMessage().
   *
   * @returns Error message text, or null when no alert is present.
   */
  async errorMessage(): Promise<string | null> {
    const locator = this.page.locate(
      [
        { type: 'role', value: 'alert' },
        { type: 'css', value: '[role="alert"]' },
      ],
      { intent: 'error alert message on change password form' },
    );
    try {
      const resolved = await locator.resolve();
      const count = await resolved.count();
      if (count === 0) return null;
      return resolved.textContent();
    } catch {
      // StrategyExhaustedError means no alert is present.
      return null;
    }
  }

  /**
   * Returns true when the context banner (admin-set-password notice) is visible.
   *
   * @returns true if the banner is visible, false otherwise.
   */
  async contextBannerVisible(): Promise<boolean> {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'change-password-context-banner' },
          { type: 'css', value: '[data-testid="change-password-context-banner"]' },
        ],
        { intent: 'admin-set-password notice banner on change password page' },
      )
      .resolve()
      .then((el) => el.isVisible().catch(() => false))
      .catch(() => false);
  }

  /**
   * Returns a resolved locator for the change-password error alert, or null if absent.
   * Used by behaviors to wait for the alert in a Promise.race with navigation.
   */
  async alertLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'role', value: 'alert' },
          { type: 'css', value: '[role="alert"]' },
        ],
        { intent: 'error alert message on change password form' },
      )
      .resolve(timeout)
      .catch(() => null);
  }

  /**
   * Returns the current URL of the page.
   *
   * @returns The current page URL string.
   */
  url(): string {
    return this.page.url();
  }
}
