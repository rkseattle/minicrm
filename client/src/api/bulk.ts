/**
 * Bulk operations API module.
 * Wraps the bulk endpoints for contacts, accounts, and deals. (MINCRM-188)
 */

import apiClient from './axiosInstance.js';

/** Result returned by all bulk operations */
export interface BulkResult {
  affected: number;
}

/** Payload for a bulk contact or account operation */
export interface BulkContactAccountPayload {
  action: 'reassign' | 'delete';
  ids: string[];
  owner_id?: string;
}

/** Payload for a bulk deal operation */
export interface BulkDealPayload {
  action: 'reassign' | 'delete' | 'change_stage';
  ids: string[];
  owner_id?: string;
  stage?: string;
}

/**
 * Performs a bulk operation on contacts.
 *
 * @param payload - Action, IDs, and optional owner_id
 */
export async function bulkContacts(payload: BulkContactAccountPayload): Promise<BulkResult> {
  const response = await apiClient.post<BulkResult>('/contacts/bulk', payload);
  return response.data;
}

/**
 * Performs a bulk operation on accounts.
 *
 * @param payload - Action, IDs, and optional owner_id
 */
export async function bulkAccounts(payload: BulkContactAccountPayload): Promise<BulkResult> {
  const response = await apiClient.post<BulkResult>('/accounts/bulk', payload);
  return response.data;
}

/**
 * Performs a bulk operation on deals.
 *
 * @param payload - Action, IDs, and optional owner_id or stage
 */
export async function bulkDeals(payload: BulkDealPayload): Promise<BulkResult> {
  const response = await apiClient.post<BulkResult>('/deals/bulk', payload);
  return response.data;
}
