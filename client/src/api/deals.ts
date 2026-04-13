/**
 * Deals API module.
 * Wraps the deal CRUD endpoints. All endpoints require authentication.
 */

import apiClient from './axiosInstance.js';
import type { DealResponse, CreateDealInput, UpdateDealInput } from '@shared/schemas/dealSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';

/** React Query cache key for the deals list */
export const DEALS_QUERY_KEY = ['deals'] as const;

interface DealSingleResponse {
  deal: DealResponse;
  contacts: DealContact[];
}

/** Minimal contact shape returned alongside a deal */
export interface DealContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  title: string | null;
}

/** Parameters for filtering and paginating the deals list */
export interface ListDealsParams {
  /** When 'me', only the current user's deals are returned */
  owner?: 'me';
  /** When provided, only deals for this account are returned */
  accountId?: string;
  /** Column to sort by */
  sort?: 'created_at' | 'name' | 'close_date' | 'value';
  /** Sort direction */
  dir?: 'asc' | 'desc';
  /** 1-based page number */
  page?: number;
  /** Records per page */
  limit?: number;
}

/**
 * Returns a paginated list of deals with optional filtering.
 *
 * @param params - Filter and pagination parameters
 */
export async function listDeals(
  params: ListDealsParams = {},
): Promise<PaginatedResponse<DealResponse>> {
  const queryParams: Record<string, string> = {};
  if (params.owner) queryParams['owner'] = params.owner;
  if (params.accountId) queryParams['account'] = params.accountId;
  if (params.sort) queryParams['sort'] = params.sort;
  if (params.dir) queryParams['dir'] = params.dir;
  if (params.page !== undefined) queryParams['page'] = String(params.page);
  if (params.limit !== undefined) queryParams['limit'] = String(params.limit);
  const response = await apiClient.get<PaginatedResponse<DealResponse>>('/deals', {
    params: queryParams,
  });
  return response.data;
}

/**
 * Returns a single deal by UUID, including linked contacts.
 *
 * @param id - Deal UUID
 */
export async function getDeal(id: string): Promise<DealSingleResponse> {
  const response = await apiClient.get<DealSingleResponse>(`/deals/${id}`);
  return response.data;
}

/**
 * Creates a new deal.
 *
 * @param data - Deal fields (name and stage are required)
 */
export async function createDeal(data: CreateDealInput): Promise<{ deal: DealResponse }> {
  const response = await apiClient.post<{ deal: DealResponse }>('/deals', data);
  return response.data;
}

/**
 * Updates one or more fields of an existing deal.
 *
 * @param id - Deal UUID
 * @param data - Fields to update
 */
export async function updateDeal(
  id: string,
  data: UpdateDealInput,
): Promise<{ deal: DealResponse }> {
  const response = await apiClient.patch<{ deal: DealResponse }>(`/deals/${id}`, data);
  return response.data;
}

/**
 * Deletes a deal by UUID.
 *
 * @param id - Deal UUID
 */
export async function deleteDeal(id: string): Promise<void> {
  await apiClient.delete(`/deals/${id}`);
}

/** Response shape returned by link/unlink contact endpoints */
interface DealContactsResponse {
  contacts: DealContact[];
}

/**
 * Links a contact to a deal.
 * Returns the updated list of contacts linked to the deal.
 *
 * @param dealId - Deal UUID
 * @param contactId - Contact UUID
 */
export async function linkContactToDeal(
  dealId: string,
  contactId: string,
): Promise<DealContactsResponse> {
  const response = await apiClient.post<DealContactsResponse>(
    `/deals/${dealId}/contacts/${contactId}`,
  );
  return response.data;
}

/** Parameters for the deals CSV export */
export interface ExportDealsParams {
  /** When true, admins export all deals (reps always get their own) */
  all?: boolean;
  accountId?: string;
}

/**
 * Downloads all matching deals as a CSV file.
 * Triggers a browser file-save dialog.
 * (MINCRM-166)
 *
 * @param params - Optional filter parameters
 */
export async function exportDealsCsv(params: ExportDealsParams = {}): Promise<void> {
  const queryParams: Record<string, string> = {};
  if (params.all) queryParams.all = 'true';
  if (params.accountId) queryParams.account = params.accountId;

  const response = await apiClient.get<Blob>('/deals/export', {
    params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    responseType: 'blob',
  });

  const date = new Date().toISOString().split('T')[0];
  const filename = `minicrm-deals-${date}.csv`;
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

/**
 * Unlinks a contact from a deal without deleting either record.
 * Returns the updated list of contacts linked to the deal.
 *
 * @param dealId - Deal UUID
 * @param contactId - Contact UUID
 */
export async function unlinkContactFromDeal(
  dealId: string,
  contactId: string,
): Promise<DealContactsResponse> {
  const response = await apiClient.delete<DealContactsResponse>(
    `/deals/${dealId}/contacts/${contactId}`,
  );
  return response.data;
}
