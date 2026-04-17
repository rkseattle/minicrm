/**
 * ContactsPage — Page Object for the MiniCRM contacts list screen.
 *
 * Encapsulates all UI interactions on `/contacts`. Every element uses a
 * HealingLocator with at least 2 strategies. Text-based strategies call t()
 * so selectors stay locale-correct when E2E_LOCALE is set.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-130
 */

import type { SafePage } from '@framework/fixtures/index.js';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context accepted by this Page Object
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by ContactsPage. */
export interface ContactsPageContext {
  page: SafePage;
  healPage: HealPage;
  /** Current test name, passed to HealingLocator.resolve() for heal audit records. */
  testName: string;
}

// ---------------------------------------------------------------------------
// ContactsPage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM contacts list screen.
 *
 * Usage:
 * ```ts
 * const contactsPage = new ContactsPage({ page, healPage });
 * await contactsPage.navigate();
 * const count = await contactsPage.rowCount();
 * ```
 */
export class ContactsPage {
  private readonly page: SafePage;
  private readonly healPage: HealPage;
  private readonly testName: string;

  /** The URL path for this page. */
  static readonly PATH = '/contacts';

  /**
   * @param context - Playwright fixture context containing page, healPage, and testName.
   */
  constructor(context: ContactsPageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
    this.testName = context.testName;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigates directly to the contacts list URL.
   */
  async navigate(): Promise<void> {
    await this.page.goto(ContactsPage.PATH);
  }

  /**
   * Clicks the "New Contact" button to open the contact creation form.
   */
  async clickNewContact(): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: 'new-contact-button' },
      { type: 'role', value: 'button', options: { name: t('common.add'), exact: false } },
    ]);
  }

  // ---------------------------------------------------------------------------
  // State queries (read-only — no assertions here)
  // ---------------------------------------------------------------------------

  /**
   * Returns the number of contact rows visible in the table (desktop layout).
   * Returns 0 when no contacts are listed or during a loading state.
   *
   * Uses HealingLocator so any locator healing is captured in the audit log.
   */
  async rowCount(): Promise<number> {
    await this.page.waitForLoadState('networkidle');
    // contact-link-{id} rows are dynamic; css prefix-match is the primary
    // strategy. xpath is the fallback with equivalent semantics.
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'css', value: '[data-testid^="contact-link-"]' },
          { type: 'xpath', value: '//*[starts-with(@data-testid,"contact-link-")]' },
        ])
        .resolve(this.testName);
      return resolved.count();
    } catch {
      // StrategyExhaustedError means no rows are present.
      return 0;
    }
  }

  /**
   * Returns whether the contacts page is currently loaded and showing the list.
   * Checks for the presence of the "New Contact" button as the stable anchor.
   *
   * Uses HealingLocator with 2 strategies to stay consistent with the Page
   * Object contract.
   */
  async isLoaded(): Promise<boolean> {
    try {
      await this.healPage
        .locate([
          { type: 'testId', value: 'new-contact-button' },
          { type: 'role', value: 'button', options: { name: t('common.add'), exact: false } },
        ])
        .resolve(this.testName);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Waits until a specific contact row is visible in the list, identified by
   * its contact-link-{id} testId. Use this after navigating to the contacts
   * list when you need to interact with a row that was just created via API.
   *
   * @param id - The contact UUID to wait for.
   * @param timeout - Maximum wait per strategy attempt in ms (default 15 000).
   */
  async waitForContact(id: string, timeout = 15_000): Promise<void> {
    await this.healPage
      .locate(
        [
          { type: 'testId', value: `contact-link-${id}` },
          { type: 'css', value: `[data-testid="contact-link-${id}"]` },
        ],
        { fallbackTimeout: timeout },
      )
      .resolve(this.testName);
  }

  /**
   * Waits until the bulk-select checkbox for a specific contact is attached to
   * the DOM. Use this before clicking a bulk-select checkbox to avoid the 2s
   * default probe expiring during a React Query background refetch.
   *
   * @param id - The contact UUID whose checkbox to wait for.
   * @param timeout - Maximum wait in ms (default 15 000).
   */
  async waitForBulkCheckbox(id: string, timeout = 15_000): Promise<void> {
    await this.healPage
      .locate([{ type: 'testId', value: `bulk-select-${id}` }], { fallbackTimeout: timeout })
      .resolve(this.testName);
  }

  /**
   * Types a search term into the contacts search box and waits for the debounce
   * to settle. Use this to narrow the visible rows to a known subset before
   * interacting with specific contacts.
   *
   * @param term - The string to type into the search input.
   */
  async search(term: string): Promise<void> {
    await this.healPage.fill(term, [
      { type: 'testId', value: 'contacts-search' },
      { type: 'css', value: '[data-testid="contacts-search"]' },
    ]);
    // Wait for the debounce (300 ms) + one React render cycle.
    await this.page.waitForTimeout(400);
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
