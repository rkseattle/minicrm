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

interface ContactsResponse {
  contacts: ContactResponse[];
}

interface ContactSingleResponse {
  contact: ContactResponse;
}

/**
 * Returns all contacts. Pass owner='me' to scope to the current user.
 *
 * @param owner - When 'me', only the current user's contacts are returned
 */
export async function listContacts(owner?: 'me'): Promise<ContactsResponse> {
  const params = owner ? { owner } : undefined;
  const response = await apiClient.get<ContactsResponse>('/contacts', { params });
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
 */
export async function createContact(data: CreateContactInput): Promise<ContactSingleResponse> {
  const response = await apiClient.post<ContactSingleResponse>('/contacts', data);
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
