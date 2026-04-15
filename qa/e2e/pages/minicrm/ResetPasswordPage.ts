/**
 * ResetPasswordPage — Page Object for the MiniCRM reset-password screen.
 *
 * Encapsulates all UI interactions on `/reset-password`. Every element uses
 * a HealingLocator with at least 2 strategies.
 *
 * MINCRM-157
 */

import type { SafePage } from '@framework/fixtures/index.js';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by ResetPasswordPage. */
export interface ResetPasswordPageContext {
  page: SafePage;
  healPage: HealPage;
  testName: string;
}

/**
 * Page Object for the MiniCRM reset-password screen.
 */
export class ResetPasswordPage {
  /** URL path for this page (without token query param). */
  static readonly PATH = '/reset-password';

  private readonly page: SafePage;
  private readonly healPage: HealPage;
  private readonly testName: string;

  constructor(context: ResetPasswordPageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
    this.testName = context.testName;
  }

  /**
   * Navigates to the reset-password page with the given token.
   *
   * @param token - The plaintext reset token from the email link.
   */
  async navigate(token: string): Promise<void> {
    await this.page.goto(`${ResetPasswordPage.PATH}?token=${token}`);
  }

  /**
   * Fills the new-password input field.
   *
   * @param password - The desired new password.
   */
  async fillNewPassword(password: string): Promise<void> {
    await this.healPage.fill(password, [
      { type: 'testId', value: 'reset-password-new' },
      { type: 'label', value: t('resetPassword.newPasswordLabel'), options: { exact: true } },
    ]);
  }

  /**
   * Fills the confirm-password input field.
   *
   * @param password - Must match the value supplied to fillNewPassword().
   */
  async fillConfirmPassword(password: string): Promise<void> {
    await this.healPage.fill(password, [
      { type: 'testId', value: 'reset-password-confirm' },
      { type: 'label', value: t('resetPassword.confirmPasswordLabel'), options: { exact: true } },
    ]);
  }

  /**
   * Clicks the submit button.
   */
  async submit(): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: 'reset-password-submit' },
      {
        type: 'role',
        value: 'button',
        options: { name: t('resetPassword.submitButton'), exact: true },
      },
    ]);
  }

  /**
   * Returns the text content of the error alert, or null if no error is shown.
   */
  async errorMessage(): Promise<string | null> {
    const locator = this.healPage.locate([
      { type: 'testId', value: 'reset-password-error' },
      { type: 'role', value: 'alert' },
    ]);
    try {
      const resolved = await locator.resolve(this.testName);
      const count = await resolved.count();
      if (count === 0) return null;
      return resolved.first().textContent();
    } catch {
      return null;
    }
  }

  /**
   * Returns true when the invalid-token error element is visible.
   */
  async invalidTokenVisible(): Promise<boolean> {
    return this.healPage
      .locate([
        { type: 'testId', value: 'reset-password-invalid-token' },
        { type: 'css', value: '[data-testid="reset-password-invalid-token"]' },
      ])
      .resolve(this.testName)
      .then((el) => el.isVisible().catch(() => false))
      .catch(() => false);
  }

  /**
   * Returns the current URL.
   */
  url(): string {
    return this.page.url();
  }
}
