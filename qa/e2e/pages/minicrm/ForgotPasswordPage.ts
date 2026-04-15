/**
 * ForgotPasswordPage — Page Object for the MiniCRM forgot-password screen.
 *
 * Encapsulates all UI interactions on `/forgot-password`. Every element uses
 * a HealingLocator with at least 2 strategies.
 *
 * MINCRM-156
 */

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by ForgotPasswordPage. */
export interface ForgotPasswordPageContext {
  page: Page;
  healPage: HealPage;
  testName: string;
}

/**
 * Page Object for the MiniCRM forgot-password screen.
 */
export class ForgotPasswordPage {
  /** URL path for this page. */
  static readonly PATH = '/forgot-password';

  private readonly page: Page;
  private readonly healPage: HealPage;
  private readonly testName: string;

  constructor(context: ForgotPasswordPageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
    this.testName = context.testName;
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
    await this.healPage.fill(email, [
      { type: 'testId', value: 'forgot-password-email' },
      { type: 'label', value: t('forgotPassword.emailLabel'), options: { exact: true } },
    ]);
  }

  /**
   * Clicks the submit button.
   */
  async submit(): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: 'forgot-password-submit' },
      {
        type: 'role',
        value: 'button',
        options: { name: t('forgotPassword.submitButton'), exact: true },
      },
    ]);
  }

  /**
   * Returns true when the success message is visible.
   */
  async successMessageVisible(): Promise<boolean> {
    return this.healPage
      .locate([
        { type: 'testId', value: 'forgot-password-success' },
        { type: 'css', value: '[data-testid="forgot-password-success"]' },
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
