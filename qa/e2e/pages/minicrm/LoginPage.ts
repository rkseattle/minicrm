/**
 * LoginPage — Page Object for the MiniCRM login screen.
 *
 * Encapsulates all UI interactions on `/` (the login route). Every element
 * uses a HealingLocator with at least 2 strategies. Text-based strategies
 * call t() so selectors stay locale-correct when E2E_LOCALE is set.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-130
 */

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context accepted by this Page Object
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by LoginPage. */
export interface LoginPageContext {
  page: Page;
  healPage: HealPage;
  /** Current test name, passed to HealingLocator.resolve() for heal audit records. */
  testName: string;
}

// ---------------------------------------------------------------------------
// LoginPage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM login screen.
 *
 * Usage:
 * ```ts
 * const loginPage = new LoginPage({ page, healPage });
 * await loginPage.navigate();
 * await loginPage.fillEmail('admin@example.com');
 * await loginPage.fillPassword('secret');
 * await loginPage.submit();
 * ```
 */
export class LoginPage {
  private readonly page: Page;
  private readonly healPage: HealPage;
  private readonly testName: string;

  /**
   * @param context - Playwright fixture context containing page, healPage, and testName.
   */
  constructor(context: LoginPageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
    this.testName = context.testName;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigates to the login page (application root).
   */
  async navigate(): Promise<void> {
    await this.page.goto('/login');
  }

  // ---------------------------------------------------------------------------
  // Form interactions
  // ---------------------------------------------------------------------------

  /**
   * Fills the email input field.
   *
   * @param email - Email address to enter.
   */
  async fillEmail(email: string): Promise<void> {
    await this.healPage.fill(email, [
      { type: 'testId', value: 'login-email' },
      { type: 'label', value: t('login.emailLabel'), options: { exact: true } },
    ]);
  }

  /**
   * Fills the password input field.
   *
   * @param password - Password to enter.
   */
  async fillPassword(password: string): Promise<void> {
    await this.healPage.fill(password, [
      { type: 'testId', value: 'login-password' },
      { type: 'label', value: t('login.passwordLabel'), options: { exact: true } },
    ]);
  }

  /**
   * Clicks the submit button to attempt login.
   */
  async submit(): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: 'login-submit' },
      { type: 'role', value: 'button', options: { name: t('login.submitButton'), exact: true } },
    ]);
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Returns the text content of the error alert, or null if no error is shown.
   *
   * Uses HealingLocator with 2 strategies to stay consistent with the Page
   * Object contract. The alert element has no testId, so role + css are used.
   */
  async errorMessage(): Promise<string | null> {
    const locator = this.healPage.locate([
      { type: 'role', value: 'alert' },
      { type: 'css', value: '[role="alert"]' },
    ]);
    try {
      const resolved = await locator.resolve(this.testName);
      const count = await resolved.count();
      if (count === 0) return null;
      return resolved.first().textContent();
    } catch {
      // StrategyExhaustedError means no alert is present — login succeeded.
      return null;
    }
  }
}
