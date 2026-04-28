/**
 * Deal service — business logic for deal CRUD operations.
 * All database access for deals goes through this module.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type { CreateDealInput, UpdateDealInput } from '@minicrm/shared/schemas/dealSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import { fireAutomationTrigger } from './automationService.js';
import { writeAuditEntry, writeAuditEntries, diffFields } from './auditService.js';
import type { AuditEntryInput } from './auditService.js';
import { getDefaultCurrency } from './settingsService.js';

/** Actor info required to write audit entries on write operations */
export interface AuditActor {
  id: string;
  name: string;
}

/** Fallback actor used when no user context is available (e.g. tests, system operations) */
const SYSTEM_ACTOR: AuditActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

/** Columns that may be updated via updateDeal — guards against SQL injection from dynamic field names */
const ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateDealInput> = new Set([
  'name',
  'stage',
  'value',
  'currency',
  'close_date',
  'account_id',
  'owner_id',
  'loss_reason',
  'probability',
]);

/** Shape of a deal row returned from the database */
export interface DealRow {
  id: string;
  name: string;
  stage: string;
  value: string | null; // pg returns numeric as string
  /** ISO 4217 currency code for the deal value (MINCRM-189) */
  currency: string;
  close_date: string | null;
  loss_reason: string | null;
  account_id: string | null;
  owner_id: string;
  /**
   * Resolved effective probability for this deal (0–100).
   * Returns the deal's manual override when set; otherwise the current stage default.
   * Computed via JOIN to pipeline_stages in all queries. (MINCRM-179)
   */
  effective_probability: number;
  /**
   * True when the deal has a manually stored probability (not inheriting from stage default).
   * (MINCRM-179)
   */
  probability_is_overridden: boolean;
  created_at: Date;
  updated_at: Date;
  /** Tags attached to this deal — only populated in list responses (MINCRM-186) */
  tags?: Array<{ id: string; name: string }>;
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
  /** When true, Closed Won and Closed Lost deals are excluded (MINCRM-176) */
  excludeClosedStages?: boolean;
  /** Column to sort by; defaults to 'created_at' */
  sort?: DealSortColumn;
  /** Sort direction; defaults to 'ASC' */
  dir?: 'ASC' | 'DESC';
  /** 1-based page number; defaults to 1 */
  page?: number;
  /** Records per page; defaults to 50 */
  limit?: number;
  /** When provided, only deals tagged with at least one of these tag IDs are returned (MINCRM-186) */
  tagIds?: string[];
}

/**
 * Creates a new deal record and writes an audit entry in the same transaction.
 * (MINCRM-170)
 *
 * @param params - Deal fields plus the owner's user ID
 * @param actor - User performing the action (for audit log)
 * @returns The inserted deal row
 */
export async function createDeal(
  params: CreateDealInput & { owner_id: string },
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<DealRow> {
  const { name, stage, value, currency, close_date, account_id, owner_id, probability } = params;

  // Fall back to the system default currency when not specified on the deal (MINCRM-189)
  const resolvedCurrency = currency ?? (await getDefaultCurrency());

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert the deal, then immediately re-query with the pipeline_stages JOIN so
    // effective_probability and probability_is_overridden are resolved correctly.
    // (MINCRM-179)
    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO deals (name, stage, value, currency, close_date, account_id, owner_id, probability)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        name,
        stage,
        value ?? null,
        resolvedCurrency,
        close_date ?? null,
        account_id ?? null,
        owner_id,
        probability ?? null,
      ],
    );
    const newId = insertResult.rows[0].id;

    const result = await client.query<DealRow>(
      `SELECT ${DEAL_SELECT} FROM ${DEAL_FROM} WHERE d.id = $1`,
      [newId],
    );

    const deal = result.rows[0];

    // Audit: record created (MINCRM-170)
    await writeAuditEntry(client, {
      recordType: 'deal',
      recordId: deal.id,
      recordName: deal.name,
      eventType: 'created',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    // Fire-and-forget: fireAutomationTrigger swallows all internal errors and logs them.
    // Unhandled rejections are caught by the global handler in server.ts (MINCRM-122).
    void fireAutomationTrigger('deal_created', {
      recordId: deal.id,
      recordType: 'deal',
      ownerId: owner_id,
    });

    return deal;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Finds a deal by its UUID.
 *
 * @param id - Deal UUID
 * @returns The deal row, or null if not found
 */
export async function findDealById(id: string): Promise<DealRow | null> {
  const result = await pool.query<DealRow>(
    `SELECT ${DEAL_SELECT} FROM ${DEAL_FROM} WHERE d.id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * SELECT columns used in deal list queries.
 * JOINs pipeline_stages to resolve effective_probability and probability_is_overridden.
 * effective_probability = deal.probability if overridden, else stage default, else 0.
 * The final fallback to 0 guards against a deal whose stage was deleted (ps row absent).
 * probability_is_overridden = true when d.probability IS NOT NULL.
 * (MINCRM-179)
 */
const DEAL_SELECT = `d.id, d.name, d.stage, d.value, d.currency, d.close_date::text, d.loss_reason, d.account_id, d.owner_id,
  COALESCE(d.probability, ps.probability, 0) AS effective_probability,
  (d.probability IS NOT NULL) AS probability_is_overridden,
  d.created_at, d.updated_at`;

/** FROM clause that joins pipeline_stages for probability resolution */
const DEAL_FROM = `deals d LEFT JOIN pipeline_stages ps ON ps.name = d.stage`;

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
    conditions.push(`d.owner_id = $${values.length}`);
  }

  if (options.accountId) {
    values.push(options.accountId);
    conditions.push(`d.account_id = $${values.length}`);
  }

  if (options.excludeClosedStages) {
    conditions.push(`d.stage NOT IN ('Closed Won', 'Closed Lost')`);
  }

  // Tag filter (MINCRM-186) — any-match: deal must have at least one of the given tag IDs
  if (options.tagIds && options.tagIds.length > 0) {
    const placeholders = options.tagIds.map((_, i) => `$${values.length + i + 1}`).join(', ');
    options.tagIds.forEach((tid) => values.push(tid));
    conditions.push(
      `EXISTS (SELECT 1 FROM deal_tags dta WHERE dta.deal_id = d.id AND dta.tag_id IN (${placeholders}))`,
    );
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

  // Embed tags via lateral subquery (MINCRM-186)
  const dealTagsSubquery = `
    COALESCE((
      SELECT JSON_AGG(JSON_BUILD_OBJECT('id', t.id, 'name', t.name) ORDER BY t.name)
      FROM deal_tags dta INNER JOIN tags t ON t.id = dta.tag_id
      WHERE dta.deal_id = d.id
    ), '[]'::json) AS tags`;

  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${DEAL_FROM} ${where}`, values),
    pool.query<DealRow>(
      `SELECT ${DEAL_SELECT}, ${dealTagsSubquery} FROM ${DEAL_FROM} ${where} ORDER BY d.${sortCol} ${sortDir} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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
 * Updates one or more fields on an existing deal and writes per-field audit entries.
 * (MINCRM-170)
 *
 * @param id - Deal UUID
 * @param params - Fields to update (at least one required)
 * @param actor - User performing the action (for audit log)
 * @param before - Snapshot of the deal before update (used for diff)
 * @returns The updated deal row, or null if not found
 */
export async function updateDeal(
  id: string,
  params: UpdateDealInput,
  actor: AuditActor = SYSTEM_ACTOR,
  before?: DealRow,
): Promise<DealRow | null> {
  const fields = (Object.keys(params) as (keyof UpdateDealInput)[]).filter((field) =>
    ALLOWED_UPDATE_FIELDS.has(field),
  );

  // Guard against empty field list — would produce invalid SQL
  if (fields.length === 0) {
    return findDealById(id);
  }

  const previousStage = before?.stage;

  // Build dynamic SET clause: name = $2, stage = $3, ...
  const setClauses = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateResult = await client.query<{ id: string }>(
      `UPDATE deals
       SET ${setClauses}, updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [id, ...fields.map((f) => params[f])],
    );

    // Re-fetch with pipeline_stages JOIN so effective_probability is resolved (MINCRM-179)
    const updatedId = updateResult.rows[0]?.id ?? null;
    const fetchResult = updatedId
      ? await client.query<DealRow>(`SELECT ${DEAL_SELECT} FROM ${DEAL_FROM} WHERE d.id = $1`, [
          updatedId,
        ])
      : { rows: [] as DealRow[] };

    const deal = fetchResult.rows[0] ?? null;

    if (deal && before) {
      // Audit: per-field diff (MINCRM-170)
      const auditBase = {
        recordType: 'deal' as const,
        recordId: deal.id,
        recordName: deal.name,
        changedById: actor.id,
        changedByName: actor.name,
      };

      const fieldEntries = diffFields(
        before as unknown as Record<string, unknown>,
        deal as unknown as Record<string, unknown>,
        auditBase,
      );

      const ownershipEntries: AuditEntryInput[] = [];
      if (params.owner_id !== undefined && params.owner_id !== before.owner_id) {
        ownershipEntries.push({ ...auditBase, eventType: 'ownership_reassigned' });
      }

      await writeAuditEntries(client, [...fieldEntries, ...ownershipEntries]);
    }

    await client.query('COMMIT');

    // Fire-and-forget: fireAutomationTrigger swallows all internal errors and logs them.
    // Unhandled rejections are caught by the global handler in server.ts (MINCRM-122).
    if (deal && params.stage !== undefined && deal.stage !== previousStage) {
      void fireAutomationTrigger('deal_stage_changed', {
        recordId: deal.id,
        recordType: 'deal',
        ownerId: deal.owner_id,
        newStage: deal.stage,
      });
    }

    return deal;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Shape of a deal row enriched with display names and contact names for CSV export */
export interface DealExportRow {
  id: string;
  name: string;
  stage: string;
  value: string | null;
  /** ISO 4217 currency code for the deal value (MINCRM-189) */
  currency: string;
  close_date: string | null;
  loss_reason: string | null;
  account_name: string | null;
  contact_names: string | null;
  owner_name: string;
  created_at: Date;
  updated_at: Date;
}

/** Options for filtering deals to export (mirrors list options minus pagination) */
interface ExportDealsOptions {
  /** When provided, only deals with this owner_id are returned */
  ownerId?: string;
  /** When provided, only deals linked to this account_id are returned */
  accountId?: string;
}

/**
 * Returns all deals matching the given filters, enriched with account name,
 * semicolon-separated contact names, and owner name, for CSV export. No pagination.
 * (MINCRM-166)
 *
 * @param options - Filters (same semantics as listDeals, minus pagination/sort)
 * @returns Array of enriched deal rows ordered by created_at ASC
 */
export async function exportDealsForCsv(
  options: ExportDealsOptions = {},
): Promise<DealExportRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.ownerId) {
    values.push(options.ownerId);
    conditions.push(`d.owner_id = $${values.length}`);
  }

  if (options.accountId) {
    values.push(options.accountId);
    conditions.push(`d.account_id = $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query<DealExportRow>(
    `SELECT
       d.id,
       d.name,
       d.stage,
       d.value,
       d.currency,
       d.close_date::text,
       d.loss_reason,
       a.name AS account_name,
       (
         SELECT string_agg(c.first_name || ' ' || c.last_name, '; ' ORDER BY c.last_name, c.first_name)
         FROM deal_contacts dc
         JOIN contacts c ON dc.contact_id = c.id
         WHERE dc.deal_id = d.id
       ) AS contact_names,
       u.name AS owner_name,
       d.created_at,
       d.updated_at
     FROM deals d
     LEFT JOIN accounts a ON d.account_id = a.id
     JOIN users u ON d.owner_id = u.id
     ${whereClause}
     ORDER BY d.created_at ASC`,
    values,
  );

  return result.rows;
}

/**
 * Deletes a deal by its UUID and writes an audit entry in the same transaction.
 * Associated deal_contacts rows are removed via CASCADE.
 * Linked contacts and accounts are not affected.
 * (MINCRM-170)
 *
 * @param id - Deal UUID
 * @param actor - User performing the action (for audit log)
 * @param recordName - Display name of the deal (used for audit log after deletion)
 * @returns The deleted deal row, or null if not found
 */
export async function deleteDeal(
  id: string,
  actor: AuditActor = SYSTEM_ACTOR,
  recordName = '',
): Promise<DealRow | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Use a CTE so we can JOIN pipeline_stages on the deleted row, keeping the returned
    // DealRow consistent with every other query path. (MINCRM-179)
    const result = await client.query<DealRow>(
      `WITH deleted AS (
         DELETE FROM deals WHERE id = $1 RETURNING *
       )
       SELECT
         deleted.id, deleted.name, deleted.stage, deleted.value, deleted.currency,
         deleted.close_date::text, deleted.loss_reason, deleted.account_id, deleted.owner_id,
         COALESCE(deleted.probability, ps.probability, 0) AS effective_probability,
         (deleted.probability IS NOT NULL) AS probability_is_overridden,
         deleted.created_at, deleted.updated_at
       FROM deleted
       LEFT JOIN pipeline_stages ps ON ps.name = deleted.stage`,
      [id],
    );

    const deal = result.rows[0] ?? null;

    if (deal) {
      // Audit: record deleted (MINCRM-170)
      await writeAuditEntry(client, {
        recordType: 'deal',
        recordId: id,
        recordName,
        eventType: 'deleted',
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    await client.query('COMMIT');
    return deal;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
    `SELECT ${DEAL_SELECT}
     FROM ${DEAL_FROM}
     INNER JOIN deal_contacts dc ON dc.deal_id = d.id
     WHERE dc.contact_id = $1
     ORDER BY d.created_at ASC`,
    [contactId],
  );
  return result.rows;
}
