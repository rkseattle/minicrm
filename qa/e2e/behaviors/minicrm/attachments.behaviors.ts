/**
 * Attachments behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-154, MINCRM-357
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade } from '@framework/fixtures/index.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by attachment UI behaviors. */
export interface AttachmentsBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// API data types (MINCRM-357)
// ---------------------------------------------------------------------------

/** Shape of an attachment returned by the API. */
export interface AttachmentRow {
  id: string;
  filename: string;
  size: number;
  record_type: string;
  record_id: string;
  uploaded_by: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// API data-fetch helpers (MINCRM-357)
// ---------------------------------------------------------------------------

/**
 * Lists attachments for the given record via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param recordType - Entity type ('contact' | 'account' | 'deal').
 * @param recordId - Entity UUID.
 * @returns Array of attachment rows.
 */
export async function listAttachments(
  restClient: RestClient,
  recordType: 'contact' | 'account' | 'deal',
  recordId: string,
): Promise<AttachmentRow[]> {
  const res = await restClient.get<{ attachments: AttachmentRow[] }>(
    `/api/v1/attachments?recordType=${recordType}&recordId=${recordId}`,
  );
  return res.body.attachments;
}

/**
 * Deletes an attachment by ID via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param attachmentId - Attachment UUID.
 * @returns The HTTP status code.
 */
export async function deleteAttachment(
  restClient: RestClient,
  attachmentId: string,
): Promise<number> {
  const res = await restClient.delete(`/api/v1/attachments/${attachmentId}`);
  return res.status;
}

/**
 * Checks whether an attachment download URL is reachable (returns non-error status).
 *
 * @param restClient - Authenticated RestClient.
 * @param attachmentId - Attachment UUID.
 * @returns The HTTP status code from the download endpoint.
 */
export async function getAttachmentDownloadStatus(
  restClient: RestClient,
  attachmentId: string,
): Promise<number> {
  const res = await restClient.get(`/api/v1/attachments/${attachmentId}/download`);
  return res.status;
}

// ---------------------------------------------------------------------------
// UI locator/visibility helpers — keep page.locate/isNotVisible out of spec
// files. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Resolves the first attachment download link on the current page.
 * Uses a prefix-match CSS selector because the testid includes a dynamic attachment ID.
 * eslint-disable-next-line local/require-locator-fallback -- prefix-match testId has no scoped role fallback; role:link matches all nav links
 */
export async function getAttachmentDownloadLinkLocator(context: AttachmentsBehaviorContext) {
  // eslint-disable-next-line local/require-locator-fallback -- prefix-match testId has no scoped role fallback; role:link matches all nav links
  return context.page
    .locate([{ type: 'css', value: '[data-testid^="attachment-download-"]' }])
    .resolve();
}

/**
 * Returns true when the attachment row for the given ID is absent or hidden.
 * Used to assert that a deleted attachment no longer appears in the list.
 */
export async function isAttachmentRowHidden(
  attachmentId: string,
  context: AttachmentsBehaviorContext,
): Promise<boolean> {
  return context.page.isNotVisible([{ type: 'testId', value: `attachment-row-${attachmentId}` }]);
}
