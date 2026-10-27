/**
 * Search API module.
 * Wraps the global cross-entity search endpoint.
 */

import apiClient from './axiosInstance.js';
import type { SearchResults } from '@shared/types/search.js';

/** React Query cache key for global search results. */
export const GLOBAL_SEARCH_QUERY_KEY = ['global-search'] as const;

export type {
  ContactSearchResult,
  AccountSearchResult,
  DealSearchResult,
  LeadSearchResult,
  EmailSearchResult,
} from '@shared/types/search.js';

/** Full response from GET /api/v1/search */
export type { SearchResults as SearchResponse } from '@shared/types/search.js';

/**
 * Performs a global cross-entity search.
 *
 * @param query - The search term (minimum 2 characters)
 * @returns Grouped search results for contacts, accounts, deals, leads, and email
 */
export async function globalSearch(query: string): Promise<SearchResults> {
  const response = await apiClient.get<SearchResults>('/search', { params: { q: query } });
  return response.data;
}
