/**
 * AccountsPage — Page Object for the MiniCRM accounts list screen.
 *
 * Encapsulates all UI interactions on `/accounts`. Every element uses a
 * HealingLocator with at least 2 strategies. Text-based strategies call t()
 * so selectors stay locale-correct when E2E_LOCALE is set.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-139
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context accepted by this Page Object
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by AccountsPage. */
export interface AccountsPageContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// AccountsPage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM accounts list screen.
 *
 * Usage:
 * ```ts
 * const accountsPage = new AccountsPage({ page });
 * await accountsPage.navigate();
 * const count = await accountsPage.rowCount();
 * ```
 */
export class AccountsPage {
  private readonly page: PageFacade;

  /** The URL path for this page. */
  static readonly PATH = '/accounts';

  /**
   * @param context - Playwright fixture context containing page.
   */
  constructor(context: AccountsPageContext) {
    this.page = context.page;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigates directly to the accounts list URL.
   */
  async navigate(): Promise<void> {
    await this.page.goto(AccountsPage.PATH);
  }

  /**
   * Clicks the "New Account" button to open the account creation form.
   */
  async clickNewAccount(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'new-account-button' },
        {
          type: 'role',
          value: 'button',
          options: { name: t('accounts.newAccount'), exact: false },
        },
      ],
      { intent: 'button to open new account creation form' },
    );
  }

  // ---------------------------------------------------------------------------
  // State queries (read-only — no assertions here)
  // ---------------------------------------------------------------------------

  /**
   * Returns the number of account rows visible in the table (desktop layout).
   * Returns 0 when no accounts are listed or during a loading state.
   */
  async rowCount(): Promise<number> {
    await this.page.waitForLoadState('networkidle');
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'css', value: '[data-testid^="account-link-"]' },
            { type: 'xpath', value: '//*[starts-with(@data-testid,"account-link-")]' },
          ],
          { intent: 'account row links in the accounts list' },
        )
        .resolve();
      return resolved.count();
    } catch {
      // StrategyExhaustedError means no rows are present.
      return 0;
    }
  }

  /**
   * Returns whether the accounts page is currently loaded and showing the list.
   * Checks for the presence of the "New Account" button as the stable anchor.
   */
  async isLoaded(): Promise<boolean> {
    try {
      await this.page
        .locate(
          [
            { type: 'testId', value: 'new-account-button' },
            {
              type: 'role',
              value: 'button',
              options: { name: t('accounts.newAccount'), exact: false },
            },
          ],
          { intent: 'new account button indicating accounts page is loaded' },
        )
        .resolve();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
