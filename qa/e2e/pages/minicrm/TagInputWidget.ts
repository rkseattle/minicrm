/**
 * TagInputWidget — Page Object for the TagInput component on entity detail pages.
 *
 * Covers the combobox-style tag editor rendered on contact, account, and deal
 * detail pages. Every element uses a HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-186
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by TagInputWidget. */
export interface TagInputWidgetContext {
  page: PageFacade;
}

/**
 * Page Object for the tag input component embedded on entity detail pages.
 *
 * `entityId` is the UUID of the owning record — the component renders
 * data-testid attributes as `tag-input-{entityId}`, `tag-list-{entityId}`, etc.
 */
export class TagInputWidget {
  private readonly page: PageFacade;
  private readonly entityId: string;

  /**
   * @param context - Playwright fixture context.
   * @param entityId - UUID of the owning record (contact, account, or deal).
   */
  constructor(context: TagInputWidgetContext, entityId: string) {
    this.page = context.page;
    this.entityId = entityId;
  }

  /**
   * Returns whether the tag input field is present on the page.
   */
  async isVisible(): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: `tag-input-${this.entityId}` },
            {
              type: 'role',
              value: 'combobox',
              options: { name: t('tags.inputLabel'), exact: false },
            },
          ],
          { intent: 'tag input combobox for adding tags to entity' },
        )
        .resolve();
      return el.isVisible().catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Types a tag name into the input and presses Enter to confirm.
   *
   * @param tagName - Tag name to type and confirm.
   */
  async typeAndConfirm(tagName: string): Promise<void> {
    await this.page.fill(
      tagName,
      [
        { type: 'testId', value: `tag-input-${this.entityId}` },
        { type: 'role', value: 'combobox', options: { name: t('tags.inputLabel'), exact: false } },
      ],
      { intent: 'tag input combobox for typing new tag name' },
    );
    await this.page.keyboard.press('Enter');
    // Wait for the mutation to settle before the caller reads state.
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Returns whether a tag badge with the given ID is visible in the tag list.
   *
   * @param tagId - Tag UUID.
   */
  async isBadgeVisible(tagId: string): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: `tag-badge-${tagId}` },
            { type: 'css', value: `[data-testid="tag-badge-${tagId}"]` },
          ],
          { intent: 'tag badge pill showing applied tag on entity' },
        )
        .resolve();
      return el.isVisible().catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Clicks the remove (×) button for the tag with the given ID.
   *
   * @param tagId - Tag UUID.
   */
  async removeBadge(tagId: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `remove-tag-${tagId}` },
        { type: 'css', value: `[data-testid="remove-tag-${tagId}"]` },
      ],
      { intent: 'remove button on tag badge to detach tag from entity' },
    );
    // Wait for the badge to leave the DOM — more reliable than networkidle for
    // React Query optimistic removals which can re-render before network settles.
    await this.page.doesNotExist(
      [
        { type: 'testId', value: `tag-badge-${tagId}` },
        { type: 'css', value: `[data-testid="tag-badge-${tagId}"]` },
      ],
      10_000,
    );
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
