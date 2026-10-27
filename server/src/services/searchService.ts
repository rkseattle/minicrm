/**
 * Search service — cross-entity search across contacts, accounts, deals, leads,
 * and activities. Queries all entity types in parallel using ILIKE for
 * case-insensitive partial-word matching.
 *
 * Performance: all searches use %pattern% ILIKE. GIN trigram indexes
 * (pg_trgm) on contacts.first_name, contacts.last_name, contacts.email,
 * accounts.name, and deals.name were added in migration 041 and
 * allow PostgreSQL to use index scans for leading-wildcard ILIKE patterns.
 * Migration 049 adds a GIN index on notes.body_text to support
 * the notes join added below, and 188 indexes email subjects and snippets.
 */

import pool from '../db.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { buildVisibleLinkPredicate, messageAccessPredicate } from './emailMessageService.js';
import { isFlagEnabledForUser } from './featureFlagService.js';
import { userCapabilities } from './roleService.js';

/** Minimum query length enforced before running a search */
export const SEARCH_MIN_LENGTH = 2;

/** Maximum results returned per entity type */
const SEARCH_RESULT_LIMIT = 10;

import type {
  ContactSearchResult,
  AccountSearchResult,
  DealSearchResult,
  LeadSearchResult,
  EmailSearchResult,
  SearchResults,
} from '@minicrm/shared/types/search.js';

export type {
  ContactSearchResult,
  AccountSearchResult,
  DealSearchResult,
  LeadSearchResult,
  EmailSearchResult,
  SearchResults,
};

/** Options controlling ownership scoping */
interface SearchOptions {
  /** Authenticated user's ID — used to scope rep results */
  userId: string;
  /** Authenticated user's role */
  role: string;
}

/**
 * Whether the caller may see mail at all: the same two gates the email endpoints apply at
 * their router, so search never shows a message those endpoints would refuse.
 */
async function canSearchEmail(options: SearchOptions): Promise<boolean> {
  const [flagOn, capabilities] = await Promise.all([
    isFlagEnabledForUser('email_sync', options.userId, options.role),
    userCapabilities(options.userId),
  ]);
  return flagOn && capabilities.has(Capability.ConnectedAccountsManage);
}

/**
 * The caller's own messages whose subject or snippet matches, each with one linked record
 * the caller may open.
 *
 * Scoped to the caller's mailboxes for every role: a message is readable only through its
 * own mailbox, so an admin reading org-wide here would widen what no email endpoint allows.
 * A message with no openable record is left out — search results are links, and unmatched
 * mail has no page.
 */
async function searchEmails(pattern: string, options: SearchOptions): Promise<EmailSearchResult[]> {
  if (!(await canSearchEmail(options))) return [];
  const FIRST_LINK_PARAM = 4;
  const link = await buildVisibleLinkPredicate(options.userId, options.role, FIRST_LINK_PARAM);
  const result = await pool.query<Omit<EmailSearchResult, 'sent_at'> & { sent_at: Date | null }>(
    `SELECT m.id, m.subject, m.message_snippet AS snippet, m.from_address, m.sent_at,
            target.record_type, target.record_id
       FROM email_messages m
       JOIN connected_accounts ca ON ca.id = m.connected_account_id
       CROSS JOIN LATERAL (
         SELECT l.record_type, l.record_id
           FROM email_message_links l
          WHERE l.email_message_id = m.id AND ${link.sql}
          ORDER BY l.record_type, l.record_id
          LIMIT 1
       ) target
      WHERE ${messageAccessPredicate('$2')}
        AND (m.subject ILIKE $1 ESCAPE '\\' OR m.message_snippet ILIKE $1 ESCAPE '\\')
      ORDER BY m.sent_at DESC NULLS LAST, m.id
      LIMIT $3`,
    [pattern, options.userId, SEARCH_RESULT_LIMIT, ...link.params],
  );
  return result.rows.map((row) => ({
    ...row,
    sent_at: row.sent_at ? row.sent_at.toISOString() : null,
  }));
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
 * Searches contacts, accounts, deals, leads, and email in parallel for the given query
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
    emails,
  ] = await Promise.all([
    // Contacts: match on name, email, phone, title, department, address fields,
    // and note body_text. DISTINCT prevents duplicates when multiple sources match.
    // Notes join: exclude soft-deleted notes; private notes only visible to their author.
    pool.query<ContactSearchResult>(
      `SELECT DISTINCT c.id, c.first_name, c.last_name, c.email
       FROM contacts c
       LEFT JOIN contact_addresses ca ON ca.contact_id = c.id
       LEFT JOIN notes n ON n.entity_type = 'contact'
         AND n.entity_id = c.id
         AND n.deleted_at IS NULL
         AND (n.visibility != 'private' OR n.created_by = $3)
       WHERE (
         c.first_name ILIKE $1 ESCAPE '\\'
         OR c.last_name ILIKE $1 ESCAPE '\\'
         OR c.email ILIKE $1 ESCAPE '\\'
         OR c.phone ILIKE $1 ESCAPE '\\'
         OR c.title ILIKE $1 ESCAPE '\\'
         OR c.department ILIKE $1 ESCAPE '\\'
         OR ca.address_line1 ILIKE $1 ESCAPE '\\'
         OR ca.address_line2 ILIKE $1 ESCAPE '\\'
         OR ca.city ILIKE $1 ESCAPE '\\'
         OR ca.state_region ILIKE $1 ESCAPE '\\'
         OR ca.postal_code ILIKE $1 ESCAPE '\\'
         OR ca.country ILIKE $1 ESCAPE '\\'
         OR n.body_text ILIKE $1 ESCAPE '\\'
       )
         AND ($2 OR c.owner_id = $3)
       ORDER BY c.last_name, c.first_name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Accounts: match on name, industry, website, and note body_text.
    // Notes join: exclude soft-deleted notes; private notes only visible to their author.
    pool.query<AccountSearchResult>(
      `SELECT DISTINCT ac.id, ac.name
       FROM accounts ac
       LEFT JOIN notes n ON n.entity_type = 'account'
         AND n.entity_id = ac.id
         AND n.deleted_at IS NULL
         AND (n.visibility != 'private' OR n.created_by = $3)
       WHERE (
         ac.name ILIKE $1 ESCAPE '\\'
         OR ac.industry ILIKE $1 ESCAPE '\\'
         OR ac.website ILIKE $1 ESCAPE '\\'
         OR n.body_text ILIKE $1 ESCAPE '\\'
       )
         AND ($2 OR ac.owner_id = $3)
       ORDER BY ac.name
       LIMIT $4`,
      [pattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Deals: match on name, stage, loss_reason, currency, numeric value, and note body_text.
    // Notes join: exclude soft-deleted notes; private notes only visible to their author.
    pool.query<DealSearchResult>(
      `SELECT DISTINCT d.id, d.name, d.stage
       FROM deals d
       LEFT JOIN notes n ON n.entity_type = 'deal'
         AND n.entity_id = d.id
         AND n.deleted_at IS NULL
         AND (n.visibility != 'private' OR n.created_by = $4)
       WHERE (
         d.name ILIKE $1 ESCAPE '\\'
         OR d.stage ILIKE $1 ESCAPE '\\'
         OR d.loss_reason ILIKE $1 ESCAPE '\\'
         OR d.currency ILIKE $1 ESCAPE '\\'
         OR d.value::text ILIKE $2 ESCAPE '\\'
         OR n.body_text ILIKE $1 ESCAPE '\\'
       )
         AND ($3 OR d.owner_id = $4)
       ORDER BY d.name
       LIMIT $5`,
      [pattern, valuePattern, isAdmin, options.userId, SEARCH_RESULT_LIMIT],
    ),

    // Leads: match on name, email, company, phone, inline notes field,
    // disqualification_reason, and note body_text from the notes table.
    // Notes join: exclude soft-deleted notes; private notes only visible to their author.
    pool.query<LeadSearchResult>(
      `SELECT DISTINCT l.id, l.first_name, l.last_name, l.email, l.company_name
       FROM leads l
       LEFT JOIN notes n ON n.entity_type = 'lead'
         AND n.entity_id = l.id
         AND n.deleted_at IS NULL
         AND (n.visibility != 'private' OR n.created_by = $3)
       WHERE (
         l.first_name ILIKE $1 ESCAPE '\\'
         OR l.last_name ILIKE $1 ESCAPE '\\'
         OR l.email ILIKE $1 ESCAPE '\\'
         OR l.company_name ILIKE $1 ESCAPE '\\'
         OR l.phone ILIKE $1 ESCAPE '\\'
         OR l.notes ILIKE $1 ESCAPE '\\'
         OR l.disqualification_reason ILIKE $1 ESCAPE '\\'
         OR n.body_text ILIKE $1 ESCAPE '\\'
       )
         AND ($2 OR l.owner_id = $3)
       ORDER BY l.first_name, l.last_name
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
    searchEmails(pattern, options),
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
    emails,
  };
}
