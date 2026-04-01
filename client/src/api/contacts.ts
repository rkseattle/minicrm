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

interface ContactsResponse {
  contacts: ContactResponse[];
}

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

/** Parameters for filtering the contacts list */
export interface ListContactsParams {
  /** When 'me', only the current user's contacts are returned */
  owner?: 'me';
  /** When provided, only contacts linked to this account UUID are returned */
  accountId?: string;
  /** Case-insensitive substring match on first name, last name, or email */
  search?: string;
  /** Case-insensitive substring match on the linked account name */
  accountSearch?: string;
}

/**
 * Returns all contacts with optional filtering.
 *
 * @param params - Optional filter parameters
 */
export async function listContacts(params: ListContactsParams = {}): Promise<ContactsResponse> {
  const queryParams: Record<string, string> = {};
  if (params.owner) queryParams.owner = params.owner;
  if (params.accountId) queryParams.account = params.accountId;
  if (params.search) queryParams.search = params.search;
  if (params.accountSearch) queryParams.accountSearch = params.accountSearch;
  const response = await apiClient.get<ContactsResponse>('/contacts', {
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
