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
   * Fills the account name field in the account creation form.
   *
   * @param value - Account name to enter.
   */
  async fillName(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'account-name-input' },
        { type: 'label', value: 'Company name', options: { exact: false } },
      ],
      { intent: 'company name input in account creation form' },
    );
  }

  /**
   * Fills the industry field in the account creation form.
   *
   * @param value - Industry value to enter.
   */
  async fillIndustry(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'account-industry' },
        { type: 'label', value: 'Industry', options: { exact: false } },
      ],
      { intent: 'industry input in account creation form' },
    );
  }

  /**
   * Fills the website field in the account creation form.
   *
   * @param value - Website URL to enter.
   */
  async fillWebsite(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'account-website' },
        { type: 'label', value: 'Website', options: { exact: false } },
      ],
      { intent: 'website input in account creation form' },
    );
  }

  /**
   * Fills the employee range field in the account creation form.
   *
   * @param value - Employee range to enter.
   */
  async fillEmployeeRange(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'account-employee-range' },
        { type: 'label', value: 'Employee count', options: { exact: false } },
      ],
      { intent: 'employee range input in account creation form' },
    );
  }

  /**
   * Fills the revenue range field in the account creation form.
   *
   * @param value - Revenue range to enter.
   */
  async fillRevenueRange(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'account-revenue-range' },
        { type: 'label', value: 'Revenue range', options: { exact: false } },
      ],
      { intent: 'revenue range input in account creation form' },
    );
  }

  /**
   * Submits the account creation form.
   */
  async submitCreateForm(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'account-form-submit' },
        { type: 'role', value: 'button', options: { name: t('accounts.save'), exact: false } },
      ],
      { intent: 'submit button to save new account' },
    );
  }

  /**
   * Waits for the New Account button to be visible, signalling form submission success.
   *
   * @param timeout - Maximum ms to wait.
   */
  async waitForNewAccountButton(timeout = 10_000): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: 'new-account-button' },
            { type: 'css', value: '[data-testid="new-account-button"]' },
          ],
          { intent: 'new account button confirming account was created successfully' },
        )
        .resolve();
      await el.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fills the accounts list search box and waits for results to settle.
   *
   * @param term - Search term to type.
   */
  async search(term: string): Promise<void> {
    // Register before fill so we never miss the response even if the debounced
    // search fires before the next await. The predicate requires the search
    // query param to be present so the initial page-load GET is not matched.
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/accounts') &&
        response.url().includes('search=') &&
        response.request().method() === 'GET',
    );
    await this.page.fill(
      term,
      [
        { type: 'testId', value: 'accounts-search' },
        { type: 'css', value: 'input[placeholder*="company name"]' },
      ],
      {
        intent: 'accounts list search input field',
        // Allow extra time for the accounts list to mount — the page navigates
        // with waitUntil:'load' so the search input may not be attached yet
        // when the probe fires. Without this, the fallback matches the global
        // nav search bar instead. (MINCRM-418)
        fallbackTimeout: 5_000,
      },
    );
    await responsePromise;
  }

  /**
   * Fills the accounts list search box without waiting for results to settle.
   * Use search() for the full settled wait; use fillSearch() when the caller
   * handles its own wait strategy.
   *
   * @param term - Search term to type.
   */
  async fillSearch(term: string): Promise<void> {
    await this.page.fill(
      term,
      [
        { type: 'testId', value: 'accounts-search' },
        { type: 'css', value: 'input[placeholder*="company name"]' },
      ],
      { intent: 'accounts list search input field', fallbackTimeout: 5_000 },
    );
  }

  /**
   * Returns true when the accounts empty-state placeholder is visible.
   * Used after a search to determine whether no results were found.
   */
  async emptyStateIsVisible(): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: 'accounts-empty-state' },
            { type: 'text', value: t('accounts.empty') },
          ],
          { intent: 'empty state placeholder when no accounts match the search' },
        )
        .resolve();
      return el.isVisible().catch(() => false);
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
