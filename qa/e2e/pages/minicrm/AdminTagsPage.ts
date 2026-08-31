/**
 * AdminTagsPage — Page Object for tag management within the Pipelines & Fields
 * settings tab. The standalone /admin/tags route was absorbed into
 * /admin/settings?tab=pipelines; /admin/tags now redirects there.
 *
 * Encapsulates all UI interactions on the tags section of the Pipelines & Fields
 * tab. Every element uses a HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 *
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by AdminTagsPage. */
export interface AdminTagsPageContext {
  page: PageFacade;
}

/**
 * Page Object for tag management embedded in the Pipelines & Fields settings tab.
 */
export class AdminTagsPage {
  private readonly page: PageFacade;

  /**
   * The canonical URL path for tag management.
   * /admin/tags redirects here via a client-side Navigate component.
   */
  static readonly PATH = '/admin/settings?tab=pipelines';

  constructor(context: AdminTagsPageContext) {
    this.page = context.page;
  }

  /**
   * Navigates to the Pipelines & Fields settings tab where tags are managed.
   */
  async navigate(): Promise<void> {
    await this.page.goto(AdminTagsPage.PATH);
  }

  /**
   * Returns whether the tags section has finished loading its tag list (not
   * just the feature flag).
   *
   * Previously checked `tags-section-title`, which is WRONG: that heading is
   * gated only on the `tags` feature flag's own `flagLoading` state
   * (PipelinesAndFieldsSettings.tsx), so it renders as soon as the flag
   * resolves — before the tags list's own `useQuery` has settled.
   *
   * A later fix (still wrong, same bug class) waited for `admin-tags-loading`
   * to be ABSENT from the DOM. That is a false-positive trap: while
   * `useFeatureFlag('tags')` itself is still resolving (flagLoading === true),
   * TagManagementSection renders an early-return skeleton
   * (PipelinesAndFieldsSettings.tsx ~line 155) that contains NEITHER
   * `admin-tags-loading` NOR `admin-tags-list`/`pagination` — so the
   * "is admin-tags-loading absent" query is trivially true before the tags
   * list's own useQuery has even been created, let alone resolved. Under CI
   * contention, withFlags()'s route.fetch() round-trip for
   * GET /api/v1/feature-flags/me is slow enough that isLoaded() returns
   * true during this skeleton phase, and callers (e.g.
   * expectAdminTagsPaginationVisible) then look for `pagination` before it
   * has ever mounted — this was the actual root cause of the F8-TG1b
   * StrategyExhaustedError on testId("pagination"), not locator resolution
   * speed.
   *
   * Fixed to wait for a POSITIVE presence signal that only exists once the
   * real (non-skeleton, non-loading) content has rendered — `admin-tags-list`
   * (populated case) or `admin-tags-empty-state` (empty case) — matching the
   * pattern used by ContactsPage.isLoaded() (waits for `contacts-search`,
   * not for a loading indicator's absence).
   */
  async isLoaded(): Promise<boolean> {
    try {
      await this.page.waitForFunction(
        `document.querySelector('[data-testid="admin-tags-list"]') !== null ||
         document.querySelector('[data-testid="admin-tags-empty-state"]') !== null`,
        undefined,
        { timeout: 8_000 },
      );
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
            { type: 'testId', value: 'admin-tags-empty-state' },
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
   * Role fallback scoped to this tag's own row (`within`) — the Pipelines &
   * Fields settings page renders THREE "Save" buttons under the `tags.save`
   * label (the new-tag creation form, twice for its pending/idle text
   * variants, plus this rename-save button), so an unscoped
   * `role('button', {name: 'Save'})` fallback would ambiguously match more
   * than one of them in strict mode (same bug class as clickDelete's own
   * fix — see that method's docblock).
   *
   * @param tagId - Tag UUID.
   */
  async clickRenameSave(tagId: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `rename-save-${tagId}` },
        {
          type: 'role',
          value: 'button',
          options: { name: t('tags.save'), exact: false },
          within: `admin-tag-row-${tagId}`,
        },
      ],
      { intent: 'save button in tag rename form' },
    );
  }

  /**
   * Clicks the Delete button for a specific tag.
   *
   * Role fallback scoped to this tag's own row (`within: admin-tag-row-
   * ${tagId}`) — the Pipelines & Fields settings page co-renders
   * CustomisationSettings' pipeline-stage delete buttons (each also labeled
   * "Delete") alongside TagManagementSection on the SAME page. An unscoped
   * `role('button', {name: 'Delete'})` fallback is therefore always
   * ambiguous whenever any pipeline stages exist (seed data guarantees they
   * do) — under CI contention, if the primary testId probe is slow enough
   * to exhaust its fallback window, HealingLocator falls through to this
   * role strategy and throws a strict-mode violation matching every
   * pipeline-stage delete button too (found via CI failure investigation,
   * follow-up).
   *
   * @param tagId - Tag UUID.
   */
  async clickDelete(tagId: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `delete-tag-${tagId}` },
        {
          type: 'role',
          value: 'button',
          options: { name: t('tags.delete'), exact: false },
          within: `admin-tag-row-${tagId}`,
        },
      ],
      { intent: 'delete button for tag row' },
    );
  }

  /**
   * Returns a resolved locator for the pagination container on the tags page.
   * Throws if not found — the tags list must have more than one page of results.
   *
   * Callers must ensure the tags list has actually finished loading (see
   * isLoaded()) before calling this — Pagination only mounts once the tags
   * query has resolved (PipelinesAndFieldsSettings.tsx TagManagementSection).
   */
  async paginationLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'pagination' },
          { type: 'role', value: 'navigation', options: { name: /page/i } },
        ],
        { intent: 'pagination navigation on admin tags page' },
      )
      .resolve(timeout);
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
   * Uses isNotVisible rather than waitFor(..., 'hidden') so that a mutation that
   * completes before this method runs (element already detached from DOM) is not
   * mistaken for a failure — isNotVisible resolves immediately for absent elements
   * without requiring the element to be found first.
   *
   * @param tagId - Tag UUID.
   * @param timeout - Maximum wait in milliseconds (default 10 s).
   */
  async waitForRenameSaveGone(tagId: string, timeout = 10_000): Promise<boolean> {
    return this.page.isNotVisible(
      [
        { type: 'testId', value: `rename-save-${tagId}` },
        { type: 'css', value: `[data-testid="rename-save-${tagId}"]` },
      ],
      timeout,
    );
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
