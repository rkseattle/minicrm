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
   * Returns true when a lead row with the given ID is visible in the list.
   *
   * @param leadId - Lead UUID.
   */
  async leadRowIsVisible(leadId: string): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: `lead-row-${leadId}` },
            { type: 'css', value: `[data-testid="lead-row-${leadId}"]` },
          ],
          { intent: 'lead row in leads list for specific lead id' },
        )
        .resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Clicks the status badge for the given lead to open the inline status selector.
   *
   * @param leadId - Lead UUID.
   */
  async clickStatusBadge(leadId: string): Promise<void> {
    // Resolve then click with force:true — the badge is inside a nested overflow-auto
    // container on mobile, causing Playwright's scroll-into-view loop to never settle.
    const badge = await this.page
      .locate(
        [
          { type: 'testId', value: `status-badge-${leadId}` },
          { type: 'css', value: `[data-testid="status-badge-${leadId}"]` },
        ],
        { intent: 'lead status badge to open inline status selector' },
      )
      .resolve();
    await badge.click({ force: true });
  }

  /**
   * Selects a new status from the inline status selector for the given lead.
   *
   * @param leadId - Lead UUID.
   * @param status - Status value to select (e.g. 'Contacted').
   */
  async selectStatus(leadId: string, status: string): Promise<void> {
    const resolved = await this.page
      .locate(
        [
          { type: 'testId', value: `status-select-${leadId}` },
          { type: 'css', value: `[data-testid="status-select-${leadId}"]` },
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
  async convertedBadgeIsVisible(leadId: string): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: `badge-converted-${leadId}` },
            { type: 'css', value: `[data-testid="badge-converted-${leadId}"]` },
          ],
          { intent: 'converted badge on lead row' },
        )
        .resolve();
      return resolved.isVisible();
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
