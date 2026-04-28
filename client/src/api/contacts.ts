/**
 * Contacts API module.
 * Wraps the contact CRUD endpoints. All endpoints require authentication.
 */

import apiClient from './axiosInstance.js';
import { triggerCsvDownload } from '@/utils/csvDownload.js';
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
  /** Tag IDs to filter by (any-match). MINCRM-186. */
  tags?: string[];
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
  if (params.tags && params.tags.length > 0) queryParams.tags = params.tags.join(',');
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

/** Per-field source choice for contact merge */
export type MergeFieldChoice = 'winner' | 'loser';

/** Parameters for merging two contact records (MINCRM-187) */
export interface MergeContactsParams {
  /** UUID of the contact to merge into (will survive) */
  winnerId: string;
  /** UUID of the contact to merge from (will be deleted) */
  loserId: string;
  /** For each field, which contact's value to keep */
  fieldChoices: Partial<
    Record<
      | 'first_name'
      | 'last_name'
      | 'email'
      | 'phone'
      | 'title'
      | 'department'
      | 'account_id'
      | 'address_line1'
      | 'address_line2'
      | 'city'
      | 'state_region'
      | 'postal_code'
      | 'country'
      | 'linkedin_url'
      | 'twitter_x_url'
      | 'other_url',
      MergeFieldChoice
    >
  >;
}

/**
 * Merges two contact records. The winner survives; the loser is deleted.
 * Returns the updated winner contact. (MINCRM-187)
 *
 * @param params - Merge parameters including field choices
 */
export async function mergeContacts(
  params: MergeContactsParams,
): Promise<{ contact: ContactResponse }> {
  const { winnerId, loserId, fieldChoices } = params;
  const response = await apiClient.post(`/contacts/${winnerId}/merge`, {
    loserId,
    fieldChoices,
  });
  return response.data as { contact: ContactResponse };
}

// ── Contact Addresses ──────────────────────────────────────────────────────────

/** Shape of a contact address record */
export interface ContactAddress {
  id: string;
  contact_id: string;
  label: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  country: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** Fields for creating or updating a contact address */
export interface ContactAddressInput {
  label?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_region?: string;
  postal_code?: string;
  country?: string;
  is_default?: boolean;
}

/**
 * Returns all addresses for a contact.
 *
 * @param contactId - Contact UUID
 */
export async function listContactAddresses(
  contactId: string,
): Promise<{ addresses: ContactAddress[] }> {
  const response = await apiClient.get<{ addresses: ContactAddress[] }>(
    `/contacts/${contactId}/addresses`,
  );
  return response.data;
}

/**
 * Adds a new address to a contact.
 *
 * @param contactId - Contact UUID
 * @param data - Address fields
 */
export async function addContactAddress(
  contactId: string,
  data: ContactAddressInput,
): Promise<{ address: ContactAddress }> {
  const response = await apiClient.post<{ address: ContactAddress }>(
    `/contacts/${contactId}/addresses`,
    data,
  );
  return response.data;
}

/**
 * Updates a contact address.
 *
 * @param contactId - Contact UUID
 * @param addressId - Address UUID
 * @param data - Fields to update
 */
export async function updateContactAddress(
  contactId: string,
  addressId: string,
  data: ContactAddressInput,
): Promise<{ address: ContactAddress }> {
  const response = await apiClient.patch<{ address: ContactAddress }>(
    `/contacts/${contactId}/addresses/${addressId}`,
    data,
  );
  return response.data;
}

/**
 * Deletes a contact address.
 *
 * @param contactId - Contact UUID
 * @param addressId - Address UUID
 */
export async function deleteContactAddress(contactId: string, addressId: string): Promise<void> {
  await apiClient.delete(`/contacts/${contactId}/addresses/${addressId}`);
}

/**
 * Sets a contact address as the default.
 *
 * @param contactId - Contact UUID
 * @param addressId - Address UUID
 */
export async function setDefaultContactAddress(
  contactId: string,
  addressId: string,
): Promise<{ address: ContactAddress }> {
  const response = await apiClient.post<{ address: ContactAddress }>(
    `/contacts/${contactId}/addresses/${addressId}/set-default`,
  );
  return response.data;
}

/** Response from the send-email endpoint (MINCRM-275) */
export interface SendContactEmailResponse {
  delivered: boolean;
  activityId: string | null;
}

/**
 * Sends a user-composed email to a contact and logs an Email activity.
 *
 * @param contactId - Contact UUID
 * @param subject - Email subject line
 * @param body - Plain text body
 */
export async function sendContactEmail(
  contactId: string,
  subject: string,
  body: string,
): Promise<SendContactEmailResponse> {
  const response = await apiClient.post<SendContactEmailResponse>(
    `/contacts/${contactId}/send-email`,
    { subject, body },
  );
  return response.data;
}
