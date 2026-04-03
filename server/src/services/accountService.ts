/**
 * Account service — business logic for account CRUD operations.
 * All database access for accounts goes through this module.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CreateAccountInput,
  UpdateAccountInput,
} from '@minicrm/shared/schemas/accountSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';

/** Columns that may be updated via updateAccount — guards against SQL injection from dynamic field names */
const ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof Omit<UpdateAccountInput, 'contact_ids'>> = new Set([
  'name',
  'industry',
  'website',
  'employee_range',
  'revenue_range',
  'owner_id',
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
  created_at: Date;
  updated_at: Date;
}

/** Columns that may be used for ORDER BY in listAccounts */
export const ACCOUNT_SORT_COLUMNS = ['created_at', 'name'] as const;
export type AccountSortColumn = (typeof ACCOUNT_SORT_COLUMNS)[number];

/** Options for filtering and paginating the accounts list */
interface ListAccountsOptions {
  /** When provided, only accounts with this owner_id are returned */
  ownerId?: string;
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
  /** Column to sort by; defaults to 'created_at' */
  sort?: AccountSortColumn;
  /** Sort direction; defaults to 'ASC' */
  dir?: 'ASC' | 'DESC';
  /** 1-based page number; defaults to 1 */
  page?: number;
  /** Records per page; defaults to 50 */
  limit?: number;
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
    // Link the specified contacts to this account.
    // Only contacts that are currently unlinked or already linked to this account
    // are updated — contacts owned by a different account are left untouched.
    await client.query(
      `UPDATE contacts
       SET account_id = $1, updated_at = now()
       WHERE id = ANY($2::uuid[])
         AND (account_id IS NULL OR account_id = $1)`,
      [accountId, contactIds],
    );
  }
}

/**
 * Creates a new account record, optionally linking contacts atomically.
 *
 * @param params - Account fields plus the owner's user ID and optional contact_ids
 * @returns The inserted account row
 */
export async function createAccount(
  params: CreateAccountInput & { owner_id: string },
): Promise<AccountRow> {
  const { name, industry, website, employee_range, revenue_range, owner_id, contact_ids } = params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<AccountRow>(
      `INSERT INTO accounts (name, industry, website, employee_range, revenue_range, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        name,
        industry ?? null,
        website ?? null,
        employee_range ?? null,
        revenue_range ?? null,
        owner_id,
      ],
    );

    const account = result.rows[0];

    if (contact_ids && contact_ids.length > 0) {
      await setAccountContacts(account.id, contact_ids, client);
    }

    await client.query('COMMIT');
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
  const result = await pool.query<AccountRow>('SELECT * FROM accounts WHERE id = $1 LIMIT 1', [id]);

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

  if (options.search) {
    values.push(`%${options.search}%`);
    conditions.push(`name ILIKE $${values.length}`);
  }

  if (options.industry) {
    values.push(`%${options.industry}%`);
    conditions.push(`industry ILIKE $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Allowlist-validated sort column and direction (MINCRM-68)
  const sortCol = (ACCOUNT_SORT_COLUMNS as readonly string[]).includes(options.sort ?? '')
    ? options.sort!
    : 'created_at';
  const sortDir = options.dir === 'DESC' ? 'DESC' : 'ASC';

  const page = options.page ?? 1;
  const limit = options.limit ?? 50;
  const offset = (page - 1) * limit;

  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM accounts ${whereClause}`, values),
    pool.query<AccountRow>(
      `SELECT * FROM accounts ${whereClause} ORDER BY ${sortCol} ${sortDir} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
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
 *
 * @param id - Account UUID
 * @param params - Fields to update (at least one required); optional contact_ids replaces current links
 * @returns The updated account row, or null if not found
 */
export async function updateAccount(
  id: string,
  params: UpdateAccountInput,
): Promise<AccountRow | null> {
  const { contact_ids, ...accountParams } = params;

  const fields = (Object.keys(accountParams) as (keyof typeof accountParams)[]).filter((field) =>
    ALLOWED_UPDATE_FIELDS.has(field as keyof Omit<UpdateAccountInput, 'contact_ids'>),
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let account: AccountRow | null = null;

    if (fields.length > 0) {
      // Build dynamic SET clause: name = $2, industry = $3, ...
      const setClauses = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');

      const result = await client.query<AccountRow>(
        `UPDATE accounts
         SET ${setClauses}, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, ...fields.map((f) => accountParams[f as keyof typeof accountParams])],
      );

      account = result.rows[0] ?? null;
    } else {
      // No account fields to update — just fetch the existing row
      const result = await client.query<AccountRow>(
        'SELECT * FROM accounts WHERE id = $1 LIMIT 1',
        [id],
      );
      account = result.rows[0] ?? null;
    }

    if (account && contact_ids !== undefined) {
      await setAccountContacts(account.id, contact_ids, client);
    }

    await client.query('COMMIT');
    return account;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Deletes an account by its UUID.
 * Associated contacts have their account_id set to NULL (not deleted).
 *
 * @param id - Account UUID
 * @returns The deleted account row, or null if not found
 */
export async function deleteAccount(id: string): Promise<AccountRow | null> {
  // Unlink contacts first (though the FK is SET NULL on delete, being explicit is clearer)
  await pool.query('UPDATE contacts SET account_id = NULL WHERE account_id = $1', [id]);

  const result = await pool.query<AccountRow>('DELETE FROM accounts WHERE id = $1 RETURNING *', [
    id,
  ]);

  return result.rows[0] ?? null;
}
