/**
 * Deal service — business logic for deal CRUD operations.
 * All database access for deals goes through this module.
 */

import pool from '../db.js';
import type { CreateDealInput, UpdateDealInput } from '@minicrm/shared/schemas/dealSchema.js';

/** Columns that may be updated via updateDeal — guards against SQL injection from dynamic field names */
const ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateDealInput> = new Set([
  'name',
  'stage',
  'value',
  'close_date',
  'account_id',
  'owner_id',
  'loss_reason',
]);

/** Shape of a deal row returned from the database */
export interface DealRow {
  id: string;
  name: string;
  stage: string;
  value: string | null; // pg returns numeric as string
  close_date: string | null;
  loss_reason: string | null;
  account_id: string | null;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
}

/** Options for filtering the deals list */
interface ListDealsOptions {
  /** When provided, only deals with this owner_id are returned */
  ownerId?: string;
  /** When provided, only deals linked to this account_id are returned */
  accountId?: string;
}

/**
 * Creates a new deal record.
 *
 * @param params - Deal fields plus the owner's user ID
 * @returns The inserted deal row
 */
export async function createDeal(params: CreateDealInput & { owner_id: string }): Promise<DealRow> {
  const { name, stage, value, close_date, account_id, owner_id } = params;

  const result = await pool.query<DealRow>(
    `INSERT INTO deals (name, stage, value, close_date, account_id, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, stage, value ?? null, close_date ?? null, account_id ?? null, owner_id],
  );

  return result.rows[0];
}

/**
 * Finds a deal by its UUID.
 *
 * @param id - Deal UUID
 * @returns The deal row, or null if not found
 */
export async function findDealById(id: string): Promise<DealRow | null> {
  const result = await pool.query<DealRow>('SELECT * FROM deals WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] ?? null;
}

/**
 * Returns all deals, optionally scoped by owner and/or account.
 *
 * @param options - Optional filters; ownerId and accountId restrict results
 * @returns Array of deal rows ordered by created_at ascending
 */
export async function listDeals(options: ListDealsOptions = {}): Promise<DealRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.ownerId) {
    values.push(options.ownerId);
    conditions.push(`owner_id = $${values.length}`);
  }

  if (options.accountId) {
    values.push(options.accountId);
    conditions.push(`account_id = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query<DealRow>(
    `SELECT * FROM deals ${where} ORDER BY created_at ASC`,
    values,
  );
  return result.rows;
}

/**
 * Updates one or more fields on an existing deal.
 *
 * @param id - Deal UUID
 * @param params - Fields to update (at least one required)
 * @returns The updated deal row, or null if not found
 */
export async function updateDeal(id: string, params: UpdateDealInput): Promise<DealRow | null> {
  const fields = (Object.keys(params) as (keyof UpdateDealInput)[]).filter((field) =>
    ALLOWED_UPDATE_FIELDS.has(field),
  );

  // Build dynamic SET clause: name = $2, stage = $3, ...
  const setClauses = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');

  const result = await pool.query<DealRow>(
    `UPDATE deals
     SET ${setClauses}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...fields.map((f) => params[f])],
  );

  return result.rows[0] ?? null;
}

/**
 * Deletes a deal by its UUID.
 * Associated deal_contacts rows are removed via CASCADE.
 * Linked contacts and accounts are not affected.
 *
 * @param id - Deal UUID
 * @returns The deleted deal row, or null if not found
 */
export async function deleteDeal(id: string): Promise<DealRow | null> {
  const result = await pool.query<DealRow>('DELETE FROM deals WHERE id = $1 RETURNING *', [id]);
  return result.rows[0] ?? null;
}

/** Shape of a contact row joined from deal_contacts */
interface DealContactRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  title: string | null;
}

/**
 * Returns the contacts linked to a deal via the deal_contacts join table.
 *
 * @param dealId - Deal UUID
 * @returns Array of minimal contact rows
 */
export async function listDealContacts(dealId: string): Promise<DealContactRow[]> {
  const result = await pool.query<DealContactRow>(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.title
     FROM contacts c
     INNER JOIN deal_contacts dc ON dc.contact_id = c.id
     WHERE dc.deal_id = $1
     ORDER BY c.last_name ASC, c.first_name ASC`,
    [dealId],
  );
  return result.rows;
}
