/**
 * Account service — business logic for account CRUD operations.
 * All database access for accounts goes through this module.
 */

import pool from '../db.js';
import type { Pool, PoolClient } from 'pg';
import type {
  CreateAccountInput,
  UpdateAccountInput,
} from '@minicrm/shared/schemas/accountSchema.js';
import type { AccountType } from '@minicrm/shared/schemas/accountSchema.js';
import type { AccountHealthState } from '@minicrm/shared/schemas/accountHealthScoreSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import { writeAuditEntry, writeAuditEntries, diffFields } from './auditService.js';
import type { AuditActor, AuditEntryInput } from './auditService.js';
import { dispatchWebhookEvent } from './webhookService.js';
import { setRlsUserId, withRlsQuery } from './rlsContextService.js';
import { softDeleteNotesByEntity } from './noteService.js';
import { deleteFindingsForDeletedEntity } from './dataHygieneService.js';

const SYSTEM_ACTOR: AuditActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

/** Columns that may be updated via updateAccount — guards against SQL injection from dynamic field names */
const ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof Omit<UpdateAccountInput, 'contact_ids'>> = new Set([
  'name',
  'industry',
  'website',
  'employee_range',
  'revenue_range',
  'owner_id',
  'account_type',
  'parent_account_id',
]);

/** Shape of an account row returned from the database */
export interface AccountRow {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  employee_range: string | null;
  revenue_range: string | null;
  owner_id: string;
  /** Account classification type */
  account_type: AccountType | null;
  /** UUID of the parent account */
  parent_account_id: string | null;
  created_at: Date;
  updated_at: Date;
  /** Optimistic lock version */
  version: number;
  /** Tags attached to this account — only populated in list responses */
  tags?: Array<{ id: string; name: string }>;
  /** Cached relationship health badge — only populated in list responses; null if no score computed yet */
  health_score?: { score: number; state: AccountHealthState; single_threaded_risk: boolean } | null;
}

/** Columns that may be used for ORDER BY in listAccounts */
export const ACCOUNT_SORT_COLUMNS = ['created_at', 'name'] as const;
export type AccountSortColumn = (typeof ACCOUNT_SORT_COLUMNS)[number];

/** Options for filtering and paginating the accounts list */
interface ListAccountsOptions {
  /** When provided, only accounts with this owner_id are returned */
  ownerId?: string;
  /** When provided, only accounts whose owner_id is in this set are returned */
  ownerIds?: string[];
  /**
   * When provided, accounts are filtered by a case-insensitive substring match
   * on the account name.
   */
  search?: string;
  /**
   * When provided, only accounts whose industry contains this string
   * (case-insensitive substring match) are returned.
   */
  industry?: string;
  /** When provided, only accounts with this account_type are returned */
  accountType?: AccountType;
  /** Column to sort by; defaults to 'created_at' */
  sort?: AccountSortColumn;
  /** Sort direction; defaults to 'ASC' */
  dir?: 'ASC' | 'DESC';
  /** 1-based page number; defaults to 1 */
  page?: number;
  /** Records per page; defaults to 50 */
  limit?: number;
  /** When provided, only accounts tagged with at least one of these tag IDs are returned */
  tagIds?: string[];
  /** When provided, only accounts whose cached relationship health state matches one of these */
  healthStatuses?: AccountHealthState[];
}

/**
 * Checks whether setting parentId as the parent of accountId would create a circular chain.
 * Traverses upward from parentId until it either reaches a root (no parent) or finds accountId.
 * Must be called within a transaction if called alongside other account writes.
 *
 * @param accountId - The account being updated
 * @param parentId - The proposed parent account UUID
 * @param client - pg client (may be a pool or PoolClient)
 * @returns true if a circular chain would be created, false otherwise
 */
export async function wouldCreateCircularParent(
  accountId: string,
  parentId: string,
  client: Pool | PoolClient,
): Promise<boolean> {
  if (accountId === parentId) return true;

  let currentId: string | null = parentId;
  // Traverse upward — a chain deeper than the total account count is impossible,
  // but cap at 100 to guard against extreme cases.
  const MAX_DEPTH = 100;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const result: { rows: Array<{ parent_account_id: string | null }> } = await client.query<{
      parent_account_id: string | null;
    }>('SELECT parent_account_id FROM accounts WHERE id = $1 LIMIT 1', [currentId]);
    const parentAccountId: string | null = result.rows[0]?.parent_account_id ?? null;
    if (parentAccountId === null) return false;
    if (parentAccountId === accountId) return true;
    currentId = parentAccountId;
  }
  return false;
}

/**
 * Atomically sets the contacts linked to an account.
 * Contacts in contactIds have their account_id set to accountId.
 * Contacts previously linked to accountId but not in contactIds are unlinked (account_id = NULL).
 * Must be called within a transaction (client must be provided).
 *
 * @param accountId - Account UUID
 * @param contactIds - Array of contact UUIDs to link; empty array unlinks all
 * @param client - Active pg PoolClient from the caller's transaction
 */
export async function setAccountContacts(
  accountId: string,
  contactIds: string[],
  client: PoolClient,
): Promise<void> {
  // Unlink any contacts currently linked to this account that are not in contactIds
  await client.query(
    `UPDATE contacts
     SET account_id = NULL, updated_at = now()
     WHERE account_id = $1
       AND id != ALL($2::uuid[])`,
    [accountId, contactIds],
  );

  if (contactIds.length > 0) {
    // The guard stays on the write so a concurrent link cannot be stolen between a
    // check and an unguarded update; the conflict is derived from what it refused.
    const linked = await client.query<{ id: string }>(
      `UPDATE contacts
       SET account_id = $1, updated_at = now()
       WHERE id = ANY($2::uuid[])
         AND (account_id IS NULL OR account_id = $1)
       RETURNING id`,
      [accountId, contactIds],
    );

    // Every id the write refused is a refusal, never a silent drop — that silent drop
    // is the defect this replaced. A duplicate id is not refused: ANY matches its row
    // once, so the id is in linkedIds even though the array was longer.
    const linkedIds = new Set(linked.rows.map((row) => row.id));
    const unlinked = contactIds.filter((id) => !linkedIds.has(id));
    if (unlinked.length > 0) {
      // Which ones are visibly held elsewhere, versus gone or hidden by RLS from this
      // caller — the same predicate hides a row from this SELECT and from the UPDATE
      // above, so an unlinked id that does not appear here is unknowable, not absent.
      const conflicting = await client.query<{ id: string }>(
        `SELECT id FROM contacts
         WHERE id = ANY($2::uuid[]) AND account_id IS NOT NULL AND account_id != $1`,
        [accountId, unlinked],
      );
      const conflictingIds = conflicting.rows.map((row) => row.id);
      throw Object.assign(
        new Error(
          conflictingIds.length > 0
            ? 'Contact is already linked to a different account'
            : 'Contact could not be linked — it no longer exists or is not yours to link',
        ),
        {
          code: conflictingIds.length > 0 ? 'CONTACT_LINKED_ELSEWHERE' : 'CONTACT_NOT_LINKABLE',
          // Not surfaced in the response — kept for server logs when diagnosing a refusal.
          conflictingContactIds: conflictingIds.length > 0 ? conflictingIds : unlinked,
        },
      );
    }
  }
}

/**
 * Creates a new account record, optionally linking contacts atomically.
 * Writes an audit entry in the same transaction.
 *
 * @param params - Account fields plus the owner's user ID and optional contact_ids
 * @param actor - User performing the action (for audit log)
 * @returns The inserted account row
 */
export async function createAccount(
  params: CreateAccountInput & { owner_id: string },
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<AccountRow> {
  const {
    name,
    industry,
    website,
    employee_range,
    revenue_range,
    owner_id,
    contact_ids,
    account_type,
    parent_account_id,
  } = params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    // Validate no circular parent chain before inserting
    if (parent_account_id) {
      // Use the client (within the transaction) to avoid TOCTOU races
      const isCircular = await wouldCreateCircularParent(
        // New account has no id yet — pass a sentinel that can never match any real row
        '00000000-0000-0000-0000-000000000000',
        parent_account_id,
        client,
      );
      if (isCircular) {
        throw Object.assign(new Error('Circular parent chain detected'), {
          code: 'CIRCULAR_PARENT',
        });
      }
    }

    const result = await client.query<AccountRow>(
      `INSERT INTO accounts (name, industry, website, employee_range, revenue_range, owner_id, account_type, parent_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        name,
        industry ?? null,
        website ?? null,
        employee_range ?? null,
        revenue_range ?? null,
        owner_id,
        account_type ?? null,
        parent_account_id ?? null,
      ],
    );

    const account = result.rows[0];

    if (contact_ids && contact_ids.length > 0) {
      await setAccountContacts(account.id, contact_ids, client);
    }

    // Audit: record created
    await writeAuditEntry(client, {
      recordType: 'account',
      recordId: account.id,
      recordName: account.name,
      eventType: 'created',
      changedById: actor.id,
      changedByName: actor.name,
      source: actor.source ?? null,
    });

    await client.query('COMMIT');

    void dispatchWebhookEvent('account.created', account as unknown as Record<string, unknown>);

    return account;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Finds an account by its UUID.
 *
 * @param id - Account UUID
 * @returns The account row, or null if not found
 */
export async function findAccountById(id: string): Promise<AccountRow | null> {
  const result = await withRlsQuery((client) =>
    client.query<AccountRow>('SELECT * FROM accounts WHERE id = $1 LIMIT 1', [id]),
  );

  return result.rows[0] ?? null;
}

/**
 * Finds an account by exact, case-insensitive name match. Used for duplicate
 * detection on account create — mirrors findContactByEmail's role for
 * contacts.
 *
 * @param name - Account name to match exactly (case-insensitive)
 * @returns The matching account row, or null if none exists
 */
export async function findAccountByExactName(name: string): Promise<AccountRow | null> {
  const result = await withRlsQuery((client) =>
    client.query<AccountRow>('SELECT * FROM accounts WHERE lower(name) = lower($1) LIMIT 1', [
      name,
    ]),
  );

  return result.rows[0] ?? null;
}

/**
 * Returns a paginated list of accounts, optionally filtered and sorted.
 *
 * @param options - Filters, sort, and pagination options
 * @returns Paginated response with account rows and total count
 */
export async function listAccounts(
  options: ListAccountsOptions = {},
): Promise<PaginatedResponse<AccountRow>> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.ownerId) {
    values.push(options.ownerId);
    conditions.push(`owner_id = $${values.length}`);
  }

  if (options.ownerIds && options.ownerIds.length > 0) {
    values.push(options.ownerIds);
    conditions.push(`owner_id = ANY($${values.length}::uuid[])`);
  }

  if (options.search) {
    values.push(`%${options.search}%`);
    conditions.push(`name ILIKE $${values.length}`);
  }

  if (options.industry) {
    values.push(`%${options.industry}%`);
    conditions.push(`industry ILIKE $${values.length}`);
  }

  if (options.accountType) {
    values.push(options.accountType);
    conditions.push(`account_type = $${values.length}`);
  }

  // Tag filter — any-match: account must have at least one of the given tag IDs
  if (options.tagIds && options.tagIds.length > 0) {
    const placeholders = options.tagIds.map((_, i) => `$${values.length + i + 1}`).join(', ');
    options.tagIds.forEach((tid) => values.push(tid));
    conditions.push(
      `EXISTS (SELECT 1 FROM account_tags at2 WHERE at2.account_id = accounts.id AND at2.tag_id IN (${placeholders}))`,
    );
  }

  // Relationship health filter — "Show At Risk or Dormant accounts"
  if (options.healthStatuses && options.healthStatuses.length > 0) {
    values.push(options.healthStatuses);
    conditions.push(
      `EXISTS (SELECT 1 FROM account_health_scores ahs WHERE ahs.account_id = accounts.id AND ahs.state = ANY($${values.length}::text[]))`,
    );
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Allowlist-validated sort column and direction
  const sortCol = (ACCOUNT_SORT_COLUMNS as readonly string[]).includes(options.sort ?? '')
    ? options.sort!
    : 'created_at';
  const sortDir = options.dir === 'DESC' ? 'DESC' : 'ASC';

  const page = options.page ?? 1;
  const limit = options.limit ?? 50;
  const offset = (page - 1) * limit;

  // Embed tags via lateral subquery — avoids N+1 without separate API calls
  const tagsSubquery = `
    COALESCE((
      SELECT JSON_AGG(JSON_BUILD_OBJECT('id', t.id, 'name', t.name) ORDER BY t.name)
      FROM account_tags at2 INNER JOIN tags t ON t.id = at2.tag_id
      WHERE at2.account_id = accounts.id
    ), '[]'::json) AS tags`;

  // Embed the cached health score badge via a scalar subquery — avoids N+1
  // without a separate request per row on the list view.
  const healthScoreSubquery = `
    (SELECT JSON_BUILD_OBJECT(
       'score', ahs.score, 'state', ahs.state, 'single_threaded_risk', ahs.single_threaded_risk
     ) FROM account_health_scores ahs WHERE ahs.account_id = accounts.id) AS health_score`;

  const [countResult, dataResult] = await Promise.all([
    withRlsQuery((client) =>
      client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM accounts ${whereClause}`,
        values,
      ),
    ),
    withRlsQuery((client) =>
      client.query<AccountRow>(
        `SELECT *, ${tagsSubquery}, ${healthScoreSubquery} FROM accounts ${whereClause} ORDER BY ${sortCol} ${sortDir} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
    ),
  ]);

  return {
    data: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  };
}

/**
 * Updates one or more fields on an existing account, optionally updating linked contacts atomically.
 * Writes per-field audit entries in the same transaction.
 *
 * @param id - Account UUID
 * @param params - Fields to update (at least one required); optional contact_ids replaces current links
 * @param actor - User performing the action (for audit log)
 * @param before - Snapshot of the account before update (used for diff)
 * @returns The updated account row, or null if not found
 */
export async function updateAccount(
  id: string,
  params: UpdateAccountInput,
  actor: AuditActor = SYSTEM_ACTOR,
  before?: AccountRow,
): Promise<AccountRow | null> {
  const { contact_ids, version, ...accountParams } = params;

  const fields = (Object.keys(accountParams) as (keyof typeof accountParams)[]).filter((field) =>
    ALLOWED_UPDATE_FIELDS.has(field as keyof Omit<UpdateAccountInput, 'contact_ids'>),
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    // Validate no circular parent chain inside the transaction to avoid TOCTOU races
    if (accountParams.parent_account_id) {
      const isCircular = await wouldCreateCircularParent(
        id,
        accountParams.parent_account_id,
        client,
      );
      if (isCircular) {
        throw Object.assign(new Error('Circular parent chain detected'), {
          code: 'CIRCULAR_PARENT',
        });
      }
    }

    let account: AccountRow | null = null;

    if (fields.length > 0) {
      // Build dynamic SET clause: name = $2, industry = $3, ..., version = version + 1
      // $1=id, $2...$N=field values, $(N+1)=version
      const setClauses = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
      const versionParam = fields.length + 2;

      const result = await client.query<AccountRow>(
        `UPDATE accounts
         SET ${setClauses}, updated_at = now(), version = version + 1
         WHERE id = $1 AND version = $${versionParam}
         RETURNING *`,
        [id, ...fields.map((f) => accountParams[f as keyof typeof accountParams]), version],
      );

      if (result.rowCount === 0) {
        // Distinguish NOT_FOUND from version mismatch
        const check = await client.query<{ id: string }>('SELECT id FROM accounts WHERE id = $1', [
          id,
        ]);
        if (check.rows.length === 0) {
          await client.query('ROLLBACK');
          return null;
        }
        throw Object.assign(
          new Error(
            'This record was modified by another user while you were editing it. Please reload to see the latest version.',
          ),
          {
            code: 'OPTIMISTIC_LOCK_CONFLICT',
            entity: 'account',
            recordId: id,
          },
        );
      }

      account = result.rows[0] ?? null;
    } else {
      // No account fields to update — just fetch the existing row and check version
      const result = await client.query<AccountRow>(
        'SELECT * FROM accounts WHERE id = $1 LIMIT 1',
        [id],
      );
      if (!result.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      if (result.rows[0].version !== version) {
        throw Object.assign(
          new Error(
            'This record was modified by another user while you were editing it. Please reload to see the latest version.',
          ),
          {
            code: 'OPTIMISTIC_LOCK_CONFLICT',
            entity: 'account',
            recordId: id,
          },
        );
      }
      account = result.rows[0];
    }

    if (account && contact_ids !== undefined) {
      await setAccountContacts(account.id, contact_ids, client);
    }

    if (account && before) {
      // Audit: per-field diff
      const auditBase = {
        recordType: 'account' as const,
        recordId: account.id,
        recordName: account.name,
        changedById: actor.id,
        changedByName: actor.name,
        source: actor.source ?? null,
      };

      const fieldEntries = diffFields(
        before as unknown as Record<string, unknown>,
        account as unknown as Record<string, unknown>,
        auditBase,
      );

      const ownershipEntries: AuditEntryInput[] = [];
      if (params.owner_id !== undefined && params.owner_id !== before.owner_id) {
        ownershipEntries.push({ ...auditBase, eventType: 'ownership_reassigned' });
      }

      await writeAuditEntries(client, [...fieldEntries, ...ownershipEntries]);
    }

    await client.query('COMMIT');

    if (account) {
      void dispatchWebhookEvent(
        'account.updated',
        account as unknown as Record<string, unknown>,
        before ? (before as unknown as Record<string, unknown>) : undefined,
      );
    }

    return account;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Shape of an account row enriched with display names and counts for CSV export */
export interface AccountExportRow {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  employee_range: string | null;
  revenue_range: string | null;
  account_type: string | null;
  parent_account_name: string | null;
  owner_name: string;
  contact_count: string;
  deal_count: string;
  created_at: Date;
  updated_at: Date;
}

/** Options for filtering accounts to export (mirrors list options minus pagination) */
interface ExportAccountsOptions {
  /** When provided, only accounts with this owner_id are returned */
  ownerId?: string;
  /** Case-insensitive substring match on account name */
  search?: string;
  /** Case-insensitive substring match on industry */
  industry?: string;
}

/**
 * Returns all accounts matching the given filters, enriched with owner name,
 * contact count, and deal count, for CSV export. No pagination.
 *
 * @param options - Filters (same semantics as listAccounts, minus pagination/sort)
 * @returns Array of enriched account rows ordered by name ASC
 */
export async function exportAccountsForCsv(
  options: ExportAccountsOptions = {},
): Promise<AccountExportRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.ownerId) {
    values.push(options.ownerId);
    conditions.push(`a.owner_id = $${values.length}`);
  }

  if (options.search) {
    values.push(`%${options.search}%`);
    conditions.push(`a.name ILIKE $${values.length}`);
  }

  if (options.industry) {
    values.push(`%${options.industry}%`);
    conditions.push(`a.industry ILIKE $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await withRlsQuery((client) =>
    client.query<AccountExportRow>(
      `SELECT
       a.id,
       a.name,
       a.industry,
       a.website,
       a.employee_range,
       a.revenue_range,
       a.account_type,
       p.name AS parent_account_name,
       u.name AS owner_name,
       (SELECT COUNT(*) FROM contacts c WHERE c.account_id = a.id)::text AS contact_count,
       (SELECT COUNT(*) FROM deals d WHERE d.account_id = a.id)::text AS deal_count,
       a.created_at,
       a.updated_at
     FROM accounts a
     JOIN users u ON a.owner_id = u.id
     LEFT JOIN accounts p ON a.parent_account_id = p.id
     ${whereClause}
     ORDER BY a.name ASC`,
      values,
    ),
  );

  return result.rows;
}

/**
 * Deletes an account by its UUID and writes an audit entry in the same transaction.
 * Associated contacts have their account_id set to NULL (not deleted).
 *
 * @param id - Account UUID
 * @param actor - User performing the action (for audit log)
 * @param recordName - Display name of the account (used for audit log after deletion)
 * @returns The deleted account row, or null if not found
 */
export async function deleteAccount(
  id: string,
  actor: AuditActor = SYSTEM_ACTOR,
  recordName = '',
): Promise<AccountRow | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    // Soft-delete notes before removing the parent row to prevent orphaned active notes
    await softDeleteNotesByEntity(client, 'account', id);
    await deleteFindingsForDeletedEntity(client, 'account', id);

    // Unlink contacts first (though the FK is SET NULL on delete, being explicit is clearer)
    await client.query('UPDATE contacts SET account_id = NULL WHERE account_id = $1', [id]);

    const result = await client.query<AccountRow>(
      'DELETE FROM accounts WHERE id = $1 RETURNING *',
      [id],
    );

    const account = result.rows[0] ?? null;

    if (account) {
      // Audit: record deleted
      await writeAuditEntry(client, {
        recordType: 'account',
        recordId: id,
        recordName,
        eventType: 'deleted',
        changedById: actor.id,
        changedByName: actor.name,
        source: actor.source ?? null,
      });
    }

    await client.query('COMMIT');

    if (account) {
      void dispatchWebhookEvent('account.deleted', {
        id: account.id,
        name: account.name,
      });
    }

    return account;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Returns all direct child accounts (subsidiaries) of the given account.
 * Used on the account detail page to display the subsidiary list.
 *
 * @param parentId - UUID of the parent account
 * @returns Array of child account rows
 */
export async function listChildAccounts(parentId: string): Promise<AccountRow[]> {
  const result = await pool.query<AccountRow>(
    'SELECT * FROM accounts WHERE parent_account_id = $1 ORDER BY name ASC',
    [parentId],
  );
  return result.rows;
}

/**
 * Searches accounts by name (case-insensitive substring) for type-ahead use.
 * Excludes the account with excludeId to prevent self-parenting.
 *
 * @param query - Substring to match against account name
 * @param excludeId - Account UUID to exclude from results
 * @param limit - Maximum number of results (defaults to 10)
 * @returns Array of matching account rows
 */
export async function searchAccounts(
  query: string,
  excludeId?: string,
  limit = 10,
): Promise<AccountRow[]> {
  const pattern = `%${query}%`;
  const result = excludeId
    ? await withRlsQuery((client) =>
        client.query<AccountRow>(
          'SELECT * FROM accounts WHERE name ILIKE $1 AND id != $2 ORDER BY name ASC LIMIT $3',
          [pattern, excludeId, limit],
        ),
      )
    : await withRlsQuery((client) =>
        client.query<AccountRow>(
          'SELECT * FROM accounts WHERE name ILIKE $1 ORDER BY name ASC LIMIT $2',
          [pattern, limit],
        ),
      );
  return result.rows;
}
