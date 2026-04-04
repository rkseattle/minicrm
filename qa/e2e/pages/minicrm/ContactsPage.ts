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

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context accepted by this Page Object
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by ContactsPage. */
export interface ContactsPageContext {
  page: Page;
  healPage: HealPage;
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
  private readonly page: Page;
  private readonly healPage: HealPage;

  /** The URL path for this page. */
  static readonly PATH = '/contacts';

  /**
   * @param context - Playwright fixture context containing page and healPage.
   */
  constructor(context: ContactsPageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
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
   */
  async rowCount(): Promise<number> {
    // Wait for the page to settle — look for either a contact link or an empty state.
    await this.page.waitForLoadState('networkidle');
    return this.page.locator('[data-testid^="contact-link-"]').count();
  }

  /**
   * Returns whether the contacts page is currently loaded and showing the list.
   * Checks for the presence of the "New Contact" button as the stable anchor.
   */
  async isLoaded(): Promise<boolean> {
    const btn = this.page.getByTestId('new-contact-button');
    try {
      await btn.waitFor({ state: 'attached', timeout: 5_000 });
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
