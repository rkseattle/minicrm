/**
 * Search API module.
 * Wraps the global cross-entity search endpoint.
 */

import apiClient from './axiosInstance.js';

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

/** Full response from GET /api/search */
export interface SearchResponse {
  contacts: ContactSearchResult[];
  accounts: AccountSearchResult[];
  deals: DealSearchResult[];
}

/**
 * Performs a global cross-entity search.
 *
 * @param query - The search term (minimum 2 characters)
 * @returns Grouped search results for contacts, accounts, and deals
 */
export async function globalSearch(query: string): Promise<SearchResponse> {
  const response = await apiClient.get<SearchResponse>('/search', { params: { q: query } });
  return response.data;
}
