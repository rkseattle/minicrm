/**
 * Search API module.
 * Wraps the global cross-entity search endpoint.
 */

import apiClient from './axiosInstance.js';
import type { EmailLinkRecordType } from '@shared/schemas/emailMessageSchema.js';

/** A contact result returned by the search endpoint */
export interface ContactSearchResult {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

/** An account result returned by the search endpoint */
export interface AccountSearchResult {
  id: string;
  name: string;
}

/** A deal result returned by the search endpoint */
export interface DealSearchResult {
  id: string;
  name: string;
  stage: string;
}

/** A lead result returned by the search endpoint */
export interface LeadSearchResult {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  company_name: string | null;
}

/** One of the caller's own messages, with the linked record it opens */
export interface EmailSearchResult {
  id: string;
  subject: string | null;
  snippet: string | null;
  from_address: string;
  sent_at: string | null;
  record_type: EmailLinkRecordType;
  record_id: string;
}

/** Full response from GET /api/v1/search */
export interface SearchResponse {
  contacts: ContactSearchResult[];
  accounts: AccountSearchResult[];
  deals: DealSearchResult[];
  leads: LeadSearchResult[];
  emails: EmailSearchResult[];
}

/**
 * Performs a global cross-entity search.
 *
 * @param query - The search term (minimum 2 characters)
 * @returns Grouped search results for contacts, accounts, deals, leads, and email
 */
export async function globalSearch(query: string): Promise<SearchResponse> {
  const response = await apiClient.get<SearchResponse>('/search', { params: { q: query } });
  return response.data;
}
