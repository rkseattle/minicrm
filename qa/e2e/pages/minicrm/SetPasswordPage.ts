/**
 * SetPasswordPage — Page Object for the MiniCRM set-password screen.
 *
 * Encapsulates all UI interactions on `/set-password`. Every element uses
 * a HealingLocator with at least 2 strategies.
 *
 * MINCRM-262
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by SetPasswordPage. */
export interface SetPasswordPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM set-password screen.
 */
export class SetPasswordPage {
  /** URL path for this page (without token query param). */
  static readonly PATH = '/set-password';

  private readonly page: PageFacade;

  constructor(context: SetPasswordPageContext) {
    this.page = context.page;
  }

  /**
   * Navigates to the set-password page with the given invite token.
   *
   * @param token - The plaintext invite token from the email link.
   */
  async navigate(token: string): Promise<void> {
    await this.page.goto(`${SetPasswordPage.PATH}?token=${token}`);
  }

  /**
   * Fills the password input field.
   *
   * @param password - The desired password.
   */
  async fillNewPassword(password: string): Promise<void> {
    await this.page.fill(
      password,
      [
        { type: 'testId', value: 'set-password-new' },
        { type: 'label', value: t('setPassword.newPasswordLabel'), options: { exact: true } },
      ],
      { intent: 'new password input on set password form' },
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
        { type: 'testId', value: 'set-password-confirm' },
        { type: 'label', value: t('setPassword.confirmPasswordLabel'), options: { exact: true } },
      ],
      { intent: 'confirm password input on set password form' },
    );
  }

  /**
   * Clicks the submit button.
   */
  async submit(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'set-password-submit' },
        {
          type: 'role',
          value: 'button',
          options: { name: t('setPassword.submitButton'), exact: true },
        },
      ],
      { intent: 'submit button to activate account with new password' },
    );
  }

  /**
   * Returns the text content of the error alert, or null if no error is shown.
   */
  async errorMessage(): Promise<string | null> {
    const locator = this.page.locate(
      [
        { type: 'testId', value: 'set-password-error' },
        { type: 'role', value: 'alert' },
      ],
      { intent: 'error alert on set password form' },
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
          { type: 'testId', value: 'set-password-invalid-token' },
          { type: 'css', value: '[data-testid="set-password-invalid-token"]' },
        ],
        { intent: 'invalid token error message on set password page' },
      )
      .resolve()
      .then((el) => el.isVisible().catch(() => false))
      .catch(() => false);
  }

  /**
   * Returns true when the already-activated message is visible.
   */
  async alreadyActivatedVisible(): Promise<boolean> {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'set-password-already-activated' },
          { type: 'css', value: '[data-testid="set-password-already-activated"]' },
        ],
        { intent: 'already activated message on set password page' },
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
          { type: 'testId', value: 'set-password-error' },
          { type: 'role', value: 'alert' },
        ],
        { intent: 'error alert on set password form' },
      )
      .resolve()
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
