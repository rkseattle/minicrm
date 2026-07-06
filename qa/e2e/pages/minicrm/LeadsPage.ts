/**
 * LeadsPage — Page Object for the MiniCRM leads list screen.
 *
 * Encapsulates all UI interactions on `/leads`. Every element uses a
 * HealingLocator with at least 2 strategies. Text-based strategies call t()
 * so selectors stay locale-correct when E2E_LOCALE is set.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-192
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context accepted by this Page Object
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by LeadsPage. */
export interface LeadsPageContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// LeadsPage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM leads list screen.
 *
 * Usage:
 * ```ts
 * const leadsPage = new LeadsPage({ page });
 * await leadsPage.navigate();
 * await leadsPage.clickNew();
 * ```
 */
export class LeadsPage {
  private readonly page: PageFacade;

  /** The URL path for this page. */
  static readonly PATH = '/leads';

  /**
   * @param context - Playwright fixture context containing page.
   */
  constructor(context: LeadsPageContext) {
    this.page = context.page;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigates directly to the leads list URL.
   */
  async navigate(): Promise<void> {
    await this.page.goto(LeadsPage.PATH);
  }

  /**
   * Clicks the "Mine" owner-filter button and waits for it to settle.
   * The button is only rendered after the initial query resolves, so this
   * method guards with waitForPresent before clicking.
   */
  async filterByOwnerMe(): Promise<void> {
    await this.page.waitForPresent('[data-testid="filter-owner-mine"]');
    await this.page.click(
      [
        { type: 'testId', value: 'filter-owner-mine' },
        { type: 'role', value: 'button', options: { name: /mine/i } },
      ],
      { intent: 'owner filter button to scope leads list to current user only' },
    );
  }

  /**
   * Selects 100 rows per page from the pagination size selector so that all
   * leads are visible on a single page. Useful in tests that need to find a
   * specific lead row when the DB has accumulated rows from prior runs.
   */
  async setPageSizeToMax(): Promise<void> {
    await this.page
      .locate(
        [
          { type: 'testId', value: 'pagination-limit-select' },
          { type: 'role', value: 'combobox', options: { name: /rows per page/i } },
        ],
        { intent: 'rows-per-page selector to show more leads per page' },
      )
      .resolve()
      .then((el) => el.selectOption('100'));
  }

  // ---------------------------------------------------------------------------
  // List interactions
  // ---------------------------------------------------------------------------

  /**
   * Clicks the "New Lead" button to open the lead creation form.
   */
  async clickNew(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'new-lead-button' },
        { type: 'role', value: 'button', options: { name: t('leads.new'), exact: false } },
      ],
      { intent: 'button to open new lead creation form' },
    );
  }

  /**
   * Waits for a lead row with the given ID to become visible in the list and
   * returns true once it does; returns false if it never becomes visible
   * within the timeout. Polls rather than taking an instantaneous snapshot,
   * since this is used right after toggling a filter that must re-render the
   * list.
   *
   * @param leadId - Lead UUID.
   * @param timeout - Maximum wait in milliseconds (default 10 s).
   */
  async leadRowIsVisible(leadId: string, timeout = 10_000): Promise<boolean> {
    try {
      await this.page.waitFor(
        [
          { type: 'testId', value: `lead-row-${leadId}` },
          { type: 'css', value: `[data-testid="lead-row-${leadId}"]` },
        ],
        'visible',
        { intent: 'lead row in leads list for specific lead id' },
        timeout,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns true when a lead row with the given ID is absent or not visible
   * in the list. Never throws. Polls until hidden/absent rather than taking
   * an instantaneous snapshot — see HealMethods.isNotVisible for the
   * two-strategy false-positive guard this relies on.
   *
   * @param leadId - Lead UUID.
   * @param timeout - Maximum wait in milliseconds (default 10 s).
   */
  async leadRowIsNotVisible(leadId: string, timeout = 10_000): Promise<boolean> {
    return this.page.isNotVisible(
      [
        { type: 'testId', value: `lead-row-${leadId}` },
        { type: 'css', value: `[data-testid="lead-row-${leadId}"]` },
      ],
      timeout,
    );
  }

  /**
   * Clicks the status badge for the given lead to open the inline status selector.
   *
   * @param leadId - Lead UUID.
   */
  async clickStatusBadge(leadId: string): Promise<void> {
    const badge = await this.page
      .locate(
        [
          { type: 'testId', value: `status-badge-${leadId}` },
          { type: 'css', value: `[data-testid="status-badge-${leadId}"]` },
        ],
        { intent: 'lead status badge to open inline status selector' },
      )
      .resolve();
    // scrollIntoViewIfNeeded first so the element is in the viewport before the
    // forced click — force:true bypasses Playwright's own scroll-into-view, which
    // loops forever inside nested overflow-auto containers on mobile. Without the
    // explicit scroll the click fires on an off-screen element and React ignores it.
    await badge.scrollIntoViewIfNeeded();
    await badge.click({ force: true });
  }

  /**
   * Selects a new status from the inline status selector for the given lead.
   *
   * @param leadId - Lead UUID.
   * @param status - Status value to select (e.g. 'Contacted').
   */
  async selectStatus(leadId: string, status: string): Promise<void> {
    // The <select> is conditionally rendered only after the status badge is clicked.
    // locate().resolve() throws StrategyExhaustedError when the element is absent,
    // so use waitForFunction to poll the DOM until it appears before resolving.
    const testId = `status-select-${leadId}`;
    await this.page.waitForPresent(`[data-testid="${testId}"]`);
    const resolved = await this.page
      .locate(
        [
          { type: 'testId', value: testId },
          { type: 'css', value: `[data-testid="${testId}"]` },
        ],
        { intent: 'inline status select dropdown for lead row' },
      )
      .resolve();
    await resolved.selectOption(status);
  }

  /**
   * Returns the current text content of the status badge for the given lead.
   *
   * @param leadId - Lead UUID.
   */
  async statusBadgeText(leadId: string): Promise<string> {
    const resolved = await this.page
      .locate(
        [
          { type: 'testId', value: `status-badge-${leadId}` },
          { type: 'css', value: `[data-testid="status-badge-${leadId}"]` },
        ],
        { intent: 'lead status badge showing current status text' },
      )
      .resolve();
    return (await resolved.textContent()) ?? '';
  }

  /**
   * Waits until the status badge for the given lead displays the expected text,
   * then returns it. Avoids the one-shot textContent() race against the React
   * Query mutation re-render that updates the badge after a status change.
   *
   * @param leadId - Lead UUID.
   * @param expected - The status text to wait for (e.g. 'Contacted').
   * @param timeout - Maximum ms to wait (default 5 000).
   */
  async waitForStatusBadgeText(leadId: string, expected: string, timeout = 5_000): Promise<string> {
    const resolved = await this.page
      .locate(
        [
          { type: 'testId', value: `status-badge-${leadId}` },
          { type: 'css', value: `[data-testid="status-badge-${leadId}"]` },
        ],
        { intent: 'lead status badge to poll until expected text appears' },
      )
      .resolve();
    // Poll until the text matches — avoids snapshot racing the React re-render.
    await resolved.waitFor({ state: 'visible', timeout });
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const text = ((await resolved.textContent()) ?? '').trim();
      if (text === expected) return text;
      await resolved.page().waitForTimeout(50);
    }
    return ((await resolved.textContent()) ?? '').trim();
  }

  /**
   * Checks the "Show disqualified" toggle to reveal disqualified leads in the list.
   */
  async showDisqualified(): Promise<void> {
    const resolved = await this.page
      .locate(
        [
          { type: 'testId', value: 'toggle-disqualified' },
          {
            type: 'role',
            value: 'checkbox',
            options: { name: t('leads.showDisqualified'), exact: false },
          },
        ],
        { intent: 'toggle to show disqualified leads in the list' },
      )
      .resolve();
    await resolved.check();
  }

  /**
   * Checks the "Show converted" toggle to reveal converted leads in the list.
   */
  async showConverted(): Promise<void> {
    const resolved = await this.page
      .locate(
        [
          { type: 'testId', value: 'toggle-converted' },
          {
            type: 'role',
            value: 'checkbox',
            options: { name: t('leads.showConverted'), exact: false },
          },
        ],
        { intent: 'toggle to show converted leads in the list' },
      )
      .resolve();
    await resolved.check();
  }

  /**
   * Returns true when the "converted" badge is visible for the given lead.
   *
   * @param leadId - Lead UUID.
   */
  async convertedBadgeIsVisible(leadId: string, timeout = 10_000): Promise<boolean> {
    try {
      await this.page.waitFor(
        [
          { type: 'testId', value: `badge-converted-${leadId}` },
          { type: 'css', value: `[data-testid="badge-converted-${leadId}"]` },
        ],
        'visible',
        { intent: 'converted badge on lead row' },
        timeout,
      );
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Create form (inline on list page)
  // ---------------------------------------------------------------------------

  /**
   * Fills the lead first name field.
   *
   * @param value - First name to enter.
   */
  async fillFirstName(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'lead-first-name' },
        { type: 'label', value: 'First name', options: { exact: false } },
      ],
      { intent: 'lead first name input in create form' },
    );
  }

  /**
   * Fills the lead last name field.
   *
   * @param value - Last name to enter.
   */
  async fillLastName(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'lead-last-name' },
        { type: 'label', value: 'Last name', options: { exact: false } },
      ],
      { intent: 'lead last name input in create form' },
    );
  }

  /**
   * Fills the lead email field.
   *
   * @param value - Email address to enter.
   */
  async fillEmail(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'lead-email' },
        { type: 'label', value: 'Email', options: { exact: false } },
      ],
      { intent: 'lead email input in create form' },
    );
  }

  /**
   * Fills the lead phone field.
   *
   * @param value - Phone number to enter.
   */
  async fillPhone(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'lead-phone' },
        { type: 'label', value: 'Phone', options: { exact: false } },
      ],
      { intent: 'lead phone input in create form' },
    );
  }

  /**
   * Fills the lead company name field.
   *
   * @param value - Company name to enter.
   */
  async fillCompanyName(value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: 'lead-company-name' },
        { type: 'label', value: 'Company', options: { exact: false } },
      ],
      { intent: 'lead company name input in create form' },
    );
  }

  /**
   * Submits the lead creation form.
   */
  async submitForm(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'lead-form-submit' },
        { type: 'role', value: 'button', options: { name: t('leads.save'), exact: false } },
      ],
      { intent: 'submit button to save new lead' },
    );
  }

  /**
   * Returns true when the lead creation form is currently visible.
   */
  async formIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'lead-form' },
            { type: 'css', value: '[data-testid="lead-form"]' },
          ],
          { intent: 'lead creation form container' },
        )
        .resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /** Waits until the lead creation form is no longer visible (hidden or detached). */
  async waitForFormHidden(timeout = 15_000): Promise<void> {
    // First ensure the form is in the DOM — prevents a false-positive where
    // waitForFunction resolves immediately during a transient React reconciliation
    // gap before the form has mounted. Then wait for it to be removed.
    await this.page.waitForPresent('[data-testid="lead-form"]', 5_000).catch(() => null);
    await this.page.waitForAbsent('[data-testid="lead-form"]', timeout);
  }

  /** Waits until the duplicate lead warning becomes visible. */
  async waitForDuplicateWarning(timeout = 15_000): Promise<void> {
    await this.page.waitForFunction(
      `!!document.querySelector('[data-testid="duplicate-lead-warning"]')`,
      undefined,
      { timeout },
    );
  }

  /**
   * Returns true when the duplicate lead warning is visible.
   */
  async duplicateWarningIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'duplicate-lead-warning' },
            { type: 'css', value: '[data-testid="duplicate-lead-warning"]' },
          ],
          { intent: 'duplicate lead warning message' },
        )
        .resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Clicks "Create anyway" to proceed past the duplicate lead warning.
   */
  async clickCreateAnyway(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'duplicate-create-anyway' },
        { type: 'role', value: 'button', options: { name: t('leads.createAnyway'), exact: false } },
      ],
      { intent: 'create anyway button to bypass duplicate warning' },
    );
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
