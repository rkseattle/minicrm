/**
 * Accounts API module.
 * Wraps the account CRUD endpoints. All endpoints require authentication.
 */

import apiClient from './axiosInstance.js';
import type {
  AccountResponse,
  CreateAccountInput,
  UpdateAccountInput,
} from '@shared/schemas/accountSchema.js';

interface AccountsResponse {
  accounts: AccountResponse[];
}

interface AccountSingleResponse {
  account: AccountResponse;
}

/**
 * Returns all accounts. Pass owner='me' to scope to the current user.
 *
 * @param owner - When 'me', only the current user's accounts are returned
 */
export async function listAccounts(owner?: 'me'): Promise<AccountsResponse> {
  const params = owner ? { owner } : undefined;
  const response = await apiClient.get<AccountsResponse>('/accounts', { params });
  return response.data;
}

/**
 * Returns a single account by UUID.
 *
 * @param id - Account UUID
 */
export async function getAccount(id: string): Promise<AccountSingleResponse> {
  const response = await apiClient.get<AccountSingleResponse>(`/accounts/${id}`);
  return response.data;
}

/**
 * Creates a new account.
 *
 * @param data - Account fields (name is required)
 */
export async function createAccount(data: CreateAccountInput): Promise<AccountSingleResponse> {
  const response = await apiClient.post<AccountSingleResponse>('/accounts', data);
  return response.data;
}

/**
 * Updates one or more fields of an existing account.
 *
 * @param id - Account UUID
 * @param data - Fields to update
 */
export async function updateAccount(
  id: string,
  data: UpdateAccountInput,
): Promise<AccountSingleResponse> {
  const response = await apiClient.patch<AccountSingleResponse>(`/accounts/${id}`, data);
  return response.data;
}

/**
 * Deletes an account by UUID.
 *
 * @param id - Account UUID
 */
export async function deleteAccount(id: string): Promise<void> {
  await apiClient.delete(`/accounts/${id}`);
}
