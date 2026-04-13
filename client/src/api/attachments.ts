/**
 * Attachments API module. (MINCRM-167)
 * Wraps the attachment endpoints for contacts, accounts, and deals.
 */

import apiClient from './axiosInstance.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RecordType = 'contact' | 'account' | 'deal';

/** An attachment record as returned by the API. */
export interface Attachment {
  id: string;
  record_type: RecordType;
  record_id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  uploader_id: string | null;
  uploader_name: string | null;
  uploaded_at: string;
}

/** Storage configuration shape (secret always masked). */
export interface StorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  /** Always '********' from the server. */
  secretAccessKey: string;
}

// ── Query keys ────────────────────────────────────────────────────────────────

/**
 * Returns the React Query key for the attachment list on a record.
 *
 * @param recordType - The record type.
 * @param recordId - UUID of the parent record.
 */
export function attachmentsQueryKey(recordType: RecordType, recordId: string): readonly unknown[] {
  return ['attachments', recordType, recordId] as const;
}

/** React Query key for the storage configuration. */
export const STORAGE_CONFIG_QUERY_KEY = ['settings', 'storage'] as const;

// ── Attachment endpoints ───────────────────────────────────────────────────────

/**
 * Lists all attachments for a record.
 *
 * @param recordType - The record type.
 * @param recordId - UUID of the parent record.
 * @returns Array of attachment objects.
 */
export async function listAttachments(
  recordType: RecordType,
  recordId: string,
): Promise<Attachment[]> {
  const response = await apiClient.get<{ attachments: Attachment[] }>('/attachments', {
    params: { recordType, recordId },
  });
  return response.data.attachments;
}

/**
 * Uploads a file to a record.
 *
 * @param recordType - The record type.
 * @param recordId - UUID of the parent record.
 * @param file - The File object to upload.
 * @returns The created attachment.
 */
export async function uploadAttachment(
  recordType: RecordType,
  recordId: string,
  file: File,
): Promise<Attachment> {
  const formData = new FormData();
  formData.append('recordType', recordType);
  formData.append('recordId', recordId);
  formData.append('file', file);

  const response = await apiClient.post<{ attachment: Attachment }>('/attachments', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data.attachment;
}

/**
 * Returns the download URL for an attachment (proxied through API).
 *
 * @param id - UUID of the attachment.
 * @returns The absolute URL string for the download endpoint.
 */
export function getDownloadUrl(id: string): string {
  return `${apiClient.defaults.baseURL ?? ''}/attachments/${id}/download`;
}

/**
 * Deletes an attachment.
 *
 * @param id - UUID of the attachment to delete.
 */
export async function deleteAttachment(id: string): Promise<void> {
  await apiClient.delete(`/attachments/${id}`);
}

// ── Storage settings (MINCRM-169) ─────────────────────────────────────────────

/** Response shape for storage config endpoints. */
export interface StorageConfigResponse {
  configured: boolean;
  config: StorageConfig | null;
}

/**
 * Returns the current storage configuration (admin only).
 *
 * @returns configured flag and config object (or null if not configured).
 */
export async function getStorageConfig(): Promise<StorageConfigResponse> {
  const response = await apiClient.get<StorageConfigResponse>('/settings/storage');
  return response.data;
}

/**
 * Saves the storage configuration (admin only).
 *
 * @param config - The new storage configuration.
 * @returns The saved configuration (secret masked).
 */
export async function setStorageConfig(
  config: Omit<StorageConfig, 'secretAccessKey'> & { secretAccessKey: string },
): Promise<StorageConfigResponse> {
  const response = await apiClient.put<StorageConfigResponse>('/settings/storage', config);
  return response.data;
}

/**
 * Clears the storage configuration (admin only).
 *
 * @returns configured: false.
 */
export async function clearStorageConfig(): Promise<StorageConfigResponse> {
  const response = await apiClient.delete<StorageConfigResponse>('/settings/storage');
  return response.data;
}

/**
 * Tests candidate storage credentials without saving (admin only).
 *
 * @param config - Candidate storage configuration.
 * @returns { success: true | false }
 */
export async function testStorageConfig(
  config: Omit<StorageConfig, 'secretAccessKey'> & { secretAccessKey: string },
): Promise<{ success: boolean }> {
  const response = await apiClient.post<{ success: boolean }>('/settings/storage/test', config);
  return response.data;
}
