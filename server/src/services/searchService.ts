/**
 * Search service — cross-entity search across contacts, accounts, and deals.
 * Queries all three entity types in parallel using ILIKE for case-insensitive
 * partial-word matching.
 */

import pool from '../db.js';

/** Minimum query length enforced before running a search */
export const SEARCH_MIN_LENGTH = 2;

/** Maximum results returned per entity type */
const SEARCH_RESULT_LIMIT = 10;

/** Shape of a contact search result */
export interface ContactSearchResult {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

/** Shape of an account search result */
export interface AccountSearchResult {
  id: string;
  name: string;
}

/** Shape of a deal search result */
export interface DealSearchResult {
  id: string;
  name: string;
  stage: string;
}

/** Aggregated search response returned by globalSearch */
export interface SearchResults {
  contacts: ContactSearchResult[];
  accounts: AccountSearchResult[];
  deals: DealSearchResult[];
}

/** Options controlling ownership scoping */
interface SearchOptions {
  /** Authenticated user's ID — used to scope rep results */
  userId: string;
  /** Authenticated user's role */
  role: 'admin' | 'rep';
}

/**
 * Searches contacts, accounts, and deals in parallel for the given query string.
 * Admins see all matching records; reps see only records they own.
 *
 * @param query   - The search term (must be >= SEARCH_MIN_LENGTH characters)
 * @param options - Ownership scoping options
 * @returns Grouped search results
 */
export async function globalSearch(query: string, options: SearchOptions): Promise<SearchResults> {
  const pattern = `%${query}%`;
  const isAdmin = options.role === 'admin';

  const [contactRows, accountRows, dealRows] = await Promise.all([
    // Contacts: match on first_name, last_name, or email
    pool.query<ContactSearchResult>(
      `SELECT id, first_name, last_name, email
       FROM contacts
       WHERE (first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1)
         AND ($2 OR owner_id = $3)
       ORDER BY last_name, first_name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Accounts: match on name
    pool.query<AccountSearchResult>(
      `SELECT id, name
       FROM accounts
       WHERE name ILIKE $1
         AND ($2 OR owner_id = $3)
       ORDER BY name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Deals: match on name
    pool.query<DealSearchResult>(
      `SELECT id, name, stage
       FROM deals
       WHERE name ILIKE $1
         AND ($2 OR owner_id = $3)
       ORDER BY name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),
  ]);

  return {
    contacts: contactRows.rows,
    accounts: accountRows.rows,
    deals: dealRows.rows,
  };
}
