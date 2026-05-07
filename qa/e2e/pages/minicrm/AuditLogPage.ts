/**
 * AuditLogPage — Page Object for the MiniCRM admin audit log screen.
 *
 * Encapsulates all UI interactions on `/admin/audit-log`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-201, MINCRM-344
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by AuditLogPage. */
export interface AuditLogPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM admin audit log screen.
 */
export class AuditLogPage {
  private readonly page: PageFacade;

  static readonly PATH = '/admin/audit-log';

  constructor(context: AuditLogPageContext) {
    this.page = context.page;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  async navigate(): Promise<void> {
    await this.page.goto(AuditLogPage.PATH);
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  /**
   * Expands the filter panel if it is currently collapsed.
   * On mobile the panel starts collapsed; on desktop it starts expanded.
   * Calling this before any filter interaction makes tests viewport-agnostic.
   */
  async expandFilters(): Promise<void> {
    const toggle = await this.page
      .locate(
        [
          { type: 'testId', value: 'filters-toggle' },
          { type: 'role', value: 'button', options: { name: /filter/i } },
        ],
        { intent: 'button to expand or collapse the audit log filter panel' },
      )
      .resolve();
    const expanded = await toggle.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await toggle.click();
      // Wait for filter fields to become visible before returning
      const filterField = await this.page
        .locate(
          [
            { type: 'testId', value: 'filter-record-type' },
            { type: 'css', value: '[data-testid="filter-record-type"]' },
          ],
          { intent: 'record type filter select after expanding filter panel' },
        )
        .resolve();
      await filterField.waitFor({ state: 'visible' });
    }
  }

  /**
   * Collapses the filter panel if it is currently expanded.
   * Call this before clicking data rows on mobile — the expanded filter body
   * overlaps the row area and intercepts pointer events.
   */
  async collapseFilters(): Promise<void> {
    const toggle = await this.page
      .locate(
        [
          { type: 'testId', value: 'filters-toggle' },
          { type: 'role', value: 'button', options: { name: /filter/i } },
        ],
        { intent: 'button to expand or collapse the audit log filter panel' },
      )
      .resolve();
    const expanded = await toggle.getAttribute('aria-expanded');
    if (expanded === 'true') {
      await toggle.click();
      // page.waitFor('hidden') calls resolveLocator first, which throws
      // StrategyExhaustedError when the element is absent — but absent IS hidden,
      // so we treat that error as success.
      await this.page
        .waitFor(
          [
            { type: 'testId', value: 'filter-record-type' },
            { type: 'css', value: '[data-testid="filter-record-type"]' },
          ],
          'hidden',
          { intent: 'record type filter dropdown hidden after collapse' },
        )
        .catch(() => null);
    }
  }

  /**
   * Selects a record type in the filter dropdown.
   *
   * @param recordType - The value to select (e.g. 'contact', 'account', 'deal').
   */
  async selectFilterRecordType(recordType: string): Promise<void> {
    const select = await this.page
      .locate(
        [
          { type: 'testId', value: 'filter-record-type' },
          { type: 'role', value: 'combobox', options: { name: /record type/i } },
        ],
        { intent: 'record type filter dropdown in audit log filter panel' },
      )
      .resolve();
    await select.selectOption(recordType);
  }

  /**
   * Returns a resolved locator for the audit log page heading.
   */
  async headingLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'audit-log-heading' },
          { type: 'role', value: 'heading', options: { name: /audit log/i } },
        ],
        { intent: 'audit log page heading' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the audit log entry list.
   */
  async listLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'audit-log-list' },
          { type: 'role', value: 'list' },
        ],
        { intent: 'audit log entry list container' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the pagination navigation.
   * Returns null if pagination is not present.
   */
  async paginationLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'pagination' },
          { type: 'role', value: 'navigation', options: { name: /page/i } },
        ],
        { intent: 'pagination navigation on audit log page' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the "previous page" pagination button.
   */
  async paginationPrevLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'pagination-prev' },
          { type: 'role', value: 'button', options: { name: /prev|previous/i } },
        ],
        { intent: 'previous page button in audit log pagination' },
      )
      .resolve();
  }

  /**
   * Clicks the Apply Filters button to submit the current filter values.
   */
  async applyFilters(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'apply-filters-button' },
        { type: 'role', value: 'button', options: { name: /apply/i } },
      ],
      { intent: 'apply filters button to submit audit log filter form' },
    );
  }
}
