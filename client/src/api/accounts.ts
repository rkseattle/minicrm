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

/** Parameters for filtering the accounts list */
export interface ListAccountsParams {
  /** When 'me', only the current user's accounts are returned */
  owner?: 'me';
  /** Case-insensitive substring match on account name */
  search?: string;
  /** Case-insensitive match on industry field */
  industry?: string;
}

/**
 * Returns all accounts with optional filtering.
 *
 * @param params - Optional filter parameters
 */
export async function listAccounts(params: ListAccountsParams = {}): Promise<AccountsResponse> {
  const queryParams: Record<string, string> = {};
  if (params.owner) queryParams.owner = params.owner;
  if (params.search) queryParams.search = params.search;
  if (params.industry) queryParams.industry = params.industry;
  const response = await apiClient.get<AccountsResponse>('/accounts', {
    params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
  });
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
