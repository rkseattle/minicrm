/**
 * ForgotPasswordPage — Page Object for the MiniCRM forgot-password screen.
 *
 * Encapsulates all UI interactions on `/forgot-password`. Every element uses
 * a HealingLocator with at least 2 strategies.
 *
 * MINCRM-156
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by ForgotPasswordPage. */
export interface ForgotPasswordPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM forgot-password screen.
 */
export class ForgotPasswordPage {
  /** URL path for this page. */
  static readonly PATH = '/forgot-password';

  private readonly page: PageFacade;

  constructor(context: ForgotPasswordPageContext) {
    this.page = context.page;
  }

  /**
   * Navigates to the forgot-password page.
   */
  async navigate(): Promise<void> {
    await this.page.goto(ForgotPasswordPage.PATH);
  }

  /**
   * Fills the email input field.
   *
   * @param email - Email address to enter.
   */
  async fillEmail(email: string): Promise<void> {
    await this.page.fill(
      email,
      [
        { type: 'testId', value: 'forgot-password-email' },
        { type: 'label', value: t('forgotPassword.emailLabel'), options: { exact: true } },
      ],
      { intent: 'email input on forgot password form' },
    );
  }

  /**
   * Clicks the submit button.
   */
  async submit(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'forgot-password-submit' },
        {
          type: 'role',
          value: 'button',
          options: { name: t('forgotPassword.submitButton'), exact: true },
        },
      ],
      { intent: 'submit button to request password reset email' },
    );
  }

  /**
   * Returns true when the success message is visible.
   */
  async successMessageVisible(): Promise<boolean> {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'forgot-password-success' },
          { type: 'css', value: '[data-testid="forgot-password-success"]' },
        ],
        { intent: 'success message after submitting forgot password form' },
      )
      .resolve()
      .then((el) => el.isVisible().catch(() => false))
      .catch(() => false);
  }

  /**
   * Waits for the success message to become visible.
   * Used by behaviors that need to await the confirmation before reading state.
   *
   * @param timeout - Maximum ms to wait.
   */
  async waitForSuccessVisible(timeout = 10_000): Promise<void> {
    await this.page
      .locate(
        [
          { type: 'testId', value: 'forgot-password-success' },
          { type: 'css', value: '[data-testid="forgot-password-success"]' },
        ],
        { intent: 'success message after submitting forgot password form' },
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
