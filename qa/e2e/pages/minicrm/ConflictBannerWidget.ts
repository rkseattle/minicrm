/**
 * ConflictBannerWidget — Page Object for the FieldMergeModal conflict resolution UI.
 *
 * Surfaces when a PATCH returns 409 OPTIMISTIC_LOCK_CONFLICT and the client
 * opens the three-way merge dialog (MINCRM-351). Named "ConflictBannerWidget"
 * per the MINCRM-350 spec even though the underlying component is FieldMergeModal.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-350
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by ConflictBannerWidget. */
export interface ConflictBannerWidgetContext {
  page: PageFacade;
}

/**
 * Page Object for the conflict resolution modal shown on optimistic lock conflicts.
 */
export class ConflictBannerWidget {
  private readonly page: PageFacade;

  constructor(context: ConflictBannerWidgetContext) {
    this.page = context.page;
  }

  /**
   * Returns a resolved locator for the modal container.
   * Throws StrategyExhaustedError if the modal is not present.
   */
  async modalLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'field-merge-modal' },
          { type: 'role', value: 'dialog', options: { name: /conflict|merge/i } },
        ],
        { intent: 'conflict resolution merge modal dialog' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the modal title heading.
   * Throws StrategyExhaustedError if the modal is not open.
   */
  async titleLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'field-merge-modal-title' },
          { type: 'role', value: 'heading', options: { level: 2 } },
        ],
        { intent: 'title heading inside the conflict resolution modal' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the "Save resolved" button.
   */
  async saveResolvedButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'field-merge-save-button' },
          { type: 'role', value: 'button', options: { name: /save resolved/i } },
        ],
        { intent: 'save resolved button to confirm conflict resolution choices' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the "Discard my changes" button.
   */
  async discardButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'field-merge-discard-button' },
          { type: 'role', value: 'button', options: { name: /discard/i } },
        ],
        { intent: 'discard button to abandon pending changes and accept server state' },
      )
      .resolve();
  }

  /**
   * Clicks the "Save resolved" button.
   */
  async clickSaveResolved(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'field-merge-save-button' },
        { type: 'role', value: 'button', options: { name: /save resolved/i } },
      ],
      { intent: 'save resolved button to confirm conflict resolution choices' },
    );
  }

  /**
   * Clicks the "Discard my changes" button.
   */
  async clickDiscard(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'field-merge-discard-button' },
        { type: 'role', value: 'button', options: { name: /discard/i } },
      ],
      { intent: 'discard button to abandon pending changes and accept server state' },
    );
  }

  /**
   * Selects "Keep theirs" for the given field in the conflict table.
   *
   * @param fieldKey - The field key (e.g. 'first_name') as used in the merge table row.
   */
  async selectTheirs(fieldKey: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `field-merge-radio-${fieldKey}-theirs` },
        {
          type: 'css',
          value: `[data-testid="field-merge-radio-${fieldKey}-theirs"]`,
        },
      ],
      { intent: `keep theirs radio button for field ${fieldKey} in conflict table` },
    );
  }

  /**
   * Selects "Keep mine" for the given field in the conflict table.
   *
   * @param fieldKey - The field key (e.g. 'first_name') as used in the merge table row.
   */
  async selectMine(fieldKey: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `field-merge-radio-${fieldKey}-mine` },
        {
          type: 'css',
          value: `[data-testid="field-merge-radio-${fieldKey}-mine"]`,
        },
      ],
      { intent: `keep mine radio button for field ${fieldKey} in conflict table` },
    );
  }

  /**
   * Returns whether the modal is currently visible.
   */
  async isVisible(): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: 'field-merge-modal' },
            { type: 'role', value: 'dialog', options: { name: /conflict|merge/i } },
          ],
          { intent: 'conflict resolution merge modal dialog' },
        )
        .resolve();
      return el.isVisible().catch(() => false);
    } catch {
      return false;
    }
  }
}
