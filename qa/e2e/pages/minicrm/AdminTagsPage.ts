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

import type { SafePage } from '@framework/fixtures/index.js';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by AdminTagsPage. */
export interface AdminTagsPageContext {
  page: SafePage;
  healPage: HealPage;
  testName: string;
}

/**
 * Page Object for the MiniCRM admin tags management screen.
 */
export class AdminTagsPage {
  private readonly page: SafePage;
  private readonly healPage: HealPage;
  private readonly testName: string;

  /** The URL path for this page. */
  static readonly PATH = '/admin/tags';

  constructor(context: AdminTagsPageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
    this.testName = context.testName;
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
      await this.healPage
        .locate([
          { type: 'testId', value: 'admin-tags-heading' },
          { type: 'role', value: 'heading', options: { name: t('tags.pageTitle'), exact: false } },
        ])
        .resolve(this.testName);
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
      const el = await this.healPage
        .locate([
          { type: 'testId', value: 'admin-tags-empty' },
          { type: 'text', value: t('tags.empty') },
        ])
        .resolve(this.testName);
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
      const el = await this.healPage
        .locate([
          { type: 'testId', value: 'admin-tags-list' },
          { type: 'css', value: '[data-testid="admin-tags-list"]' },
        ])
        .resolve(this.testName);
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
      const el = await this.healPage
        .locate([
          { type: 'testId', value: `admin-tag-row-${tagId}` },
          { type: 'css', value: `[data-testid="admin-tag-row-${tagId}"]` },
        ])
        .resolve(this.testName);
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
    await this.healPage.click([
      { type: 'testId', value: `rename-tag-${tagId}` },
      { type: 'css', value: `[data-testid="rename-tag-${tagId}"]` },
    ]);
  }

  /**
   * Clears the rename input and types a new name for the given tag.
   *
   * @param tagId - Tag UUID.
   * @param newName - Replacement tag name.
   */
  async fillRenameInput(tagId: string, newName: string): Promise<void> {
    await this.healPage.fill(newName, [
      { type: 'testId', value: `rename-input-${tagId}` },
      { type: 'label', value: t('tags.renameInputLabel'), options: { exact: false } },
    ]);
  }

  /**
   * Clicks the Save button inside the rename form for a specific tag.
   *
   * @param tagId - Tag UUID.
   */
  async clickRenameSave(tagId: string): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: `rename-save-${tagId}` },
      { type: 'role', value: 'button', options: { name: t('tags.save'), exact: false } },
    ]);
  }

  /**
   * Clicks the Delete button for a specific tag.
   *
   * @param tagId - Tag UUID.
   */
  async clickDelete(tagId: string): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: `delete-tag-${tagId}` },
      { type: 'role', value: 'button', options: { name: t('tags.delete'), exact: false } },
    ]);
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
