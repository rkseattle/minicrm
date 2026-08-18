/**
 * ResetPasswordPage — Page Object for the MiniCRM reset-password screen.
 *
 * Encapsulates all UI interactions on `/reset-password`. Every element uses
 * a HealingLocator with at least 2 strategies.
 *
 *
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by ResetPasswordPage. */
export interface ResetPasswordPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM reset-password screen.
 */
export class ResetPasswordPage {
  /** URL path for this page (without token query param). */
  static readonly PATH = '/reset-password';

  private readonly page: PageFacade;

  constructor(context: ResetPasswordPageContext) {
    this.page = context.page;
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
    await this.page.fill(
      password,
      [
        { type: 'testId', value: 'reset-password-new' },
        { type: 'label', value: t('resetPassword.newPasswordLabel'), options: { exact: true } },
      ],
      { intent: 'new password input on reset password form' },
    );
  }

  /**
   * Fills the confirm-password input field.
   *
   * @param password - Must match the value supplied to fillNewPassword().
   */
  async fillConfirmPassword(password: string): Promise<void> {
    await this.page.fill(
      password,
      [
        { type: 'testId', value: 'reset-password-confirm' },
        { type: 'label', value: t('resetPassword.confirmPasswordLabel'), options: { exact: true } },
      ],
      { intent: 'confirm password input on reset password form' },
    );
  }

  /**
   * Clicks the submit button.
   */
  async submit(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'reset-password-submit' },
        {
          type: 'role',
          value: 'button',
          options: { name: t('resetPassword.submitButton'), exact: true },
        },
      ],
      { intent: 'submit button to save new password from reset link' },
    );
  }

  /**
   * Returns the text content of the error alert, or null if no error is shown.
   */
  async errorMessage(): Promise<string | null> {
    const locator = this.page.locate(
      [
        { type: 'testId', value: 'reset-password-error' },
        { type: 'role', value: 'alert' },
      ],
      { intent: 'error alert on reset password form' },
    );
    try {
      const resolved = await locator.resolve();
      const count = await resolved.count();
      if (count === 0) return null;
      return resolved.textContent();
    } catch {
      return null;
    }
  }

  /**
   * Returns true when the invalid-token error element is visible.
   */
  async invalidTokenVisible(): Promise<boolean> {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reset-password-invalid-token' },
          { type: 'css', value: '[data-testid="reset-password-invalid-token"]' },
        ],
        { intent: 'invalid token error message on reset password page' },
      )
      .resolve()
      .then((el) => el.isVisible().catch(() => false))
      .catch(() => false);
  }

  /**
   * Waits for the error alert to become visible.
   * Used by behaviors that need to await the error before reading state.
   *
   * @param timeout - Maximum ms to wait.
   */
  async waitForErrorVisible(timeout = 10_000): Promise<void> {
    await this.page
      .locate(
        [
          { type: 'testId', value: 'reset-password-error' },
          { type: 'role', value: 'alert' },
        ],
        { intent: 'error alert on reset password form' },
      )
      .resolve(timeout)
      .then((el) => el.waitFor({ state: 'visible', timeout }))
      .catch(() => null);
  }

  /**
   * Returns the current URL.
   */
  url(): string {
    return this.page.url();
  }
}
