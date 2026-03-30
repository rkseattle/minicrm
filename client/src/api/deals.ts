/**
 * Deals API module.
 * Wraps the deal CRUD endpoints. All endpoints require authentication.
 */

import apiClient from './axiosInstance.js';
import type { DealResponse, CreateDealInput, UpdateDealInput } from '@shared/schemas/dealSchema.js';

/** React Query cache key for the deals list */
export const DEALS_QUERY_KEY = ['deals'] as const;

interface DealsResponse {
  deals: DealResponse[];
}

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

/**
 * Returns all deals. Pass owner='me' to scope to the current user.
 * Pass accountId to filter by account.
 *
 * @param owner - When 'me', only the current user's deals are returned
 * @param accountId - When provided, only deals for this account are returned
 */
export async function listDeals(owner?: 'me', accountId?: string): Promise<DealsResponse> {
  const params: Record<string, string> = {};
  if (owner) params['owner'] = owner;
  if (accountId) params['account'] = accountId;
  const response = await apiClient.get<DealsResponse>('/deals', { params });
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
