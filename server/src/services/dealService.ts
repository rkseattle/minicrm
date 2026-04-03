/**
 * Deal service — business logic for deal CRUD operations.
 * All database access for deals goes through this module.
 */

import pool from '../db.js';
import type { CreateDealInput, UpdateDealInput } from '@minicrm/shared/schemas/dealSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import { fireAutomationTrigger } from './automationService.js';

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

/** Columns that may be used for ORDER BY in listDeals */
export const DEAL_SORT_COLUMNS = ['created_at', 'name', 'close_date', 'value'] as const;
export type DealSortColumn = (typeof DEAL_SORT_COLUMNS)[number];

/** Options for filtering and paginating the deals list */
interface ListDealsOptions {
  /** When provided, only deals with this owner_id are returned */
  ownerId?: string;
  /** When provided, only deals linked to this account_id are returned */
  accountId?: string;
  /** Column to sort by; defaults to 'created_at' */
  sort?: DealSortColumn;
  /** Sort direction; defaults to 'ASC' */
  dir?: 'ASC' | 'DESC';
  /** 1-based page number; defaults to 1 */
  page?: number;
  /** Records per page; defaults to 50 */
  limit?: number;
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
     RETURNING id, name, stage, value, close_date::text, loss_reason, account_id, owner_id, created_at, updated_at`,
    [name, stage, value ?? null, close_date ?? null, account_id ?? null, owner_id],
  );

  const deal = result.rows[0];

  // Fire the deal_created automation trigger after successful insert
  await fireAutomationTrigger('deal_created', {
    recordId: deal.id,
    recordType: 'deal',
    ownerId: owner_id,
  });

  return deal;
}

/**
 * Finds a deal by its UUID.
 *
 * @param id - Deal UUID
 * @returns The deal row, or null if not found
 */
export async function findDealById(id: string): Promise<DealRow | null> {
  const result = await pool.query<DealRow>(
    'SELECT id, name, stage, value, close_date::text, loss_reason, account_id, owner_id, created_at, updated_at FROM deals WHERE id = $1 LIMIT 1',
    [id],
  );
  return result.rows[0] ?? null;
}

/** SELECT columns used in deal list queries */
const DEAL_SELECT =
  'id, name, stage, value, close_date::text, loss_reason, account_id, owner_id, created_at, updated_at';

/**
 * Returns a paginated list of deals, optionally scoped by owner and/or account.
 *
 * @param options - Filters, sort, and pagination options
 * @returns Paginated response with deal rows and total count
 */
export async function listDeals(
  options: ListDealsOptions = {},
): Promise<PaginatedResponse<DealRow>> {
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

  // Allowlist-validated sort column and direction (MINCRM-68)
  const sortCol = (DEAL_SORT_COLUMNS as readonly string[]).includes(options.sort ?? '')
    ? options.sort!
    : 'created_at';
  const sortDir = options.dir === 'DESC' ? 'DESC' : 'ASC';

  const page = options.page ?? 1;
  const limit = options.limit ?? 50;
  const offset = (page - 1) * limit;

  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM deals ${where}`, values),
    pool.query<DealRow>(
      `SELECT ${DEAL_SELECT} FROM deals ${where} ORDER BY ${sortCol} ${sortDir} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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

  // Guard against empty field list — would produce invalid SQL
  if (fields.length === 0) {
    return findDealById(id);
  }

  // Capture the current stage before updating so we can detect an actual change
  const previousStage = params.stage !== undefined ? (await findDealById(id))?.stage : undefined;

  // Build dynamic SET clause: name = $2, stage = $3, ...
  const setClauses = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');

  const result = await pool.query<DealRow>(
    `UPDATE deals
     SET ${setClauses}, updated_at = now()
     WHERE id = $1
     RETURNING id, name, stage, value, close_date::text, loss_reason, account_id, owner_id, created_at, updated_at`,
    [id, ...fields.map((f) => params[f])],
  );

  const deal = result.rows[0] ?? null;

  // Fire the deal_stage_changed automation trigger only when the stage genuinely changed
  if (deal && params.stage !== undefined && deal.stage !== previousStage) {
    await fireAutomationTrigger('deal_stage_changed', {
      recordId: deal.id,
      recordType: 'deal',
      ownerId: deal.owner_id,
      newStage: deal.stage,
    });
  }

  return deal;
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
  const result = await pool.query<DealRow>(
    'DELETE FROM deals WHERE id = $1 RETURNING id, name, stage, value, close_date::text, loss_reason, account_id, owner_id, created_at, updated_at',
    [id],
  );
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

/**
 * Links a contact to a deal via the deal_contacts join table.
 * If the link already exists, this is a no-op (ON CONFLICT DO NOTHING).
 *
 * @param dealId - Deal UUID
 * @param contactId - Contact UUID
 */
export async function linkContactToDeal(dealId: string, contactId: string): Promise<void> {
  await pool.query(
    'INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [dealId, contactId],
  );
}

/**
 * Removes the link between a contact and a deal.
 * If the link does not exist, this is a no-op.
 *
 * @param dealId - Deal UUID
 * @param contactId - Contact UUID
 */
export async function unlinkContactFromDeal(dealId: string, contactId: string): Promise<void> {
  await pool.query('DELETE FROM deal_contacts WHERE deal_id = $1 AND contact_id = $2', [
    dealId,
    contactId,
  ]);
}

/**
 * Returns all deals linked to a contact via the deal_contacts join table.
 *
 * @param contactId - Contact UUID
 * @returns Array of deal rows ordered by created_at ascending
 */
export async function listContactDeals(contactId: string): Promise<DealRow[]> {
  const result = await pool.query<DealRow>(
    `SELECT d.id, d.name, d.stage, d.value, d.close_date::text, d.loss_reason, d.account_id, d.owner_id, d.created_at, d.updated_at
     FROM deals d
     INNER JOIN deal_contacts dc ON dc.deal_id = d.id
     WHERE dc.contact_id = $1
     ORDER BY d.created_at ASC`,
    [contactId],
  );
  return result.rows;
}
