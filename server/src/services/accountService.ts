/**
 * Account service — business logic for account CRUD operations.
 * All database access for accounts goes through this module.
 */

import pool from '../db.js';
import type {
  CreateAccountInput,
  UpdateAccountInput,
} from '@minicrm/shared/schemas/accountSchema.js';

/** Columns that may be updated via updateAccount — guards against SQL injection from dynamic field names */
const ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateAccountInput> = new Set([
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

/** Options for filtering the accounts list */
interface ListAccountsOptions {
  /** When provided, only accounts with this owner_id are returned */
  ownerId?: string;
}

/**
 * Creates a new account record.
 *
 * @param params - Account fields plus the owner's user ID
 * @returns The inserted account row
 */
export async function createAccount(
  params: CreateAccountInput & { owner_id: string },
): Promise<AccountRow> {
  const { name, industry, website, employee_range, revenue_range, owner_id } = params;

  const result = await pool.query<AccountRow>(
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

  return result.rows[0];
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
 * Returns all accounts, optionally scoped to a single owner.
 *
 * @param options - Optional filter; ownerId restricts results to that owner
 * @returns Array of account rows ordered by created_at ascending
 */
export async function listAccounts(options: ListAccountsOptions = {}): Promise<AccountRow[]> {
  if (options.ownerId) {
    const result = await pool.query<AccountRow>(
      'SELECT * FROM accounts WHERE owner_id = $1 ORDER BY created_at ASC',
      [options.ownerId],
    );
    return result.rows;
  }

  const result = await pool.query<AccountRow>('SELECT * FROM accounts ORDER BY created_at ASC');
  return result.rows;
}

/**
 * Updates one or more fields on an existing account.
 *
 * @param id - Account UUID
 * @param params - Fields to update (at least one required)
 * @returns The updated account row, or null if not found
 */
export async function updateAccount(
  id: string,
  params: UpdateAccountInput,
): Promise<AccountRow | null> {
  const fields = (Object.keys(params) as (keyof UpdateAccountInput)[]).filter((field) =>
    ALLOWED_UPDATE_FIELDS.has(field),
  );

  // Build dynamic SET clause: name = $2, industry = $3, ...
  const setClauses = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');

  const result = await pool.query<AccountRow>(
    `UPDATE accounts
     SET ${setClauses}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...fields.map((f) => params[f])],
  );

  return result.rows[0] ?? null;
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
