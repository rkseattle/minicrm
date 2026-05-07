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
   * Fills the first name field in the contact creation form.
   *
   * @param value - First name to enter.
   */
  async fillFirstName(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'contact-first-name' },
        { type: 'label', value: 'First name', options: { exact: false } },
      ],
      { intent: 'first name input in contact creation form' },
    );
  }

  /**
   * Fills the last name field in the contact creation form.
   *
   * @param value - Last name to enter.
   */
  async fillLastName(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'contact-last-name' },
        { type: 'label', value: 'Last name', options: { exact: false } },
      ],
      { intent: 'last name input in contact creation form' },
    );
  }

  /**
   * Fills the email field in the contact creation form.
   *
   * @param value - Email address to enter.
   */
  async fillEmail(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'contact-email' },
        { type: 'label', value: 'Email', options: { exact: false } },
      ],
      { intent: 'email input in contact creation form' },
    );
  }

  /**
   * Fills the phone field in the contact creation form.
   *
   * @param value - Phone number to enter.
   */
  async fillPhone(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'contact-phone' },
        { type: 'label', value: 'Phone', options: { exact: false } },
      ],
      { intent: 'phone input in contact creation form' },
    );
  }

  /**
   * Fills the title field in the contact creation form.
   *
   * @param value - Job title to enter.
   */
  async fillTitle(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'contact-title' },
        { type: 'label', value: 'Title', options: { exact: false } },
      ],
      { intent: 'title input in contact creation form' },
    );
  }

  /**
   * Fills the department field in the contact creation form.
   *
   * @param value - Department name to enter.
   */
  async fillDepartment(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'contact-department' },
        { type: 'label', value: 'Department', options: { exact: false } },
      ],
      { intent: 'department input in contact creation form' },
    );
  }

  /**
   * Submits the contact creation form.
   */
  async submitCreateForm(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'contact-form-submit' },
        { type: 'role', value: 'button', options: { name: t('contacts.save'), exact: false } },
      ],
      { intent: 'submit button to save new contact' },
    );
  }

  /**
   * Returns true when the duplicate-contact warning is visible on the create form.
   */
  async duplicateWarningIsVisible(): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: 'duplicate-contact-warning' },
            { type: 'css', value: '[data-testid="duplicate-contact-warning"]' },
          ],
          { intent: 'duplicate contact warning on creation form' },
        )
        .resolve();
      return el.isVisible().catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the contact creation form is still visible
   * (i.e. it did not close after submission).
   */
  async createFormIsVisible(): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: 'contact-form' },
            { type: 'css', value: '[data-testid="contact-form"]' },
          ],
          { intent: 'contact creation form container' },
        )
        .resolve();
      return el.isVisible().catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the contacts empty-state placeholder is visible.
   * Used after a search to determine whether no results were found.
   */
  async emptyStateIsVisible(): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: 'contacts-empty-state' },
            { type: 'text', value: t('contacts.empty') },
          ],
          { intent: 'empty state placeholder when no contacts match the search' },
        )
        .resolve();
      return el.isVisible().catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Fills the contacts list search box.
   *
   * @param term - Search term to type.
   */
  async fillSearch(term: string): Promise<void> {
    await this.page.fill(
      term,
      [
        { type: 'testId', value: 'contacts-search' },
        { type: 'label', value: 'Search', options: { exact: false } },
      ],
      { intent: 'contacts list search input field' },
    );
  }

  /**
   * Clicks the "Reassign" button in the bulk action bar.
   */
  async clickBulkReassign(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'bulk-reassign-button' },
        { type: 'css', value: '[data-testid="bulk-reassign-button"]' },
      ],
      { intent: 'reassign button in the bulk action bar' },
    );
  }

  /**
   * Clicks the Cancel button in the bulk-delete confirmation modal.
   */
  async cancelBulkDelete(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'confirm-delete-cancel' },
        { type: 'role', value: 'button', options: { name: 'Cancel', exact: false } },
      ],
      { intent: 'cancel button in the bulk delete confirmation modal' },
    );
  }

  /**
   * Clicks the Cancel button in the bulk-reassign modal.
   */
  async cancelBulkReassign(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'bulk-reassign-cancel' },
        { type: 'role', value: 'button', options: { name: 'Cancel', exact: false } },
      ],
      { intent: 'cancel button in the bulk reassign modal' },
    );
  }

  /**
   * Waits until the owner dropdown in the bulk-reassign modal is populated with
   * an option for the given owner ID, then selects it.
   *
   * @param ownerId - UUID of the owner to select.
   * @param ownerLabel - Display label of the owner option.
   */
  async selectBulkReassignOwner(ownerId: string, ownerLabel: string): Promise<void> {
    await this.page.waitForFunction(
      `document.querySelector('[data-testid="bulk-reassign-owner-select"]')?.querySelector('option[value="${ownerId}"]') !== null`,
      undefined,
      { timeout: 5_000 },
    );
    const ownerSelect = await this.page
      .locate(
        [
          { type: 'testId', value: 'bulk-reassign-owner-select' },
          { type: 'css', value: '[data-testid="bulk-reassign-owner-select"]' },
        ],
        { intent: 'owner dropdown in the bulk reassign modal' },
      )
      .resolve();
    await ownerSelect.selectOption({ label: ownerLabel });
  }

  /**
   * Clicks the Confirm button in the bulk-reassign modal.
   */
  async confirmBulkReassign(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'bulk-reassign-confirm' },
        { type: 'role', value: 'button', options: { name: /confirm|reassign/i } },
      ],
      { intent: 'confirm button in the bulk reassign modal' },
    );
  }

  /**
   * Clicks the "Delete" button in the bulk action bar.
   *
   * @param force - When true, bypasses Playwright's actionability checks.
   *   Use on desktop where the button sits inside a full-viewport overflow-auto
   *   container and the normal scroll-into-view loop does not settle.
   */
  async clickBulkDelete(force = false): Promise<void> {
    const el = await this.page
      .locate(
        [
          { type: 'testId', value: 'bulk-delete-button' },
          { type: 'role', value: 'button', options: { name: /delete/i } },
        ],
        { intent: 'delete button in the bulk action bar' },
      )
      .resolve();
    await el.waitFor({ state: 'visible', timeout: 8_000 });
    await el.click({ force });
  }

  /**
   * Clicks the Confirm button in the bulk-delete confirmation modal.
   *
   * @param force - When true, bypasses Playwright's actionability checks.
   *   Use on mobile where the modal sits inside a fixed overlay that may be
   *   partially outside the scrollable viewport.
   */
  async confirmBulkDelete(force = false): Promise<void> {
    const el = await this.page
      .locate(
        [
          { type: 'testId', value: 'confirm-delete-confirm' },
          { type: 'role', value: 'button', options: { name: /confirm|delete/i } },
        ],
        { intent: 'confirm button in the bulk delete confirmation modal' },
      )
      .resolve();
    await el.waitFor({ state: 'visible', timeout: 8_000 });
    await el.click({ force });
  }

  /**
   * Clicks the "First name" column sort header and waits for the list to settle.
   * Only available on desktop — the mobile card view has no sort headers.
   * Returns true when the sort header was found and clicked, false when absent
   * (e.g. mobile viewport where the header is not rendered).
   */
  async clickSortByName(): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: 'contacts-sort-name' },
            { type: 'role', value: 'columnheader', options: { name: /first name/i } },
          ],
          { intent: 'column header button to sort contacts by first name' },
        )
        .resolve();
      const isVisible = await el.isVisible().catch(() => false);
      if (!isVisible) return false;
      await el.click();
      await this.page.waitForLoadState('networkidle');
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
