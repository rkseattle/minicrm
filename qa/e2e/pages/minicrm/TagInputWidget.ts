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
    // Register BEFORE typing so the response cannot land between the Enter
    // keypress and the listener being attached.
    //
    // This replaces waitForLoadState('networkidle') (MINCRM-703). That resolves
    // on a heuristic — 500ms with no more than two in-flight requests — not on
    // this mutation completing, so under CI load it returned while the attach
    // POST was still open. The caller then read `badgeVisible` before React had
    // the tag, and F8-TG4 failed with a bare `expected true, received false`.
    // The repo bans networkidle for exactly this reason; check-networkidle.sh
    // only scans qa/e2e/tests/, so a page object was outside its reach.
    //
    // The entity segment is deliberately loose: this widget serves contacts,
    // accounts and deals, whose endpoints differ only in that segment.
    const attachDone = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new RegExp(`/api/v1/(contacts|accounts|deals)/${this.entityId}/tags$`).test(response.url()),
    );
    await this.page.fill(
      tagName,
      [
        { type: 'testId', value: `tag-input-${this.entityId}` },
        { type: 'role', value: 'combobox', options: { name: t('tags.inputLabel'), exact: false } },
      ],
      { intent: 'tag input combobox for typing new tag name' },
    );
    await this.page.keyboard.press('Enter');
    await attachDone;
  }

  /**
   * Returns whether a tag badge with the given ID is visible in the tag list.
   *
   * @param tagId - Tag UUID.
   */
  async isBadgeVisible(tagId: string, timeout?: number): Promise<boolean> {
    try {
      const el = await this.page
        .locate(
          [
            { type: 'testId', value: `tag-badge-${tagId}` },
            { type: 'css', value: `[data-testid="tag-badge-${tagId}"]` },
          ],
          { intent: 'tag badge pill showing applied tag on entity' },
        )
        .resolve(timeout);
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
    // Registered before the click for the same reason as typeAndConfirm.
    const detachDone = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new RegExp(`/api/v1/(contacts|accounts|deals)/${this.entityId}/tags/${tagId}$`).test(
          response.url(),
        ),
    );
    await this.page.click(
      [
        { type: 'testId', value: `remove-tag-${tagId}` },
        { type: 'css', value: `[data-testid="remove-tag-${tagId}"]` },
      ],
      { intent: 'remove button on tag badge to detach tag from entity' },
    );
    // Wait for the badge to leave the DOM — React Query removes it optimistically,
    // so this can satisfy before the DELETE returns.
    await this.page.doesNotExist(
      [
        { type: 'testId', value: `tag-badge-${tagId}` },
        { type: 'css', value: `[data-testid="tag-badge-${tagId}"]` },
      ],
      10_000,
    );
    // Then wait for the server to actually confirm it. Without this the optimistic
    // removal alone could satisfy the caller, and a DELETE that later failed would
    // leave the tag attached while the test reported it detached. Replaces a
    // trailing waitForLoadState('networkidle'). (MINCRM-703)
    await detachDone;
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
