/**
 * Leads service — business logic for lead CRUD, status lifecycle, and conversion.
 * All database access for leads goes through this module.
 * (MINCRM-173, MINCRM-174, MINCRM-175)
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CreateLeadInput,
  UpdateLeadInput,
  ConvertLeadInput,
} from '@minicrm/shared/schemas/leadSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import {
  writeAuditEntry,
  writeAuditEntries,
  writeAuditEntryBestEffort,
  diffFields,
} from './auditService.js';
import type { AuditActor } from './auditService.js';
import { getDefaultPipelineId } from './pipelineService.js';
import { setRlsUserId, withRlsQuery } from './rlsContextService.js';

const SYSTEM_ACTOR: AuditActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

/** Columns that may be updated via updateLead — guards against SQL injection */
const ALLOWED_UPDATE_FIELDS = new Set([
  'first_name',
  'last_name',
  'email',
  'phone',
  'company_name',
  'lead_source',
  'status',
  'disqualification_reason',
  'notes',
  'owner_id',
]);

/** Shape of a lead row returned from the database */
export interface LeadRow {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  company_name: string | null;
  lead_source: string | null;
  status: string;
  disqualification_reason: string | null;
  notes: string | null;
  owner_id: string;
  converted_at: Date | null;
  converted_contact_id: string | null;
  converted_account_id: string | null;
  converted_deal_id: string | null;
  created_at: Date;
  updated_at: Date;
  /** Optimistic lock version (MINCRM-349) */
  version: number;
}

/** Shape of a lead status history row */
export interface LeadStatusHistoryRow {
  id: string;
  lead_id: string;
  from_status: string | null;
  to_status: string;
  changed_by_id: string | null;
  changed_by_name: string | null;
  created_at: Date;
}

/** Result of a successful lead conversion */
export interface ConvertLeadResult {
  contact_id: string;
  account_id: string;
  deal_id: string;
}

/** Columns that may be used for ORDER BY in listLeads */
export const LEAD_SORT_COLUMNS = [
  'created_at',
  'first_name',
  'last_name',
  'email',
  'company_name',
  'status',
] as const;
export type LeadSortColumn = (typeof LEAD_SORT_COLUMNS)[number];

/** Options for filtering and paginating the leads list */
interface ListLeadsOptions {
  ownerId?: string;
  status?: string;
  lead_source?: string;
  /** When true, include Disqualified leads (hidden by default) */
  includeDisqualified?: boolean;
  /** When true, include converted leads (hidden by default) */
  includeConverted?: boolean;
  sort?: LeadSortColumn;
  dir?: 'ASC' | 'DESC';
  page?: number;
  limit?: number;
}

/**
 * Creates a new lead record and writes an initial status history entry.
 *
 * @param params - Lead fields plus the owner's user ID
 * @param actor - User performing the action (for audit log)
 * @returns The inserted lead row
 */
export async function createLead(
  params: CreateLeadInput & { owner_id: string },
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<LeadRow> {
  const { first_name, last_name, email, phone, company_name, lead_source, notes, owner_id } =
    params;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    const result = await client.query<LeadRow>(
      `INSERT INTO leads
         (first_name, last_name, email, phone, company_name, lead_source, notes, owner_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        first_name,
        last_name ?? null,
        email.toLowerCase(),
        phone ?? null,
        company_name ?? null,
        lead_source ?? null,
        notes ?? null,
        owner_id,
        'New',
      ],
    );

    const lead = result.rows[0];

    // Record initial status in history (MINCRM-174)
    await client.query(
      `INSERT INTO lead_status_history (lead_id, from_status, to_status, changed_by_id, changed_by_name)
       VALUES ($1, NULL, $2, $3, $4)`,
      [lead.id, lead.status, actor.id, actor.name],
    );

    await writeAuditEntry(client, {
      recordType: 'contact', // leads are not a separate audit record_type; use 'contact' for now
      recordId: lead.id,
      recordName: `${lead.first_name}${lead.last_name ? ' ' + lead.last_name : ''}`,
      eventType: 'created',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return lead;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Finds a lead by email address (case-insensitive).
 * Used for duplicate detection.
 *
 * @param email - Email to search for
 * @param excludeId - Optional lead UUID to exclude (for updates)
 * @returns The matching lead row, or null if not found
 */
export async function findLeadByEmail(email: string, excludeId?: string): Promise<LeadRow | null> {
  // Uses pool.query (superuser, bypasses RLS) so duplicate-email detection is
  // global across all users — two reps cannot independently create leads with
  // the same email address.
  if (excludeId) {
    const result = await pool.query<LeadRow>(
      'SELECT * FROM leads WHERE LOWER(email) = LOWER($1) AND id != $2 LIMIT 1',
      [email, excludeId],
    );
    return result.rows[0] ?? null;
  }

  const result = await pool.query<LeadRow>(
    'SELECT * FROM leads WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email],
  );
  return result.rows[0] ?? null;
}

/**
 * Finds a lead by its UUID.
 *
 * @param id - Lead UUID
 * @returns The lead row, or null if not found
 */
export async function findLeadById(id: string): Promise<LeadRow | null> {
  const result = await withRlsQuery((client) =>
    client.query<LeadRow>('SELECT * FROM leads WHERE id = $1 LIMIT 1', [id]),
  );
  return result.rows[0] ?? null;
}

/**
 * Returns a paginated list of leads with optional filtering.
 * Disqualified and converted leads are hidden unless explicitly requested.
 *
 * @param options - Filters, sort, and pagination options
 * @returns Paginated response with lead rows and total count
 */
export async function listLeads(
  options: ListLeadsOptions = {},
): Promise<PaginatedResponse<LeadRow>> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.ownerId) {
    values.push(options.ownerId);
    conditions.push(`owner_id = $${values.length}`);
  }

  if (options.status) {
    values.push(options.status);
    conditions.push(`status = $${values.length}`);
  }

  if (options.lead_source) {
    values.push(options.lead_source);
    conditions.push(`lead_source = $${values.length}`);
  }

  // Hide Disqualified leads by default (MINCRM-174)
  if (!options.includeDisqualified && !options.status) {
    conditions.push(`status != 'Disqualified'`);
  }

  // Hide converted leads by default (MINCRM-175)
  if (!options.includeConverted) {
    conditions.push(`converted_at IS NULL`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sortCol = (LEAD_SORT_COLUMNS as readonly string[]).includes(options.sort ?? '')
    ? options.sort!
    : 'created_at';
  const sortDir = options.dir === 'DESC' ? 'DESC' : 'ASC';

  const page = options.page ?? 1;
  const limit = options.limit ?? 50;
  const offset = (page - 1) * limit;

  const [countResult, dataResult] = await Promise.all([
    withRlsQuery((client) =>
      client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM leads ${whereClause}`, values),
    ),
    withRlsQuery((client) =>
      client.query<LeadRow>(
        `SELECT * FROM leads ${whereClause} ORDER BY ${sortCol} ${sortDir} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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
 * Updates one or more fields on an existing lead.
 * When status changes, writes a history entry (MINCRM-174).
 *
 * @param id - Lead UUID
 * @param params - Fields to update (at least one required)
 * @param actor - User performing the action
 * @returns The updated lead row, or null if not found
 */
export async function updateLead(
  id: string,
  params: UpdateLeadInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<LeadRow | null> {
  const { version, ...rest } = params;
  const normalized: Omit<UpdateLeadInput, 'version'> = {
    ...rest,
    ...(rest.email !== undefined ? { email: rest.email.toLowerCase() } : {}),
  };

  const fields = (Object.keys(normalized) as string[]).filter((field) =>
    ALLOWED_UPDATE_FIELDS.has(field),
  );

  if (fields.length === 0) return null;

  // Fetch current lead to detect status change
  const before = await findLeadById(id);
  if (!before) return null;

  // $1=id, $2...$N=field values, $(N+1)=version (MINCRM-349)
  const setClauses = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
  const versionParam = fields.length + 2;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    const result = await client.query<LeadRow>(
      `UPDATE leads SET ${setClauses}, updated_at = now(), version = version + 1 WHERE id = $1 AND version = $${versionParam} RETURNING *`,
      [id, ...fields.map((f) => (normalized as Record<string, unknown>)[f]), version],
    );

    if (result.rowCount === 0) {
      // Distinguish NOT_FOUND from version mismatch (MINCRM-349)
      const check = await client.query<{ id: string }>('SELECT id FROM leads WHERE id = $1', [id]);
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
          entity: 'lead',
          recordId: id,
        },
      );
    }

    const lead = result.rows[0] ?? null;

    // Write status history entry if status changed (MINCRM-174)
    if (lead && params.status !== undefined && params.status !== before.status) {
      await client.query(
        `INSERT INTO lead_status_history (lead_id, from_status, to_status, changed_by_id, changed_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [lead.id, before.status, lead.status, actor.id, actor.name],
      );
    }

    if (lead) {
      const auditEntries = diffFields(
        before as unknown as Record<string, unknown>,
        lead as unknown as Record<string, unknown>,
        {
          recordType: 'contact', // leads share 'contact' record type in the audit log
          recordId: lead.id,
          recordName: `${lead.first_name}${lead.last_name ? ' ' + lead.last_name : ''}`,
          changedById: actor.id,
          changedByName: actor.name,
        },
      );
      if (auditEntries.length > 0) {
        await writeAuditEntries(client, auditEntries);
      }
    }

    await client.query('COMMIT');
    return lead;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Deletes a lead by its UUID.
 * Deletion does not create any associated contact, account, or deal. (MINCRM-173)
 *
 * @param id - Lead UUID
 * @param actor - User performing the action (for audit log)
 * @returns The deleted lead row, or null if not found
 */
export async function deleteLead(
  id: string,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<LeadRow | null> {
  const result = await withRlsQuery((client) =>
    client.query<LeadRow>('DELETE FROM leads WHERE id = $1 RETURNING *', [id]),
  );
  const deleted = result.rows[0] ?? null;

  if (deleted) {
    void writeAuditEntryBestEffort({
      recordType: 'contact', // leads share 'contact' record type in the audit log
      recordId: deleted.id,
      recordName: `${deleted.first_name}${deleted.last_name ? ' ' + deleted.last_name : ''}`,
      eventType: 'deleted',
      changedById: actor.id,
      changedByName: actor.name,
    });
  }

  return deleted;
}

/**
 * Returns the status history for a lead, ordered chronologically. (MINCRM-174)
 *
 * @param leadId - Lead UUID
 * @returns Array of status history entries
 */
export async function getLeadStatusHistory(leadId: string): Promise<LeadStatusHistoryRow[]> {
  const result = await pool.query<LeadStatusHistoryRow>(
    'SELECT * FROM lead_status_history WHERE lead_id = $1 ORDER BY created_at ASC',
    [leadId],
  );
  return result.rows;
}

/**
 * Atomically converts a qualified lead into a contact, account, and deal.
 * All three records are created (or the account is linked) in a single transaction.
 * On success, the lead's converted_at, status, and FK columns are updated.
 * The lead record is retained for reporting — it is not deleted. (MINCRM-175)
 *
 * @param leadId - Lead UUID to convert
 * @param input - Prefilled conversion form data
 * @param actor - User performing the action
 * @returns IDs of the created contact, account, and deal
 * @throws Error if lead not found, already converted, or Disqualified
 */
export async function convertLead(
  leadId: string,
  input: ConvertLeadInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<ConvertLeadResult> {
  const lead = await findLeadById(leadId);
  if (!lead) throw Object.assign(new Error('Lead not found'), { code: 'NOT_FOUND' });
  if (lead.converted_at)
    throw Object.assign(new Error('Lead already converted'), { code: 'ALREADY_CONVERTED' });
  if (lead.status === 'Disqualified')
    throw Object.assign(new Error('Disqualified leads cannot be converted'), {
      code: 'DISQUALIFIED',
    });

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    const defaultPipelineId = await getDefaultPipelineId(client);

    // ── Account ──────────────────────────────────────────────────────────────
    let accountId: string;
    if (input.account.mode === 'link') {
      // Verify the account exists
      const acctCheck = await client.query<{ id: string }>(
        'SELECT id FROM accounts WHERE id = $1',
        [input.account.account_id],
      );
      if (acctCheck.rows.length === 0) {
        throw Object.assign(new Error('Account not found'), { code: 'ACCOUNT_NOT_FOUND' });
      }
      accountId = input.account.account_id;
    } else {
      const acctResult = await client.query<{ id: string }>(
        `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
        [input.account.name, actor.id],
      );
      accountId = acctResult.rows[0].id;
    }

    // ── Contact ───────────────────────────────────────────────────────────────
    const contactResult = await client.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, phone, account_id, owner_id, source_lead_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.contact.first_name,
        input.contact.last_name ?? '',
        input.contact.email.toLowerCase(),
        input.contact.phone ?? null,
        accountId,
        actor.id,
        leadId,
      ],
    );
    const contactId = contactResult.rows[0].id;

    // ── Deal ──────────────────────────────────────────────────────────────────
    const dealName = input.deal.name;
    const dealStage = input.deal.stage ?? 'Prospecting';
    const dealValue =
      input.deal.value && input.deal.value.trim().length > 0 ? input.deal.value : null;
    const dealCloseDate =
      input.deal.close_date && input.deal.close_date.trim().length > 0
        ? input.deal.close_date
        : null;

    const dealStageRow = await client.query<{ id: string }>(
      `SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1`,
      [dealStage, defaultPipelineId],
    );
    const dealPipelineStageId = dealStageRow.rows[0]?.id ?? null;

    const dealResult = await client.query<{ id: string }>(
      `INSERT INTO deals (name, stage, value, close_date, account_id, owner_id, source_lead_id, pipeline_id, pipeline_stage_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        dealName,
        dealStage,
        dealValue,
        dealCloseDate,
        accountId,
        actor.id,
        leadId,
        defaultPipelineId,
        dealPipelineStageId,
      ],
    );
    const dealId = dealResult.rows[0].id;

    // Link the contact to the deal via deal_contacts
    await client.query('INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2)', [
      dealId,
      contactId,
    ]);

    // ── Mark lead as converted ────────────────────────────────────────────────
    const prevStatus = lead.status;
    await client.query(
      `UPDATE leads
       SET converted_at = now(),
           converted_contact_id = $1,
           converted_account_id = $2,
           converted_deal_id = $3,
           status = 'Qualified',
           updated_at = now()
       WHERE id = $4`,
      [contactId, accountId, dealId, leadId],
    );

    // Write status history entry if status changed
    if (prevStatus !== 'Qualified') {
      await client.query(
        `INSERT INTO lead_status_history (lead_id, from_status, to_status, changed_by_id, changed_by_name)
         VALUES ($1, $2, 'Qualified', $3, $4)`,
        [leadId, prevStatus, actor.id, actor.name],
      );
    }

    await client.query('COMMIT');
    return { contact_id: contactId, account_id: accountId, deal_id: dealId };
  } catch (error) {
    await client.query('ROLLBACK');
    // PostgreSQL error code 23505 = unique_violation on contacts.email. (MINCRM-247)
    if ((error as { code?: string }).code === '23505') {
      throw Object.assign(new Error('A contact with this email address already exists'), {
        code: 'DUPLICATE_EMAIL',
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Finds the lead that a contact was converted from, if any. (MINCRM-175)
 *
 * @param contactId - Contact UUID
 * @returns The source lead row, or null
 */
export async function findLeadByContactId(contactId: string): Promise<LeadRow | null> {
  const result = await withRlsQuery((client) =>
    client.query<LeadRow>(
      'SELECT l.* FROM leads l JOIN contacts c ON c.source_lead_id = l.id WHERE c.id = $1 LIMIT 1',
      [contactId],
    ),
  );
  return result.rows[0] ?? null;
}

/**
 * Finds the lead that a deal was converted from, if any. (MINCRM-175)
 *
 * @param dealId - Deal UUID
 * @returns The source lead row, or null
 */
export async function findLeadByDealId(dealId: string): Promise<LeadRow | null> {
  const result = await withRlsQuery((client) =>
    client.query<LeadRow>(
      'SELECT l.* FROM leads l JOIN deals d ON d.source_lead_id = l.id WHERE d.id = $1 LIMIT 1',
      [dealId],
    ),
  );
  return result.rows[0] ?? null;
}

/**
 * Searches existing accounts by name (case-insensitive substring match).
 * Used by the lead conversion flow to find an existing account to link. (MINCRM-175)
 *
 * @param query - Substring to match against account names
 * @returns Array of matching account id + name pairs (max 20)
 */
export async function searchAccountsForConversion(
  query: string,
): Promise<Array<{ id: string; name: string }>> {
  const result = await withRlsQuery((client) =>
    client.query<{ id: string; name: string }>(
      `SELECT id, name FROM accounts WHERE name ILIKE $1 ORDER BY name ASC LIMIT 20`,
      [`%${query}%`],
    ),
  );
  return result.rows;
}
