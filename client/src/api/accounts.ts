/**
 * Accounts API module.
 * Wraps the account CRUD endpoints. All endpoints require authentication.
 */

import apiClient from './axiosInstance.js';
import { triggerCsvDownload } from '@/utils/csvDownload.js';
import type {
  AccountResponse,
  CreateAccountInput,
  UpdateAccountInput,
} from '@shared/schemas/accountSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';

interface AccountSingleResponse {
  account: AccountResponse;
}

/** Parameters for filtering and paginating the accounts list */
export interface ListAccountsParams {
  /** When 'me', only the current user's accounts are returned */
  owner?: 'me';
  /** Case-insensitive substring match on account name */
  search?: string;
  /** Case-insensitive match on industry field */
  industry?: string;
  /** Column to sort by */
  sort?: 'created_at' | 'name';
  /** Sort direction */
  dir?: 'asc' | 'desc';
  /** 1-based page number */
  page?: number;
  /** Records per page */
  limit?: number;
}

/**
 * Returns a paginated list of accounts with optional filtering.
 *
 * @param params - Optional filter and pagination parameters
 */
export async function listAccounts(
  params: ListAccountsParams = {},
): Promise<PaginatedResponse<AccountResponse>> {
  const queryParams: Record<string, string> = {};
  if (params.owner) queryParams.owner = params.owner;
  if (params.search) queryParams.search = params.search;
  if (params.industry) queryParams.industry = params.industry;
  if (params.sort) queryParams.sort = params.sort;
  if (params.dir) queryParams.dir = params.dir;
  if (params.page !== undefined) queryParams.page = String(params.page);
  if (params.limit !== undefined) queryParams.limit = String(params.limit);
  const response = await apiClient.get<PaginatedResponse<AccountResponse>>('/accounts', {
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

/** Parameters for the accounts CSV export */
export interface ExportAccountsParams {
  /** When true, admins export all accounts (reps always get their own) */
  all?: boolean;
  search?: string;
  industry?: string;
}

/**
 * Downloads all matching accounts as a CSV file.
 * Triggers a browser file-save dialog.
 * (MINCRM-165)
 *
 * @param params - Optional filter parameters
 */
export async function exportAccountsCsv(params: ExportAccountsParams = {}): Promise<void> {
  const queryParams: Record<string, string> = {};
  if (params.all) queryParams.all = 'true';
  if (params.search) queryParams.search = params.search;
  if (params.industry) queryParams.industry = params.industry;

  const response = await apiClient.get<Blob>('/accounts/export', {
    params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    responseType: 'blob',
  });

  const date = new Date().toISOString().split('T')[0];
  const filename = `minicrm-accounts-${date}.csv`;
  triggerCsvDownload(response.data, filename);
}
