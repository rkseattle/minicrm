/**
 * Bulk operations API module.
 * Wraps the bulk endpoints for contacts, accounts, deals, activities, and users.
 * Legacy endpoints (contacts/accounts/deals) return { affected }.
 * The newer endpoints return { succeeded, failed } for partial-success reporting.
 */

import apiClient from './axiosInstance.js';

/** Result returned by legacy bulk operations */
export interface BulkResult {
  affected: number;
}

/** Per-record failure detail returned by the bulk endpoints */
export interface BulkFailure {
  id: string;
  reason: string;
}

/** Result returned by the bulk endpoints — partial success is reported in the body */
export interface BulkOperationResult {
  succeeded: string[];
  failed: BulkFailure[];
}

/** PATCH body for bulk user updates */
export interface BulkUserPatch {
  ids: string[];
  patch: {
    active?: boolean;
    role?: string;
  };
}

/** DELETE body for bulk entity deletes */
export interface BulkDeleteBody {
  ids: string[];
}

/** PATCH body for bulk contact updates */
export interface BulkContactPatch {
  ids: string[];
  patch: { owner_id?: string };
}

/** PATCH body for bulk deal updates */
export interface BulkDealPatch {
  ids: string[];
  patch: { owner_id?: string; stage?: string };
}

/** PATCH body for bulk activity updates */
export interface BulkActivityPatch {
  ids: string[];
  patch: { owner_id?: string };
}

/** PATCH body for bulk lead updates */
export interface BulkLeadPatch {
  ids: string[];
  patch: { owner_id: string };
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

// ── Bulk endpoints (partial-success response shape) ──────────────────────────

/**
 * Bulk PATCH for users (activate, deactivate, change role).
 *
 * @param body - ids and patch fields
 */
export async function bulkPatchUsers(body: BulkUserPatch): Promise<BulkOperationResult> {
  const response = await apiClient.patch<BulkOperationResult>('/users/bulk', body);
  return response.data;
}

/**
 * Bulk DELETE for users.
 *
 * @param body - ids to delete
 */
export async function bulkDeleteUsers(body: BulkDeleteBody): Promise<BulkOperationResult> {
  const response = await apiClient.delete<BulkOperationResult>('/users/bulk', { data: body });
  return response.data;
}

/**
 * Bulk PATCH for contacts (reassign owner).
 *
 * @param body - ids and patch fields
 */
export async function bulkPatchContacts(body: BulkContactPatch): Promise<BulkOperationResult> {
  const response = await apiClient.patch<BulkOperationResult>('/contacts/bulk', body);
  return response.data;
}

/**
 * Bulk DELETE for contacts.
 *
 * @param body - ids to delete
 */
export async function bulkDeleteContacts(body: BulkDeleteBody): Promise<BulkOperationResult> {
  const response = await apiClient.delete<BulkOperationResult>('/contacts/bulk', { data: body });
  return response.data;
}

/**
 * Bulk PATCH for deals (reassign owner, change stage).
 *
 * @param body - ids and patch fields
 */
export async function bulkPatchDeals(body: BulkDealPatch): Promise<BulkOperationResult> {
  const response = await apiClient.patch<BulkOperationResult>('/deals/bulk', body);
  return response.data;
}

/**
 * Bulk DELETE for deals.
 *
 * @param body - ids to delete
 */
export async function bulkDeleteDeals(body: BulkDeleteBody): Promise<BulkOperationResult> {
  const response = await apiClient.delete<BulkOperationResult>('/deals/bulk', { data: body });
  return response.data;
}

/**
 * Bulk PATCH for activities (reassign owner).
 *
 * @param body - ids and patch fields
 */
export async function bulkPatchActivities(body: BulkActivityPatch): Promise<BulkOperationResult> {
  const response = await apiClient.patch<BulkOperationResult>('/activities/bulk', body);
  return response.data;
}

/**
 * Bulk DELETE for activities.
 *
 * @param body - ids to delete
 */
export async function bulkDeleteActivities(body: BulkDeleteBody): Promise<BulkOperationResult> {
  const response = await apiClient.delete<BulkOperationResult>('/activities/bulk', {
    data: body,
  });
  return response.data;
}

/**
 * Bulk PATCH for leads (reassign owner).
 *
 * @param body - ids and patch fields
 */
export async function bulkPatchLeads(body: BulkLeadPatch): Promise<BulkOperationResult> {
  const response = await apiClient.patch<BulkOperationResult>('/leads/bulk', body);
  return response.data;
}

/**
 * Bulk DELETE for leads.
 *
 * @param body - ids to delete
 */
export async function bulkDeleteLeads(body: BulkDeleteBody): Promise<BulkOperationResult> {
  const response = await apiClient.delete<BulkOperationResult>('/leads/bulk', { data: body });
  return response.data;
}
