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
          { type: 'css', value: '[data-testid="filters-toggle"]' },
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
          { type: 'css', value: '[data-testid="filters-toggle"]' },
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
          { intent: 'record type filter disappears after collapsing filter panel' },
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
          { type: 'css', value: '[data-testid="filter-record-type"]' },
        ],
        { intent: 'record type filter dropdown in audit log filter panel' },
      )
      .resolve();
    await select.selectOption(recordType);
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
