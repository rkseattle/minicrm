/**
 * DataHygienePage — Page Object for the MiniCRM data hygiene assistant queue.
 * (MINCRM-476)
 *
 * Encapsulates all UI interactions on both `/hygiene` (personal queue) and
 * `/admin/hygiene` (org-wide admin queue) — the two routes render the same
 * component with a different `scope` prop. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by DataHygienePage. */
export interface DataHygienePageContext {
  page: PageFacade;
}

export class DataHygienePage {
  private readonly page: PageFacade;

  static readonly PERSONAL_PATH = '/hygiene';
  static readonly ADMIN_PATH = '/admin/hygiene';

  constructor(context: DataHygienePageContext) {
    this.page = context.page;
  }

  /** Navigates to the personal (scope=mine) hygiene queue. */
  async navigatePersonal(): Promise<void> {
    await this.page.goto(DataHygienePage.PERSONAL_PATH);
  }

  /** Navigates to the org-wide (scope=all) admin hygiene queue. */
  async navigateAdmin(): Promise<void> {
    await this.page.goto(DataHygienePage.ADMIN_PATH);
  }

  /** Returns a resolved locator for the page heading. */
  async headingLocator() {
    // eslint-disable-next-line local/require-locator-fallback -- role:heading is unscoped and matches every heading on the page
    return this.page
      .locate([{ type: 'testId', value: 'data-hygiene-heading' }], {
        intent: 'data hygiene queue page main heading',
      })
      .resolve();
  }

  /** Returns a resolved locator for the findings list container. */
  async findingsListLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'data-hygiene-list' },
          { type: 'css', value: '[data-testid="data-hygiene-list"]' },
        ],
        { intent: 'list of current data hygiene findings' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the empty-state message. */
  async emptyStateLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'data-hygiene-empty' },
          { type: 'css', value: '[data-testid="data-hygiene-empty"]' },
        ],
        { intent: 'empty state shown when there are no current hygiene findings' },
      )
      .resolve();
  }

  /**
   * Returns true once at least one finding row is visible in the list,
   * polling up to `timeout`. Never throws.
   */
  async hasAtLeastOneFinding(timeout = 10_000): Promise<boolean> {
    try {
      await this.page.waitForPresent('[data-testid="data-hygiene-list"] li', timeout);
      return true;
    } catch {
      return false;
    }
  }

  /** Clicks the Dismiss action for a specific finding row. */
  async clickDismiss(findingId: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `data-hygiene-dismiss-${findingId}` },
        { type: 'css', value: `[data-testid="data-hygiene-dismiss-${findingId}"]` },
      ],
      { intent: 'dismiss button for a specific data hygiene finding row' },
    );
  }

  /** Fills the dismiss dialog's reason textarea. */
  async fillDismissReason(reason: string): Promise<void> {
    await this.page.fill(
      reason,
      [
        { type: 'testId', value: 'data-hygiene-dismiss-reason-input' },
        { type: 'css', value: '[data-testid="data-hygiene-dismiss-reason-input"]' },
      ],
      { intent: 'reason textarea inside the dismiss finding confirmation dialog' },
    );
  }

  /** Clicks the Confirm button inside the dismiss dialog. */
  async clickDismissConfirm(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'data-hygiene-dismiss-confirm' },
        { type: 'role', value: 'button', options: { name: /dismiss/i } },
      ],
      { intent: 'confirm button inside the dismiss finding dialog' },
    );
  }

  /** Returns true when the dismiss dialog is currently visible. */
  async isDismissDialogVisible(): Promise<boolean> {
    try {
      const resolved = await this.page
        .locate(
          [
            { type: 'testId', value: 'data-hygiene-dismiss-dialog' },
            { type: 'role', value: 'dialog' },
          ],
          { intent: 'dismiss finding confirmation dialog' },
        )
        .resolve();
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /** Waits until the dismiss dialog is no longer present in the DOM. */
  async waitForDismissDialogClosed(timeout = 10_000): Promise<void> {
    await this.page.waitForAbsent('[data-testid="data-hygiene-dismiss-dialog"]', timeout);
  }

  /** Waits until a specific finding row is no longer present in the DOM. */
  async waitForFindingAbsent(findingId: string, timeout = 10_000): Promise<void> {
    await this.page.waitForAbsent(`[data-testid="data-hygiene-finding-${findingId}"]`, timeout);
  }
}
