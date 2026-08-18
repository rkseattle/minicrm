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
 *
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context accepted by this Page Object
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by LoginPage. */
export interface LoginPageContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// LoginPage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM login screen.
 *
 * Usage:
 * ```ts
 * const loginPage = new LoginPage({ page });
 * await loginPage.navigate();
 * await loginPage.fillEmail('admin@example.com');
 * await loginPage.fillPassword('secret');
 * await loginPage.submit();
 * ```
 */
export class LoginPage {
  private readonly page: PageFacade;

  /**
   * @param context - Playwright fixture context containing page.
   */
  constructor(context: LoginPageContext) {
    this.page = context.page;
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
    await this.page.fill(
      email,
      [
        { type: 'testId', value: 'login-email' },
        { type: 'label', value: t('login.emailLabel'), options: { exact: true } },
      ],
      { intent: 'email input field on login form' },
    );
  }

  /**
   * Fills the password input field.
   *
   * @param password - Password to enter.
   */
  async fillPassword(password: string): Promise<void> {
    await this.page.fill(
      password,
      [
        { type: 'testId', value: 'login-password' },
        { type: 'label', value: t('login.passwordLabel'), options: { exact: true } },
      ],
      { intent: 'password input field on login form' },
    );
  }

  /**
   * Clicks the submit button to attempt login.
   */
  async submit(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'login-submit' },
        { type: 'role', value: 'button', options: { name: t('login.submitButton'), exact: true } },
      ],
      { intent: 'submit button to attempt login' },
    );
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
    const locator = this.page.locate(
      [
        { type: 'role', value: 'alert' },
        { type: 'css', value: '[role="alert"]' },
      ],
      { intent: 'error alert message on login form' },
    );
    try {
      const resolved = await locator.resolve();
      const count = await resolved.count();
      if (count === 0) return null;
      return resolved.textContent();
    } catch {
      // StrategyExhaustedError means no alert is present — login succeeded.
      return null;
    }
  }

  /**
   * Returns a resolved locator for the login error alert, or null if absent.
   * Used by behaviors to wait for the alert in a Promise.race with navigation.
   */
  async alertLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'role', value: 'alert' },
          { type: 'css', value: '[role="alert"]' },
        ],
        { intent: 'error alert message on login form' },
      )
      .resolve(timeout)
      .catch(() => null);
  }

  /**
   * Returns true when the session-expired banner is visible on the login page.
   * The banner appears when the page is reached via ?reason=session_expired.
   */
  async sessionExpiredBannerVisible(): Promise<boolean> {
    const locator = this.page.locate(
      [
        { type: 'testId', value: 'session-expired-banner' },
        { type: 'role', value: 'status' },
      ],
      { intent: 'session expired notice on login page' },
    );
    try {
      const resolved = await locator.resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }
}
