/**
 * Contacts API module.
 * Wraps the contact CRUD endpoints. All endpoints require authentication.
 */

import apiClient from './axiosInstance.js';
import type {
  ContactResponse,
  CreateContactInput,
  UpdateContactInput,
} from '@shared/schemas/contactSchema.js';
import type { DealResponse } from '@shared/schemas/dealSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';

interface ContactSingleResponse {
  contact: ContactResponse;
}

/** Shape of the duplicate info returned in a 409 response */
export interface DuplicateContactInfo {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

/** Parameters for filtering and paginating the contacts list */
export interface ListContactsParams {
  /** When 'me', only the current user's contacts are returned */
  owner?: 'me';
  /** When provided, only contacts linked to this account UUID are returned */
  accountId?: string;
  /** Case-insensitive substring match on first name, last name, or email */
  search?: string;
  /** Case-insensitive substring match on the linked account name */
  accountSearch?: string;
  /** Column to sort by */
  sort?: 'created_at' | 'first_name' | 'last_name' | 'email';
  /** Sort direction */
  dir?: 'asc' | 'desc';
  /** 1-based page number */
  page?: number;
  /** Records per page */
  limit?: number;
}

/**
 * Returns a paginated list of contacts with optional filtering.
 *
 * @param params - Optional filter and pagination parameters
 */
export async function listContacts(
  params: ListContactsParams = {},
): Promise<PaginatedResponse<ContactResponse>> {
  const queryParams: Record<string, string> = {};
  if (params.owner) queryParams.owner = params.owner;
  if (params.accountId) queryParams.account = params.accountId;
  if (params.search) queryParams.search = params.search;
  if (params.accountSearch) queryParams.accountSearch = params.accountSearch;
  if (params.sort) queryParams.sort = params.sort;
  if (params.dir) queryParams.dir = params.dir;
  if (params.page !== undefined) queryParams.page = String(params.page);
  if (params.limit !== undefined) queryParams.limit = String(params.limit);
  const response = await apiClient.get<PaginatedResponse<ContactResponse>>('/contacts', {
    params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
  });
  return response.data;
}

/**
 * Returns a single contact by UUID.
 *
 * @param id - Contact UUID
 */
export async function getContact(id: string): Promise<ContactSingleResponse> {
  const response = await apiClient.get<ContactSingleResponse>(`/contacts/${id}`);
  return response.data;
}

/**
 * Creates a new contact.
 *
 * @param data - Contact fields (first_name and email are required)
 * @param force - When true, bypasses the duplicate email check
 */
export async function createContact(
  data: CreateContactInput,
  force = false,
): Promise<ContactSingleResponse> {
  const response = await apiClient.post<ContactSingleResponse>(
    '/contacts',
    data,
    force ? { params: { force: 'true' } } : undefined,
  );
  return response.data;
}

/**
 * Updates one or more fields of an existing contact.
 *
 * @param id - Contact UUID
 * @param data - Fields to update
 */
export async function updateContact(
  id: string,
  data: UpdateContactInput,
): Promise<ContactSingleResponse> {
  const response = await apiClient.patch<ContactSingleResponse>(`/contacts/${id}`, data);
  return response.data;
}

/**
 * Deletes a contact by UUID.
 *
 * @param id - Contact UUID
 */
export async function deleteContact(id: string): Promise<void> {
  await apiClient.delete(`/contacts/${id}`);
}

/**
 * Returns all deals linked to a contact via the deal_contacts join table.
 *
 * @param id - Contact UUID
 */
export async function listContactDeals(id: string): Promise<{ deals: DealResponse[] }> {
  const response = await apiClient.get<{ deals: DealResponse[] }>(`/contacts/${id}/deals`);
  return response.data;
}

/** Parameters for the contacts CSV export */
export interface ExportContactsParams {
  /** When true, admins export all contacts (reps always get their own) */
  all?: boolean;
  owner?: 'me';
  accountId?: string;
  search?: string;
  accountSearch?: string;
}

/**
 * Downloads all matching contacts as a CSV file.
 * Triggers a browser file-save dialog.
 * (MINCRM-164)
 *
 * @param params - Optional filter parameters
 */
export async function exportContactsCsv(params: ExportContactsParams = {}): Promise<void> {
  const queryParams: Record<string, string> = {};
  if (params.all) queryParams.all = 'true';
  if (params.owner) queryParams.owner = params.owner;
  if (params.accountId) queryParams.account = params.accountId;
  if (params.search) queryParams.search = params.search;
  if (params.accountSearch) queryParams.accountSearch = params.accountSearch;

  const response = await apiClient.get<Blob>('/contacts/export', {
    params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    responseType: 'blob',
  });

  const date = new Date().toISOString().split('T')[0];
  const filename = `minicrm-contacts-${date}.csv`;
  triggerCsvDownload(response.data, filename);
}

/**
 * Creates a temporary anchor element to trigger a file download from a Blob.
 *
 * @param blob - CSV blob received from the server
 * @param filename - Suggested filename for the download
 */
function triggerCsvDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
