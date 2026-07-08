/**
 * DealsPage — Page Object for the MiniCRM deals list/board screen.
 *
 * Encapsulates all UI interactions on `/deals`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-601
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by DealsPage. */
export interface DealsPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM deals list/board screen.
 */
export class DealsPage {
  private readonly page: PageFacade;

  static readonly PATH = '/deals';

  constructor(context: DealsPageContext) {
    this.page = context.page;
  }

  async navigate(): Promise<void> {
    await this.page.goto(DealsPage.PATH);
  }

  /** Returns a resolved locator for the Export menu trigger button. (MINCRM-652) */
  async exportMenuTriggerLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deals-export-menu-button' },
          { type: 'role', value: 'button', options: { name: /export/i } },
        ],
        { intent: 'trigger button that opens the deals export menu' },
      )
      .resolve();
  }

  /** Opens the Export menu, revealing the CSV/PDF/Export All items. (MINCRM-652) */
  async openExportMenu(): Promise<void> {
    const trigger = await this.exportMenuTriggerLocator();
    await trigger.click();
  }

  /** Returns a resolved locator for the Export CSV button. */
  async exportCsvButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deals-export-csv-button' },
          { type: 'role', value: 'button', options: { name: /export csv/i } },
        ],
        { intent: 'button to export the filtered deals list as CSV' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the Export PDF button. */
  async exportPdfButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deals-export-pdf-button' },
          { type: 'role', value: 'button', options: { name: /export pdf/i } },
        ],
        { intent: 'button to export the filtered deals list as PDF' },
      )
      .resolve();
  }
}
