/**
 * Contact service — business logic for contact CRUD operations.
 * All database access for contacts goes through this module.
 */

import pool from '../db.js';
import type {
  CreateContactInput,
  UpdateContactInput,
} from '@minicrm/shared/schemas/contactSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import { fireAutomationTrigger } from './automationService.js';

/** Columns that may be updated via updateContact — guards against SQL injection from dynamic field names */
const ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateContactInput> = new Set([
  'first_name',
  'last_name',
  'email',
  'phone',
  'title',
  'department',
  'account_id',
  'owner_id',
]);

/** Shape of a contact row returned from the database */
export interface ContactRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  title: string | null;
  department: string | null;
  account_id: string | null;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
}

/** Columns that may be used for ORDER BY in listContacts */
export const CONTACT_SORT_COLUMNS = ['created_at', 'first_name', 'last_name', 'email'] as const;
export type ContactSortColumn = (typeof CONTACT_SORT_COLUMNS)[number];

/** Options for filtering and paginating the contacts list */
interface ListContactsOptions {
  /** When provided, only contacts with this owner_id are returned */
  ownerId?: string;
  /** When provided, only contacts linked to this account_id are returned */
  accountId?: string;
  /**
   * When provided, contacts are filtered by a case-insensitive substring match
   * across first_name, last_name, and email.
   */
  search?: string;
  /**
   * When provided, only contacts whose linked account name contains this
   * string (case-insensitive) are returned.
   */
  accountSearch?: string;
  /** Column to sort by; defaults to 'created_at' */
  sort?: ContactSortColumn;
  /** Sort direction; defaults to 'ASC' */
  dir?: 'ASC' | 'DESC';
  /** 1-based page number; defaults to 1 */
  page?: number;
  /** Records per page; defaults to 50 */
  limit?: number;
}

/**
 * Creates a new contact record.
 *
 * @param params - Contact fields plus the owner's user ID
 * @returns The inserted contact row
 */
export async function createContact(
  params: CreateContactInput & { owner_id: string },
): Promise<ContactRow> {
  const { first_name, last_name, email, phone, title, department, account_id, owner_id } = params;

  const result = await pool.query<ContactRow>(
    `INSERT INTO contacts (first_name, last_name, email, phone, title, department, account_id, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      first_name,
      last_name,
      email.toLowerCase(),
      phone ?? null,
      title ?? null,
      department ?? null,
      account_id ?? null,
      owner_id,
    ],
  );

  const contact = result.rows[0];

  // Fire-and-forget: fireAutomationTrigger swallows all internal errors and logs them.
  // Unhandled rejections are caught by the global handler in server.ts (MINCRM-122).
  void fireAutomationTrigger('contact_created', {
    recordId: contact.id,
    recordType: 'contact',
    ownerId: owner_id,
  });

  return contact;
}

/**
 * Finds a contact by email address (case-insensitive).
 * Used for duplicate detection on contact creation.
 *
 * @param email - Email address to search for
 * @param excludeId - Optional contact UUID to exclude (e.g. the contact being updated)
 * @returns The matching contact row, or null if not found
 */
export async function findContactByEmail(
  email: string,
  excludeId?: string,
): Promise<ContactRow | null> {
  if (excludeId) {
    const result = await pool.query<ContactRow>(
      'SELECT * FROM contacts WHERE LOWER(email) = LOWER($1) AND id != $2 LIMIT 1',
      [email, excludeId],
    );
    return result.rows[0] ?? null;
  }

  const result = await pool.query<ContactRow>(
    'SELECT * FROM contacts WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email],
  );
  return result.rows[0] ?? null;
}

/**
 * Finds a contact by its UUID.
 *
 * @param id - Contact UUID
 * @returns The contact row, or null if not found
 */
export async function findContactById(id: string): Promise<ContactRow | null> {
  const result = await pool.query<ContactRow>('SELECT * FROM contacts WHERE id = $1 LIMIT 1', [id]);

  return result.rows[0] ?? null;
}

/**
 * Returns a paginated list of contacts, optionally filtered and sorted.
 *
 * @param options - Filters, sort, and pagination options
 * @returns Paginated response with contact rows and total count
 */
export async function listContacts(
  options: ListContactsOptions = {},
): Promise<PaginatedResponse<ContactRow>> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.ownerId) {
    values.push(options.ownerId);
    conditions.push(`c.owner_id = $${values.length}`);
  }

  if (options.accountId) {
    values.push(options.accountId);
    conditions.push(`c.account_id = $${values.length}`);
  }

  if (options.search) {
    const pattern = `%${options.search}%`;
    values.push(pattern);
    const idx = values.length;
    conditions.push(
      `(c.first_name ILIKE $${idx} OR c.last_name ILIKE $${idx} OR c.email ILIKE $${idx})`,
    );
  }

  const needsAccountJoin = Boolean(options.accountSearch);

  if (options.accountSearch) {
    const pattern = `%${options.accountSearch}%`;
    values.push(pattern);
    conditions.push(`a.name ILIKE $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const fromClause = needsAccountJoin
    ? 'FROM contacts c LEFT JOIN accounts a ON c.account_id = a.id'
    : 'FROM contacts c';

  // Allowlist-validated sort column and direction (MINCRM-68)
  const sortCol = (CONTACT_SORT_COLUMNS as readonly string[]).includes(options.sort ?? '')
    ? options.sort!
    : 'created_at';
  const sortDir = options.dir === 'DESC' ? 'DESC' : 'ASC';

  const page = options.page ?? 1;
  const limit = options.limit ?? 50;
  const offset = (page - 1) * limit;

  // Run count and data queries in parallel (MINCRM-68)
  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM contacts c ${needsAccountJoin ? 'LEFT JOIN accounts a ON c.account_id = a.id' : ''} ${whereClause}`,
      values,
    ),
    pool.query<ContactRow>(
      `SELECT c.* ${fromClause} ${whereClause} ORDER BY c.${sortCol} ${sortDir} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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
 * Updates one or more fields on an existing contact.
 *
 * @param id - Contact UUID
 * @param params - Fields to update (at least one required)
 * @returns The updated contact row, or null if not found
 */
export async function updateContact(
  id: string,
  params: UpdateContactInput,
): Promise<ContactRow | null> {
  const normalized: UpdateContactInput = {
    ...params,
    ...(params.email !== undefined ? { email: params.email.toLowerCase() } : {}),
  };
  const fields = (Object.keys(normalized) as (keyof UpdateContactInput)[]).filter((field) =>
    ALLOWED_UPDATE_FIELDS.has(field),
  );

  // Build dynamic SET clause: first_name = $2, last_name = $3, ...
  const setClauses = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');

  const result = await pool.query<ContactRow>(
    `UPDATE contacts
     SET ${setClauses}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...fields.map((f) => normalized[f])],
  );

  return result.rows[0] ?? null;
}

/**
 * Deletes a contact by its UUID.
 *
 * @param id - Contact UUID
 * @returns The deleted contact row, or null if not found
 */
export async function deleteContact(id: string): Promise<ContactRow | null> {
  const result = await pool.query<ContactRow>('DELETE FROM contacts WHERE id = $1 RETURNING *', [
    id,
  ]);

  return result.rows[0] ?? null;
}
