/**
 * AdminTagsPage — Page Object for the MiniCRM admin tags management screen.
 *
 * Encapsulates all UI interactions on `/admin/tags`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-186
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by AdminTagsPage. */
export interface AdminTagsPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM admin tags management screen.
 */
export class AdminTagsPage {
  private readonly page: PageFacade;

  /** The URL path for this page. */
  static readonly PATH = '/admin/tags';

  constructor(context: AdminTagsPageContext) {
    this.page = context.page;
  }

  /**
   * Navigates directly to the admin tags management URL.
   */
  async navigate(): Promise<void> {
    await this.page.goto(AdminTagsPage.PATH);
  }

  /**
   * Returns whether the admin tags page has loaded (heading present).
   */
  async isLoaded(): Promise<boolean> {
    try {
      await this.page
        .locate(
          [
            { type: 'testId', value: 'admin-tags-heading' },
            {
              type: 'role',
              value: 'heading',
              options: { name: t('tags.pageTitle'), exact: false },
            },
          ],
          { intent: 'admin tags page heading indicating page is loaded' },
        )
        .resolve();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns whether the empty-state placeholder is visible (no tags exist).
   */
  async isEmptyStateVisible(): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: 'admin-tags-empty' },
            { type: 'text', value: t('tags.empty') },
          ],
          { intent: 'empty state message when no tags exist' },
        )
        .resolve();
      return el.isVisible().catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Returns whether the tag list container is visible.
   */
  async isTagListVisible(): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: 'admin-tags-list' },
            { type: 'css', value: '[data-testid="admin-tags-list"]' },
          ],
          { intent: 'tag list container on admin tags page' },
        )
        .resolve();
      return el.isVisible().catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Returns whether a specific tag row is visible by tag ID.
   *
   * @param tagId - Tag UUID.
   */
  async isTagRowVisible(tagId: string): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: `admin-tag-row-${tagId}` },
            { type: 'css', value: `[data-testid="admin-tag-row-${tagId}"]` },
          ],
          { intent: 'tag row in admin tags list' },
        )
        .resolve();
      return el.isVisible().catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Clicks the Rename button for a specific tag.
   *
   * @param tagId - Tag UUID.
   */
  async clickRename(tagId: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `rename-tag-${tagId}` },
        { type: 'css', value: `[data-testid="rename-tag-${tagId}"]` },
      ],
      { intent: 'rename button for tag row' },
    );
  }

  /**
   * Clears the rename input and types a new name for the given tag.
   *
   * @param tagId - Tag UUID.
   * @param newName - Replacement tag name.
   */
  async fillRenameInput(tagId: string, newName: string): Promise<void> {
    await this.page.fill(
      newName,
      [
        { type: 'testId', value: `rename-input-${tagId}` },
        { type: 'label', value: t('tags.renameInputLabel'), options: { exact: false } },
      ],
      { intent: 'rename input field for tag row' },
    );
  }

  /**
   * Clicks the Save button inside the rename form for a specific tag.
   *
   * @param tagId - Tag UUID.
   */
  async clickRenameSave(tagId: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `rename-save-${tagId}` },
        { type: 'role', value: 'button', options: { name: t('tags.save'), exact: false } },
      ],
      { intent: 'save button in tag rename form' },
    );
  }

  /**
   * Clicks the Delete button for a specific tag.
   *
   * @param tagId - Tag UUID.
   */
  async clickDelete(tagId: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `delete-tag-${tagId}` },
        { type: 'role', value: 'button', options: { name: t('tags.delete'), exact: false } },
      ],
      { intent: 'delete button for tag row' },
    );
  }

  /**
   * Returns a resolved locator for the pagination container on the tags page.
   * Throws if not found — the tags list must have more than one page of results.
   */
  async paginationLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'pagination' },
          { type: 'role', value: 'navigation', options: { name: /page/i } },
        ],
        { intent: 'pagination navigation on admin tags page' },
      )
      .resolve();
  }

  /**
   * Returns true when the rename save button for a given tag is visible.
   * Used to determine whether the rename form is still open after saving.
   *
   * @param tagId - Tag UUID.
   */
  async renameSaveButtonIsVisible(tagId: string): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: `rename-save-${tagId}` },
            { type: 'css', value: `[data-testid="rename-save-${tagId}"]` },
          ],
          { intent: 'save button in tag rename form' },
        )
        .resolve();
      return el.isVisible().catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Waits for the rename save button to become hidden (form closed), then returns true.
   * Returns false if the button is still visible after the timeout.
   * Prefer this over renameSaveButtonIsVisible for post-save assertions — it avoids
   * the race between networkidle and the mutation response on slow connections.
   *
   * @param tagId - Tag UUID.
   * @param timeout - Maximum wait in milliseconds (default 10 s).
   */
  async waitForRenameSaveGone(tagId: string, timeout = 10_000): Promise<boolean> {
    try {
      await this.page.waitFor(
        [
          { type: 'testId', value: `rename-save-${tagId}` },
          { type: 'css', value: `[data-testid="rename-save-${tagId}"]` },
        ],
        'hidden',
        { intent: 'save button hidden after successful rename' },
        timeout,
      );
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
