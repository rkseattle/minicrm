/**
 * Tags API module (MINCRM-186).
 * Wraps global tag CRUD and entity-scoped attach/detach endpoints.
 * All endpoints require authentication.
 */

import apiClient from './axiosInstance.js';
import type { TagResponse } from '@shared/schemas/tagSchema.js';

interface TagListResponse {
  tags: TagResponse[];
}

interface TagSingleResponse {
  tag: TagResponse;
}

/** React Query cache key for the global tags list */
export const TAGS_QUERY_KEY = ['tags'] as const;

/**
 * Returns all tags ordered by name.
 */
export async function listTags(): Promise<TagListResponse> {
  const response = await apiClient.get<TagListResponse>('/tags');
  return response.data;
}

/**
 * Creates a tag by name, or returns the existing one (idempotent).
 *
 * @param name - Tag name (lowercased, trimmed server-side)
 */
export async function createTag(name: string): Promise<TagSingleResponse> {
  const response = await apiClient.post<TagSingleResponse>('/tags', { name });
  return response.data;
}

/**
 * Renames a tag. Admin only.
 *
 * @param id - Tag UUID
 * @param name - New tag name
 */
export async function updateTag(id: string, name: string): Promise<TagSingleResponse> {
  const response = await apiClient.patch<TagSingleResponse>(`/tags/${id}`, { name });
  return response.data;
}

/**
 * Deletes a tag and removes it from all records. Admin only.
 *
 * @param id - Tag UUID
 */
export async function deleteTag(id: string): Promise<void> {
  await apiClient.delete(`/tags/${id}`);
}

// ── Entity-scoped tag endpoints ────────────────────────────────────────────────

/**
 * Lists all tags on a contact.
 *
 * @param contactId - Contact UUID
 */
export async function listContactTags(contactId: string): Promise<TagListResponse> {
  const response = await apiClient.get<TagListResponse>(`/contacts/${contactId}/tags`);
  return response.data;
}

/**
 * Attaches a tag to a contact by name, creating the tag if needed.
 *
 * @param contactId - Contact UUID
 * @param name - Tag name
 */
export async function attachContactTag(
  contactId: string,
  name: string,
): Promise<TagSingleResponse> {
  const response = await apiClient.post<TagSingleResponse>(`/contacts/${contactId}/tags`, { name });
  return response.data;
}

/**
 * Detaches a tag from a contact.
 *
 * @param contactId - Contact UUID
 * @param tagId - Tag UUID
 */
export async function detachContactTag(contactId: string, tagId: string): Promise<void> {
  await apiClient.delete(`/contacts/${contactId}/tags/${tagId}`);
}

/**
 * Lists all tags on an account.
 *
 * @param accountId - Account UUID
 */
export async function listAccountTags(accountId: string): Promise<TagListResponse> {
  const response = await apiClient.get<TagListResponse>(`/accounts/${accountId}/tags`);
  return response.data;
}

/**
 * Attaches a tag to an account by name, creating the tag if needed.
 *
 * @param accountId - Account UUID
 * @param name - Tag name
 */
export async function attachAccountTag(
  accountId: string,
  name: string,
): Promise<TagSingleResponse> {
  const response = await apiClient.post<TagSingleResponse>(`/accounts/${accountId}/tags`, { name });
  return response.data;
}

/**
 * Detaches a tag from an account.
 *
 * @param accountId - Account UUID
 * @param tagId - Tag UUID
 */
export async function detachAccountTag(accountId: string, tagId: string): Promise<void> {
  await apiClient.delete(`/accounts/${accountId}/tags/${tagId}`);
}

/**
 * Lists all tags on a deal.
 *
 * @param dealId - Deal UUID
 */
export async function listDealTags(dealId: string): Promise<TagListResponse> {
  const response = await apiClient.get<TagListResponse>(`/deals/${dealId}/tags`);
  return response.data;
}

/**
 * Attaches a tag to a deal by name, creating the tag if needed.
 *
 * @param dealId - Deal UUID
 * @param name - Tag name
 */
export async function attachDealTag(dealId: string, name: string): Promise<TagSingleResponse> {
  const response = await apiClient.post<TagSingleResponse>(`/deals/${dealId}/tags`, { name });
  return response.data;
}

/**
 * Detaches a tag from a deal.
 *
 * @param dealId - Deal UUID
 * @param tagId - Tag UUID
 */
export async function detachDealTag(dealId: string, tagId: string): Promise<void> {
  await apiClient.delete(`/deals/${dealId}/tags/${tagId}`);
}
