/**
 * Leads API module.
 * Wraps the lead CRUD and lifecycle endpoints.
 * (MINCRM-173, MINCRM-174, MINCRM-175)
 */

import apiClient from './axiosInstance.js';
import type {
  LeadResponse,
  LeadStatusHistory,
  CreateLeadInput,
  UpdateLeadInput,
  ConvertLeadInput,
} from '@shared/schemas/leadSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';

interface LeadSingleResponse {
  lead: LeadResponse;
}

/** Shape of the duplicate info returned in a 409 response */
export interface DuplicateLeadInfo {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
}

/** Parameters for filtering and paginating the leads list */
export interface ListLeadsParams {
  owner?: 'me';
  status?: string;
  lead_source?: string;
  includeDisqualified?: boolean;
  includeConverted?: boolean;
  sort?: 'created_at' | 'first_name' | 'last_name' | 'email' | 'company_name' | 'status';
  dir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/** Result of a successful lead conversion */
export interface ConversionResult {
  contact_id: string;
  account_id: string;
  deal_id: string;
}

/**
 * Returns a paginated list of leads with optional filtering.
 *
 * @param params - Optional filter and pagination parameters
 */
export async function listLeads(
  params: ListLeadsParams = {},
): Promise<PaginatedResponse<LeadResponse>> {
  const queryParams: Record<string, string> = {};
  if (params.owner) queryParams.owner = params.owner;
  if (params.status) queryParams.status = params.status;
  if (params.lead_source) queryParams.lead_source = params.lead_source;
  if (params.includeDisqualified) queryParams.includeDisqualified = 'true';
  if (params.includeConverted) queryParams.includeConverted = 'true';
  if (params.sort) queryParams.sort = params.sort;
  if (params.dir) queryParams.dir = params.dir;
  if (params.page !== undefined) queryParams.page = String(params.page);
  if (params.limit !== undefined) queryParams.limit = String(params.limit);

  const response = await apiClient.get<PaginatedResponse<LeadResponse>>('/leads', {
    params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
  });
  return response.data;
}

/**
 * Returns a single lead by UUID.
 *
 * @param id - Lead UUID
 */
export async function getLead(id: string): Promise<LeadSingleResponse> {
  const response = await apiClient.get<LeadSingleResponse>(`/leads/${id}`);
  return response.data;
}

/**
 * Creates a new lead.
 *
 * @param data - Lead fields (first_name and email are required)
 * @param force - When true, bypasses the duplicate email check
 */
export async function createLead(
  data: CreateLeadInput,
  force = false,
): Promise<LeadSingleResponse> {
  const response = await apiClient.post<LeadSingleResponse>(
    '/leads',
    data,
    force ? { params: { force: 'true' } } : undefined,
  );
  return response.data;
}

/**
 * Updates one or more fields of an existing lead.
 *
 * @param id - Lead UUID
 * @param data - Fields to update
 */
export async function updateLead(id: string, data: UpdateLeadInput): Promise<LeadSingleResponse> {
  const response = await apiClient.patch<LeadSingleResponse>(`/leads/${id}`, data);
  return response.data;
}

/**
 * Deletes a lead by UUID.
 *
 * @param id - Lead UUID
 */
export async function deleteLead(id: string): Promise<void> {
  await apiClient.delete(`/leads/${id}`);
}

/**
 * Returns the status change history for a lead. (MINCRM-174)
 *
 * @param id - Lead UUID
 */
export async function getLeadStatusHistory(id: string): Promise<{ history: LeadStatusHistory[] }> {
  const response = await apiClient.get<{ history: LeadStatusHistory[] }>(
    `/leads/${id}/status-history`,
  );
  return response.data;
}

/**
 * Converts a lead into a contact, account, and deal. (MINCRM-175)
 *
 * @param id - Lead UUID to convert
 * @param data - Prefilled conversion form data
 */
export async function convertLead(
  id: string,
  data: ConvertLeadInput,
): Promise<{ conversion: ConversionResult }> {
  const response = await apiClient.post<{ conversion: ConversionResult }>(
    `/leads/${id}/convert`,
    data,
  );
  return response.data;
}

/**
 * Searches accounts by name substring for the conversion form. (MINCRM-175)
 *
 * @param q - Substring to search
 */
export async function searchAccountsForConversion(
  q: string,
): Promise<{ accounts: Array<{ id: string; name: string }> }> {
  const response = await apiClient.get<{ accounts: Array<{ id: string; name: string }> }>(
    '/leads/accounts/search',
    { params: { q } },
  );
  return response.data;
}
