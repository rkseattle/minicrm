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

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context accepted by this Page Object
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by ContactsPage. */
export interface ContactsPageContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// ContactsPage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM contacts list screen.
 *
 * Usage:
 * ```ts
 * const contactsPage = new ContactsPage({ page });
 * await contactsPage.navigate();
 * const count = await contactsPage.rowCount();
 * ```
 */
export class ContactsPage {
  private readonly page: PageFacade;

  /** The URL path for this page. */
  static readonly PATH = '/contacts';

  /**
   * @param context - Playwright fixture context containing page.
   */
  constructor(context: ContactsPageContext) {
    this.page = context.page;
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
    await this.page.click(
      [
        { type: 'testId', value: 'new-contact-button' },
        { type: 'role', value: 'button', options: { name: t('common.add'), exact: false } },
      ],
      { intent: 'button to open new contact creation form' },
    );
  }

  // ---------------------------------------------------------------------------
  // State queries (read-only — no assertions here)
  // ---------------------------------------------------------------------------

  /**
   * Returns the number of contact rows visible in the list.
   * Matches both desktop table links (contact-link-{id}) and mobile card
   * links (contact-card-link-{id}) so the count is correct at any viewport.
   * Returns 0 when no contacts are listed or during a loading state.
   */
  async rowCount(): Promise<number> {
    await this.page.waitForLoadState('networkidle');
    try {
      const resolved = await this.page
        .locate(
          [
            {
              type: 'css',
              value: '[data-testid^="contact-link-"], [data-testid^="contact-card-link-"]',
            },
            {
              type: 'xpath',
              value:
                '//*[starts-with(@data-testid,"contact-link-") or starts-with(@data-testid,"contact-card-link-")]',
            },
          ],
          { intent: 'contact row links in the contacts list' },
        )
        .resolve();
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
      await this.page
        .locate(
          [
            { type: 'testId', value: 'new-contact-button' },
            { type: 'role', value: 'button', options: { name: t('common.add'), exact: false } },
          ],
          { intent: 'new contact button indicating contacts page is loaded' },
        )
        .resolve();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Waits until a specific contact row is visible in the list. Succeeds on
   * either the desktop table link (contact-link-{id}) or the mobile card link
   * (contact-card-link-{id}).
   *
   * fallbackTimeout is intentionally kept short (default 2 s) so the strategy
   * for the absent viewport variant fails quickly and the correct one resolves
   * without burning the full probe window. Both strategies are at testId
   * priority so the first in insertion order is tried first — on desktop that
   * is contact-link-{id} (instant), on mobile it falls through to
   * contact-card-link-{id} after 2 s.
   *
   * @param id - The contact UUID to wait for.
   */
  async waitForContact(id: string): Promise<void> {
    await this.page
      .locate(
        [
          { type: 'testId', value: `contact-link-${id}` },
          { type: 'testId', value: `contact-card-link-${id}` },
        ],
        { intent: 'contact row link for specific contact id' },
      )
      .resolve();
  }

  /**
   * Waits until the bulk-select checkbox for a specific contact is visible and
   * interactable. Use this before clicking a bulk-select checkbox to avoid
   * acting on stale rows during a React Query refetch.
   *
   * @param id - The contact UUID whose checkbox to wait for.
   * @param timeout - Maximum wait in ms (default 15 000).
   */
  async waitForBulkCheckbox(id: string, timeout = 15_000): Promise<void> {
    const locator = await this.page
      .locate(
        [
          { type: 'testId', value: `bulk-select-${id}` },
          { type: 'css', value: `[data-testid="bulk-select-${id}"]` },
        ],
        { fallbackTimeout: timeout, intent: 'bulk select checkbox for contact row' },
      )
      .resolve();
    await locator.waitFor({ state: 'visible', timeout });
  }

  /**
   * Clicks the bulk-select checkbox for a specific contact and waits for the
   * bulk-action-bar to appear before returning. Without this wait, the bar may
   * not yet be in the DOM when the caller's next assertion runs, causing
   * intermittent StrategyExhaustedError on testId("bulk-action-bar"). (MINCRM-211)
   *
   * @param id - The contact UUID whose checkbox to click.
   */
  async clickBulkCheckbox(id: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `bulk-select-${id}` },
        { type: 'css', value: `[data-testid="bulk-select-${id}"]` },
      ],
      { intent: 'bulk select checkbox for contact row' },
    );
    // Wait for React to flush the selection state update. The bulk-action-bar
    // appearing in the DOM is the authoritative signal that toggleRow has run.
    // waitForFunction polls until the element exists before locate().resolve(),
    // because resolve() throws StrategyExhaustedError immediately when absent.
    await this.page.waitForFunction(
      `document.querySelector('[data-testid="bulk-action-bar"]') !== null`,
      undefined,
      { timeout: 5_000 },
    );
    const bar = await this.page
      .locate(
        [
          { type: 'testId', value: 'bulk-action-bar' },
          { type: 'css', value: '[data-testid="bulk-action-bar"]' },
        ],
        { intent: 'floating action bar that appears when contacts are selected' },
      )
      .resolve();
    // 5 s matches the waitForFunction guard above — prevents 30 s default consuming
    // the full test budget on mobile where the bar may render more slowly. (MINCRM-298)
    await bar.waitFor({ state: 'visible', timeout: 5_000 });
  }

  /**
   * Types a search term into the contacts search box and waits for the debounce
   * to settle. Use this to narrow the visible rows to a known subset before
   * interacting with specific contacts.
   *
   * @param term - The string to type into the search input.
   */
  async search(term: string): Promise<void> {
    await this.page.fill(
      term,
      [
        { type: 'testId', value: 'contacts-search' },
        { type: 'css', value: '[data-testid="contacts-search"]' },
      ],
      { intent: 'contacts list search input field' },
    );
    // Wait for the debounce to fire, the request to complete, and React to
    // repopulate the list — matches the pattern used in rowCount().
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
