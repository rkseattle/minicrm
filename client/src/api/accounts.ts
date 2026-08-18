/**
 * Accounts API module.
 * Wraps the account CRUD endpoints. All endpoints require authentication.
 */

import apiClient from './axiosInstance.js';
import { triggerCsvDownload } from '@/utils/csvDownload.js';
import type {
  AccountResponse,
  AccountType,
  CreateAccountInput,
  UpdateAccountInput,
} from '@shared/schemas/accountSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';
import type { AccountHealthListFilterState } from '@shared/schemas/accountHealthScoreSchema.js';

interface AccountSingleResponse {
  account: AccountResponse;
}

/** Parameters for filtering and paginating the accounts list */
export interface ListAccountsParams {
  /** 'me' = current user only; 'my_team' = all team co-members */
  owner?: 'me' | 'my_team';
  /** Case-insensitive substring match on account name */
  search?: string;
  /** Case-insensitive match on industry field */
  industry?: string;
  /** Filter by account type */
  account_type?: AccountType;
  /** Column to sort by */
  sort?: 'created_at' | 'name';
  /** Sort direction */
  dir?: 'asc' | 'desc';
  /** 1-based page number */
  page?: number;
  /** Records per page */
  limit?: number;
  /** Tag IDs to filter by (any-match). */
  tags?: string[];
  /** Relationship health states to filter by (any-match). */
  health_status?: AccountHealthListFilterState[];
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
  if (params.account_type) queryParams.account_type = params.account_type;
  if (params.sort) queryParams.sort = params.sort;
  if (params.dir) queryParams.dir = params.dir;
  if (params.page !== undefined) queryParams.page = String(params.page);
  if (params.limit !== undefined) queryParams.limit = String(params.limit);
  if (params.tags && params.tags.length > 0) queryParams.tags = params.tags.join(',');
  if (params.health_status && params.health_status.length > 0) {
    queryParams.health_status = params.health_status.join(',');
  }
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
export async function createAccount(
  data: CreateAccountInput,
  force = false,
): Promise<AccountSingleResponse> {
  const response = await apiClient.post<AccountSingleResponse>(
    '/accounts',
    data,
    force ? { params: { force: 'true' } } : undefined,
  );
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
 * Returns all direct child (subsidiary) accounts of the given account.
 *
 * @param id - Parent account UUID
 */
export async function listChildAccounts(id: string): Promise<{ accounts: AccountResponse[] }> {
  const response = await apiClient.get<{ accounts: AccountResponse[] }>(`/accounts/${id}/children`);
  return response.data;
}

/** Parameters for account type-ahead search */
export interface SearchAccountsParams {
  /** Substring to match against account name */
  q: string;
  /** Account UUID to exclude from results (prevents self-parenting) */
  exclude?: string;
}

/**
 * Type-ahead search for accounts by name. Returns up to 10 matches.
 *
 * @param params - Search parameters
 */
export async function searchAccountsByName(
  params: SearchAccountsParams,
): Promise<{ accounts: AccountResponse[] }> {
  const queryParams: Record<string, string> = { q: params.q };
  if (params.exclude) queryParams.exclude = params.exclude;
  const response = await apiClient.get<{ accounts: AccountResponse[] }>('/accounts/search', {
    params: queryParams,
  });
  return response.data;
}

/**
 * Downloads all matching accounts as a CSV file.
 * Triggers a browser file-save dialog.
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

/**
 * Downloads all matching accounts as a paginated PDF table.
 * Triggers a browser file-save dialog. Same filters as exportAccountsCsv().
 *
 * @param params - Optional filter parameters
 */
export async function exportAccountsPdf(params: ExportAccountsParams = {}): Promise<void> {
  const queryParams: Record<string, string> = {};
  if (params.all) queryParams.all = 'true';
  if (params.search) queryParams.search = params.search;
  if (params.industry) queryParams.industry = params.industry;

  const response = await apiClient.get<Blob>('/accounts/export.pdf', {
    params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    responseType: 'blob',
  });

  const date = new Date().toISOString().split('T')[0];
  const filename = `minicrm-accounts-${date}.pdf`;
  triggerCsvDownload(response.data, filename);
}

/**
 * Downloads a single account as a one-record summary PDF.
 * Triggers a browser file-save dialog.
 *
 * @param id - Account UUID
 */
export async function exportAccountPdf(id: string): Promise<void> {
  const response = await apiClient.get<Blob>(`/accounts/${id}/export.pdf`, {
    responseType: 'blob',
  });

  const date = new Date().toISOString().split('T')[0];
  const filename = `minicrm-account-${id}-${date}.pdf`;
  triggerCsvDownload(response.data, filename);
}
