/**
 * Tags behaviors for MiniCRM (MINCRM-186).
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-186
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { AdminTagsPage } from '@pages/minicrm/AdminTagsPage.js';
import { TagInputWidget } from '@pages/minicrm/TagInputWidget.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by tags behaviors. */
export interface TagsBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// navigateToAdminTags()
// ---------------------------------------------------------------------------

/** Result returned by navigateToAdminTags. */
export interface NavigateToAdminTagsResult {
  /** True when the admin tags page loaded successfully (heading present). */
  loaded: boolean;
  /** The URL the browser settled on after navigation. */
  finalUrl: string;
}

/**
 * Navigates to the admin tags management page and waits for it to be ready.
 *
 * @param context - Playwright fixture context.
 * @returns NavigateToAdminTagsResult.
 */
export async function navigateToAdminTags(
  context: TagsBehaviorContext,
): Promise<NavigateToAdminTagsResult> {
  const adminTagsPage = new AdminTagsPage(context);
  await adminTagsPage.navigate();
  const loaded = await adminTagsPage.isLoaded();
  const finalUrl = adminTagsPage.url();
  return { loaded, finalUrl };
}

// ---------------------------------------------------------------------------
// renameTagViaUI()
// ---------------------------------------------------------------------------

/** Result returned by renameTagViaUI. */
export interface RenameTagViaUIResult {
  /**
   * True when the rename form closed without error after saving.
   * The caller must verify the new name via API.
   */
  saved: boolean;
  /** The URL the browser settled on after the operation. */
  finalUrl: string;
}

/**
 * On the admin tags page, clicks Rename for the given tag, clears the input,
 * types the new name, and saves.
 *
 * Assumes the browser is already on /admin/tags and the tag row is visible.
 *
 * @param tagId - UUID of the tag to rename.
 * @param newName - Replacement name to type.
 * @param context - Playwright fixture context.
 * @returns RenameTagViaUIResult.
 */
export async function renameTagViaUI(
  tagId: string,
  newName: string,
  context: TagsBehaviorContext,
): Promise<RenameTagViaUIResult> {
  const adminTagsPage = new AdminTagsPage(context);

  await adminTagsPage.clickRename(tagId);
  await adminTagsPage.fillRenameInput(tagId, newName);
  await adminTagsPage.clickRenameSave(tagId);

  // After a successful save the rename form closes and the row reverts to
  // read mode — the tag row itself remains visible.
  await context.page.waitForLoadState('networkidle');

  // The rename form's save button disappears on success.
  const renameFormGone = !(await adminTagsPage.renameSaveButtonIsVisible(tagId));

  const finalUrl = adminTagsPage.url();
  return { saved: renameFormGone, finalUrl };
}

// ---------------------------------------------------------------------------
// deleteTagViaUI()
// ---------------------------------------------------------------------------

/** Result returned by deleteTagViaUI. */
export interface DeleteTagViaUIResult {
  /**
   * True when the tag row is no longer visible after deleting.
   * A disappeared row indicates the server confirmed the deletion and the UI
   * re-rendered.
   */
  deleted: boolean;
  /** The URL the browser settled on after the operation. */
  finalUrl: string;
}

/**
 * On the admin tags page, clicks Delete for the given tag and waits for the
 * row to disappear from the list.
 *
 * Assumes the browser is already on /admin/tags and the tag row is visible.
 *
 * @param tagId - UUID of the tag to delete.
 * @param context - Playwright fixture context.
 * @returns DeleteTagViaUIResult.
 */
export async function deleteTagViaUI(
  tagId: string,
  context: TagsBehaviorContext,
): Promise<DeleteTagViaUIResult> {
  const adminTagsPage = new AdminTagsPage(context);

  await adminTagsPage.clickDelete(tagId);
  await context.page.waitForLoadState('networkidle');

  // Row should be gone after a successful delete + React Query invalidation.
  const deleted = !(await adminTagsPage.isTagRowVisible(tagId));
  const finalUrl = adminTagsPage.url();
  return { deleted, finalUrl };
}

// ---------------------------------------------------------------------------
// attachTagViaUI()
// ---------------------------------------------------------------------------

/** Result returned by attachTagViaUI. */
export interface AttachTagViaUIResult {
  /**
   * True when the tag badge appeared in the tag list after typing and
   * pressing Enter.
   */
  badgeVisible: boolean;
  /** The URL the browser settled on after the operation. */
  finalUrl: string;
}

/**
 * On an entity detail page (contact/account/deal), types a tag name into the
 * TagInput widget and presses Enter to attach it.
 *
 * Assumes the browser is already on the entity detail page.
 *
 * @param entityId - UUID of the owning record (determines widget testIds).
 * @param tagId - UUID of the expected tag (used to verify the badge appeared).
 * @param tagName - Tag name to type into the input.
 * @param context - Playwright fixture context.
 * @returns AttachTagViaUIResult.
 */
export async function attachTagViaUI(
  entityId: string,
  tagId: string,
  tagName: string,
  context: TagsBehaviorContext,
): Promise<AttachTagViaUIResult> {
  const widget = new TagInputWidget(context, entityId);

  await widget.typeAndConfirm(tagName);

  const badgeVisible = await widget.isBadgeVisible(tagId);
  const finalUrl = widget.url();
  return { badgeVisible, finalUrl };
}

// ---------------------------------------------------------------------------
// detachTagViaUI()
// ---------------------------------------------------------------------------

/** Result returned by detachTagViaUI. */
export interface DetachTagViaUIResult {
  /**
   * True when the tag badge is no longer visible after clicking the remove
   * button.
   */
  badgeGone: boolean;
  /** The URL the browser settled on after the operation. */
  finalUrl: string;
}

/**
 * On an entity detail page, clicks the × remove button for the given tag.
 *
 * Assumes the browser is already on the entity detail page and the badge is
 * currently visible.
 *
 * @param entityId - UUID of the owning record.
 * @param tagId - UUID of the tag to remove.
 * @param context - Playwright fixture context.
 * @returns DetachTagViaUIResult.
 */
export async function detachTagViaUI(
  entityId: string,
  tagId: string,
  context: TagsBehaviorContext,
): Promise<DetachTagViaUIResult> {
  const widget = new TagInputWidget(context, entityId);

  await widget.removeBadge(tagId);

  const badgeGone = !(await widget.isBadgeVisible(tagId));
  const finalUrl = widget.url();
  return { badgeGone, finalUrl };
}

// ---------------------------------------------------------------------------
// API data-fetch helpers (MINCRM-357)
// ---------------------------------------------------------------------------

/** Shape of a tag returned by GET /api/v1/tags/:id. */
export interface TagRow {
  id: string;
  name: string;
}

/** Shape of a contact-tag association. */
export interface ContactTagRow {
  id: string;
  name: string;
}

/** Shape of a deal-tag association. */
export interface DealTagRow {
  id: string;
  name: string;
}

/**
 * Fetches a single tag by ID from the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param tagId - Tag UUID.
 * @returns The tag record.
 */
export async function getTagById(restClient: RestClient, tagId: string): Promise<TagRow> {
  const res = await restClient.get<{ tag: TagRow }>(`/api/v1/tags/${tagId}`);
  return res.body.tag;
}

/**
 * Fetches all tags attached to a contact.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - Contact UUID.
 * @returns Array of contact tag rows.
 */
export async function getContactTags(
  restClient: RestClient,
  contactId: string,
): Promise<ContactTagRow[]> {
  const res = await restClient.get<{ tags: ContactTagRow[] }>(`/api/v1/contacts/${contactId}/tags`);
  return res.body.tags;
}

/**
 * Attaches a tag to a contact by name via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - Contact UUID.
 * @param name - Tag name to attach.
 * @returns HTTP status code.
 */
export async function attachTagToContact(
  restClient: RestClient,
  contactId: string,
  name: string,
): Promise<number> {
  const res = await restClient.post(`/api/v1/contacts/${contactId}/tags`, { name });
  return res.status;
}

/**
 * Fetches all tags attached to a deal.
 *
 * @param restClient - Authenticated RestClient.
 * @param dealId - Deal UUID.
 * @returns Array of deal tag rows.
 */
export async function getDealTags(restClient: RestClient, dealId: string): Promise<DealTagRow[]> {
  const res = await restClient.get<{ tags: DealTagRow[] }>(`/api/v1/deals/${dealId}/tags`);
  return res.body.tags;
}
