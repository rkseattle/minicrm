/**
 * Search service — cross-entity search across contacts, accounts, deals, leads,
 * and activities. Queries all entity types in parallel using ILIKE for
 * case-insensitive partial-word matching. (MINCRM-207)
 *
 * Performance note: all searches use %pattern% ILIKE which cannot use standard
 * B-tree indexes. At larger data volumes, pg_trgm GIN indexes on the searched
 * columns are the recommended scaling path. See:
 * https://www.postgresql.org/docs/current/pgtrgm.html
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

/** Shape of a lead search result */
export interface LeadSearchResult {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  company_name: string | null;
}

/** Aggregated search response returned by globalSearch */
export interface SearchResults {
  contacts: ContactSearchResult[];
  accounts: AccountSearchResult[];
  deals: DealSearchResult[];
  leads: LeadSearchResult[];
}

/** Options controlling ownership scoping */
interface SearchOptions {
  /** Authenticated user's ID — used to scope rep results */
  userId: string;
  /** Authenticated user's role */
  role: 'admin' | 'rep';
}

/**
 * Strips leading `$`, commas, and surrounding whitespace from a deal value
 * query so that "$120,000", "120,000", and "120000" all normalize to "120000"
 * and match the stored value "120000.00".
 */
function normalizeDealValueQuery(raw: string): string {
  return raw.trim().replace(/^\$/, '').replace(/,/g, '');
}

/**
 * Searches contacts, accounts, deals, and leads in parallel for the given query
 * string. Activities that match are merged into the contacts/accounts/deals
 * sections based on their parent entity. Tag-matched entities are merged into
 * the contacts/accounts/deals sections as well. Admins see all matching records;
 * reps see only records they own.
 *
 * @param query   - The search term (must be >= SEARCH_MIN_LENGTH characters)
 * @param options - Ownership scoping options
 * @returns Grouped search results
 */
export async function globalSearch(query: string, options: SearchOptions): Promise<SearchResults> {
  // Escape LIKE metacharacters so they are treated as literals, not wildcards
  const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const pattern = `%${escaped}%`;
  const isAdmin = options.role === 'admin';

  const normalizedValue = normalizeDealValueQuery(query);
  const valuePattern = `%${normalizedValue.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;

  const [
    contactRows,
    accountRows,
    dealRows,
    leadRows,
    activityContactRows,
    activityAccountRows,
    activityDealRows,
    tagContactRows,
    tagAccountRows,
    tagDealRows,
  ] = await Promise.all([
    // Contacts: match on name, email, phone, title, department, and address fields
    // from both the inline columns and the contact_addresses join table.
    // DISTINCT prevents a contact from appearing multiple times when both address
    // sources match.
    pool.query<ContactSearchResult>(
      `SELECT DISTINCT c.id, c.first_name, c.last_name, c.email
       FROM contacts c
       LEFT JOIN contact_addresses ca ON ca.contact_id = c.id
       WHERE (
         c.first_name ILIKE $1 ESCAPE '\\'
         OR c.last_name ILIKE $1 ESCAPE '\\'
         OR c.email ILIKE $1 ESCAPE '\\'
         OR c.phone ILIKE $1 ESCAPE '\\'
         OR c.title ILIKE $1 ESCAPE '\\'
         OR c.department ILIKE $1 ESCAPE '\\'
         OR c.address_line1 ILIKE $1 ESCAPE '\\'
         OR c.address_line2 ILIKE $1 ESCAPE '\\'
         OR c.city ILIKE $1 ESCAPE '\\'
         OR c.state_region ILIKE $1 ESCAPE '\\'
         OR c.postal_code ILIKE $1 ESCAPE '\\'
         OR c.country ILIKE $1 ESCAPE '\\'
         OR ca.address_line1 ILIKE $1 ESCAPE '\\'
         OR ca.address_line2 ILIKE $1 ESCAPE '\\'
         OR ca.city ILIKE $1 ESCAPE '\\'
         OR ca.state_region ILIKE $1 ESCAPE '\\'
         OR ca.postal_code ILIKE $1 ESCAPE '\\'
         OR ca.country ILIKE $1 ESCAPE '\\'
       )
         AND ($2 OR c.owner_id = $3)
       ORDER BY c.last_name, c.first_name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Accounts: match on name, industry, and website
    pool.query<AccountSearchResult>(
      `SELECT id, name
       FROM accounts
       WHERE (
         name ILIKE $1 ESCAPE '\\'
         OR industry ILIKE $1 ESCAPE '\\'
         OR website ILIKE $1 ESCAPE '\\'
       )
         AND ($2 OR owner_id = $3)
       ORDER BY name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Deals: match on name, stage, loss_reason, currency, and numeric value.
    // value::text produces "120000.00" which is matched against the normalized query.
    pool.query<DealSearchResult>(
      `SELECT id, name, stage
       FROM deals
       WHERE (
         name ILIKE $1 ESCAPE '\\'
         OR stage ILIKE $1 ESCAPE '\\'
         OR loss_reason ILIKE $1 ESCAPE '\\'
         OR currency ILIKE $1 ESCAPE '\\'
         OR value::text ILIKE $2 ESCAPE '\\'
       )
         AND ($3 OR owner_id = $4)
       ORDER BY name
       LIMIT $5`,
      [pattern, valuePattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Leads: match on name, email, company, phone, notes, and disqualification_reason
    pool.query<LeadSearchResult>(
      `SELECT id, first_name, last_name, email, company_name
       FROM leads
       WHERE (
         first_name ILIKE $1 ESCAPE '\\'
         OR last_name ILIKE $1 ESCAPE '\\'
         OR email ILIKE $1 ESCAPE '\\'
         OR company_name ILIKE $1 ESCAPE '\\'
         OR phone ILIKE $1 ESCAPE '\\'
         OR notes ILIKE $1 ESCAPE '\\'
         OR disqualification_reason ILIKE $1 ESCAPE '\\'
       )
         AND ($2 OR owner_id = $3)
       ORDER BY first_name, last_name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Activities linked to a contact — navigate to the contact detail page
    pool.query<ContactSearchResult>(
      `SELECT DISTINCT c.id, c.first_name, c.last_name, c.email
       FROM activities a
       JOIN contacts c ON c.id = a.contact_id
       WHERE a.contact_id IS NOT NULL
         AND (
           a.subject ILIKE $1 ESCAPE '\\'
           OR a.notes ILIKE $1 ESCAPE '\\'
           OR a.outcome ILIKE $1 ESCAPE '\\'
         )
         AND ($2 OR a.owner_id = $3)
       ORDER BY c.last_name, c.first_name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Activities linked to an account — navigate to the account detail page
    pool.query<AccountSearchResult>(
      `SELECT DISTINCT ac.id, ac.name
       FROM activities a
       JOIN accounts ac ON ac.id = a.account_id
       WHERE a.account_id IS NOT NULL AND a.contact_id IS NULL
         AND (
           a.subject ILIKE $1 ESCAPE '\\'
           OR a.notes ILIKE $1 ESCAPE '\\'
           OR a.outcome ILIKE $1 ESCAPE '\\'
         )
         AND ($2 OR a.owner_id = $3)
       ORDER BY ac.name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Activities linked to a deal (and not a contact) — navigate to the deal detail page
    pool.query<DealSearchResult>(
      `SELECT DISTINCT d.id, d.name, d.stage
       FROM activities a
       JOIN deals d ON d.id = a.deal_id
       WHERE a.deal_id IS NOT NULL AND a.contact_id IS NULL AND a.account_id IS NULL
         AND (
           a.subject ILIKE $1 ESCAPE '\\'
           OR a.notes ILIKE $1 ESCAPE '\\'
           OR a.outcome ILIKE $1 ESCAPE '\\'
         )
         AND ($2 OR a.owner_id = $3)
       ORDER BY d.name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Tag-matched contacts
    pool.query<ContactSearchResult>(
      `SELECT DISTINCT c.id, c.first_name, c.last_name, c.email
       FROM contacts c
       JOIN contact_tags ct ON ct.contact_id = c.id
       JOIN tags t ON t.id = ct.tag_id
       WHERE t.name ILIKE $1 ESCAPE '\\'
         AND ($2 OR c.owner_id = $3)
       ORDER BY c.last_name, c.first_name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Tag-matched accounts
    pool.query<AccountSearchResult>(
      `SELECT DISTINCT ac.id, ac.name
       FROM accounts ac
       JOIN account_tags att ON att.account_id = ac.id
       JOIN tags t ON t.id = att.tag_id
       WHERE t.name ILIKE $1 ESCAPE '\\'
         AND ($2 OR ac.owner_id = $3)
       ORDER BY ac.name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Tag-matched deals
    pool.query<DealSearchResult>(
      `SELECT DISTINCT d.id, d.name, d.stage
       FROM deals d
       JOIN deal_tags dt ON dt.deal_id = d.id
       JOIN tags t ON t.id = dt.tag_id
       WHERE t.name ILIKE $1 ESCAPE '\\'
         AND ($2 OR d.owner_id = $3)
       ORDER BY d.name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),
  ]);

  // Merge activity and tag results into the main entity arrays, deduplicating by ID.
  const contactIds = new Set(contactRows.rows.map((r) => r.id));
  const accountIds = new Set(accountRows.rows.map((r) => r.id));
  const dealIds = new Set(dealRows.rows.map((r) => r.id));

  const contacts = [...contactRows.rows];
  for (const row of [...activityContactRows.rows, ...tagContactRows.rows]) {
    if (!contactIds.has(row.id)) {
      contactIds.add(row.id);
      contacts.push(row);
    }
  }

  const accounts = [...accountRows.rows];
  for (const row of [...activityAccountRows.rows, ...tagAccountRows.rows]) {
    if (!accountIds.has(row.id)) {
      accountIds.add(row.id);
      accounts.push(row);
    }
  }

  const deals = [...dealRows.rows];
  for (const row of [...activityDealRows.rows, ...tagDealRows.rows]) {
    if (!dealIds.has(row.id)) {
      dealIds.add(row.id);
      deals.push(row);
    }
  }

  return {
    contacts: contacts.slice(0, SEARCH_RESULT_LIMIT),
    accounts: accounts.slice(0, SEARCH_RESULT_LIMIT),
    deals: deals.slice(0, SEARCH_RESULT_LIMIT),
    leads: leadRows.rows,
  };
}
