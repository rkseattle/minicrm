/**
 * GDPR service — handles personal data erasure (Art. 17 right to erasure) and
 * subject-access exports for contacts and leads. (MINCRM-364)
 *
 * Erasure is transactional: the gdpr_deletion_log INSERT, all PII overwrites,
 * and the audit entry are committed together or all roll back.
 *
 * Export is read-only (no transaction required).
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import { writeAuditEntry, SYSTEM_ACTOR } from './auditService.js';
import { setRlsUserId } from './rlsContextService.js';
import type { AuditActor, AuditLogRow } from './auditService.js';
import type { NoteResponse } from '@minicrm/shared/schemas/noteSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import type { ContactRow } from './contactService.js';
import type { LeadRow } from './leadsService.js';
import type { ActivityRow } from './activityService.js';
import type { DealRow } from './dealService.js';
import type { CustomFieldValueWithDefinition } from './customFieldService.js';

// ── PII field lists ────────────────────────────────────────────────────────────

/** Contact personal data fields to erase per GDPR Art. 17 */
const CONTACT_PII_FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'title',
  'department',
  // Address rows are deleted from contact_addresses table (MINCRM-500)
  'contact_addresses',
  'linkedin_url',
  'twitter_x_url',
  'other_url',
] as const;

/** Lead personal data fields to erase per GDPR Art. 17 */
const LEAD_PII_FIELDS = ['first_name', 'last_name', 'phone', 'company_name', 'notes'] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Row returned from the gdpr_deletion_log table */
export interface GdprDeletionLogRow {
  id: string;
  record_type: string;
  record_id: string;
  requested_by: string;
  requested_at: Date;
  completed_at: Date | null;
  erasure_scope: string[];
  notes: string | null;
}

/** Row returned from the ai_gdpr_cascade_log table */
export interface AiGdprCascadeLogRow {
  id: string;
  contact_id: string;
  triggered_at: Date;
  triggered_by: string | null;
  messages_redacted: number;
  context_entries_removed: number;
  status: 'completed' | 'failed';
  error_detail: string | null;
  original_name: string | null;
  original_email: string | null;
}

/** Full GDPR export payload for a contact */
export interface ContactGdprExport {
  subject: string;
  exported_at: string;
  contact: ContactRow;
  activities: ActivityRow[];
  deals: DealRow[];
  notes: NoteResponse[];
  custom_fields: CustomFieldValueWithDefinition[];
  audit_history: AuditLogRow[];
}

/** Full GDPR export payload for a lead */
export interface LeadGdprExport {
  subject: string;
  exported_at: string;
  lead: LeadRow;
  notes: NoteResponse[];
  custom_fields: CustomFieldValueWithDefinition[];
  audit_history: AuditLogRow[];
}

// ── Internal row types for queries ────────────────────────────────────────────

/** Raw note row joined with creator/updater names */
interface NoteRow {
  id: string;
  entity_type: string;
  entity_id: string;
  title: string | null;
  body: string;
  body_text: string | null;
  visibility: string;
  tags: string[];
  created_by: string;
  created_by_name: string;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Raw custom field value row with joined definition columns */
interface CustomFieldValueRaw {
  id: string;
  definition_id: string;
  record_id: string;
  value: string | null;
  created_at: Date;
  updated_at: Date;
  def_id: string;
  def_entity_type: string;
  def_name: string;
  def_field_type: string;
  def_options: string[] | null;
  def_sort_order: number;
  def_pii_excluded: boolean;
  def_created_at: Date;
}

// ── Erasure ────────────────────────────────────────────────────────────────────

/**
 * Erases personal data for a contact per GDPR Art. 17.
 *
 * Single transaction:
 * 1. Verify the contact exists.
 * 2. Check that erasure has not already been performed.
 * 3. Insert a pending gdpr_deletion_log row.
 * 4. Overwrite PII fields on the contacts row.
 * 5. Scrub subject/notes on linked activities.
 * 6. Scrub linked notes (soft-delete–aware).
 * 7. Delete custom field values.
 * 8. Mark the gdpr_deletion_log row as completed.
 * 9. Write an audit entry.
 *
 * @param id - UUID of the contact to erase
 * @param actor - Admin user performing the erasure
 * @param notes - Optional human-readable reason to store in the log
 * @returns The completed gdpr_deletion_log row
 * @throws Error with code NOT_FOUND if the contact does not exist
 * @throws Error with code GDPR_ALREADY_ERASED if erasure was previously completed
 */
export async function eraseContact(
  id: string,
  actor: AuditActor,
  notes?: string,
): Promise<GdprDeletionLogRow> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    // Step 1 — verify the contact exists and capture PII before overwrite.
    // Name and email are captured here so the AI cascade (fired after COMMIT)
    // can search ai_messages for the original values, not the redacted placeholders.
    const contactResult = await client.query<{
      id: string;
      first_name: string;
      last_name: string | null;
      email: string;
    }>('SELECT id, first_name, last_name, email FROM contacts WHERE id = $1 LIMIT 1', [id]);
    if (contactResult.rows.length === 0) {
      throw Object.assign(new Error('Contact not found'), { code: 'NOT_FOUND' });
    }
    const contactPii = contactResult.rows[0];
    const contactName = [contactPii.first_name, contactPii.last_name].filter(Boolean).join(' ');
    const contactEmail = contactPii.email;

    // Step 2 — check for an existing completed erasure
    const existingResult = await client.query<{ id: string }>(
      `SELECT id FROM gdpr_deletion_log WHERE record_type = 'contact' AND record_id = $1 LIMIT 1`,
      [id],
    );
    if (existingResult.rows.length > 0) {
      throw Object.assign(new Error('This contact has already been erased under GDPR Art. 17'), {
        code: 'GDPR_ALREADY_ERASED',
      });
    }

    // Step 3 — insert a pending log row (completed_at remains null until all writes succeed)
    await client.query(
      `INSERT INTO gdpr_deletion_log (record_type, record_id, requested_by, erasure_scope, notes)
       VALUES ('contact', $1, $2, $3, $4)`,
      [id, actor.id, CONTACT_PII_FIELDS as unknown as string[], notes ?? null],
    );

    // Step 4 — overwrite PII fields on the contacts row.
    // Email is replaced with a synthetic address that is still a valid email shape
    // to avoid breaking NOT NULL or format constraints.
    await client.query(
      `UPDATE contacts SET
         first_name = '[GDPR deleted]',
         last_name = '[GDPR deleted]',
         email = 'gdpr-deleted-' || id || '@gdpr.invalid',
         phone = NULL,
         title = NULL,
         department = NULL,
         linkedin_url = NULL,
         twitter_x_url = NULL,
         other_url = NULL
       WHERE id = $1`,
      [id],
    );

    // Step 5 — delete all contact_addresses rows (address data is PII). (MINCRM-500)
    await client.query(`DELETE FROM contact_addresses WHERE contact_id = $1`, [id]);

    // Step 6 — scrub subject and notes on linked activities
    await client.query(
      `UPDATE activities SET subject = '[GDPR deleted]', notes = NULL WHERE contact_id = $1`,
      [id],
    );

    // Step 7 — scrub linked notes (only non-deleted rows)
    await client.query(
      `UPDATE notes SET title = NULL, body = '[GDPR deleted]', body_text = '[GDPR deleted]'
       WHERE entity_type = 'contact' AND entity_id = $1 AND deleted_at IS NULL`,
      [id],
    );

    // Step 8 — delete custom field values for this contact.
    // custom_field_values has no record_type column; entity_type lives on the definition.
    // The JOIN ensures only contact-scoped values are removed.
    await client.query(
      `DELETE FROM custom_field_values
       WHERE record_id = $1
         AND definition_id IN (
           SELECT id FROM custom_field_definitions WHERE entity_type = 'contact'
         )`,
      [id],
    );

    // Step 9 — mark the log row as completed
    const logResult = await client.query<GdprDeletionLogRow>(
      `UPDATE gdpr_deletion_log SET completed_at = now()
       WHERE record_type = 'contact' AND record_id = $1
       RETURNING *`,
      [id],
    );
    const logRow = logResult.rows[0];

    // Step 10 — audit entry in the same transaction
    await writeAuditEntry(client, {
      recordType: 'contact',
      recordId: id,
      eventType: 'gdpr_erasure',
      newValue: 'Personal data erased per GDPR Art. 17 request',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    // Fire-and-forget AI cascade: redacts contact PII from ai_messages and
    // user_ai_context. Runs after COMMIT so it never blocks or rolls back
    // the primary erasure. Errors are caught and logged inside the cascade.
    void cascadeGdprErasureToAiData(id, contactName, contactEmail, actor);

    return logRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Erases personal data for a lead per GDPR Art. 17.
 *
 * Single transaction:
 * 1. Verify the lead exists.
 * 2. Check that erasure has not already been performed.
 * 3. Insert a pending gdpr_deletion_log row.
 * 4. Overwrite PII fields on the leads row.
 * 5. Scrub linked notes (soft-delete–aware).
 * 6. Delete custom field values.
 * 7. Mark the gdpr_deletion_log row as completed.
 * 8. Write an audit entry.
 *
 * Note: leads do not link directly to activities (activities reference contact_id,
 * account_id, or deal_id — there is no lead_id column on activities).
 *
 * @param id - UUID of the lead to erase
 * @param actor - Admin user performing the erasure
 * @param notes - Optional human-readable reason to store in the log
 * @returns The completed gdpr_deletion_log row
 * @throws Error with code NOT_FOUND if the lead does not exist
 * @throws Error with code GDPR_ALREADY_ERASED if erasure was previously completed
 */
export async function eraseLead(
  id: string,
  actor: AuditActor,
  notes?: string,
): Promise<GdprDeletionLogRow> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    // Step 1 — verify the lead exists
    const leadResult = await client.query<{ id: string }>(
      'SELECT id FROM leads WHERE id = $1 LIMIT 1',
      [id],
    );
    if (leadResult.rows.length === 0) {
      throw Object.assign(new Error('Lead not found'), { code: 'NOT_FOUND' });
    }

    // Step 2 — check for an existing completed erasure
    const existingResult = await client.query<{ id: string }>(
      `SELECT id FROM gdpr_deletion_log WHERE record_type = 'lead' AND record_id = $1 LIMIT 1`,
      [id],
    );
    if (existingResult.rows.length > 0) {
      throw Object.assign(new Error('This lead has already been erased under GDPR Art. 17'), {
        code: 'GDPR_ALREADY_ERASED',
      });
    }

    // Step 3 — insert a pending log row
    await client.query(
      `INSERT INTO gdpr_deletion_log (record_type, record_id, requested_by, erasure_scope, notes)
       VALUES ('lead', $1, $2, $3, $4)`,
      [id, actor.id, LEAD_PII_FIELDS as unknown as string[], notes ?? null],
    );

    // Step 4 — overwrite PII fields on the leads row
    await client.query(
      `UPDATE leads SET
         first_name = '[GDPR deleted]',
         last_name = NULL,
         email = 'gdpr-deleted-' || id || '@gdpr.invalid',
         phone = NULL,
         company_name = NULL,
         notes = NULL
       WHERE id = $1`,
      [id],
    );

    // Step 5 — scrub linked notes (only non-deleted rows)
    await client.query(
      `UPDATE notes SET title = NULL, body = '[GDPR deleted]', body_text = '[GDPR deleted]'
       WHERE entity_type = 'lead' AND entity_id = $1 AND deleted_at IS NULL`,
      [id],
    );

    // Step 6 — delete custom field values for this lead.
    // custom_field_values has no record_type column; entity_type lives on the definition.
    // The JOIN ensures only lead-scoped values are removed.
    await client.query(
      `DELETE FROM custom_field_values
       WHERE record_id = $1
         AND definition_id IN (
           SELECT id FROM custom_field_definitions WHERE entity_type = 'lead'
         )`,
      [id],
    );

    // Step 7 — mark the log row as completed
    const logResult = await client.query<GdprDeletionLogRow>(
      `UPDATE gdpr_deletion_log SET completed_at = now()
       WHERE record_type = 'lead' AND record_id = $1
       RETURNING *`,
      [id],
    );
    const logRow = logResult.rows[0];

    // Step 8 — audit entry in the same transaction
    await writeAuditEntry(client, {
      recordType: 'lead',
      recordId: id,
      eventType: 'gdpr_erasure',
      newValue: 'Personal data erased per GDPR Art. 17 request',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return logRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Export ─────────────────────────────────────────────────────────────────────

/**
 * Assembles a full GDPR subject-access export for a contact.
 * Read-only; no transaction required.
 *
 * Audit history is returned with GDPR masking applied via LEFT JOIN on
 * gdpr_deletion_log so old_value/new_value show '[GDPR deleted]' when erasure
 * is complete.
 *
 * @param id - UUID of the contact
 * @returns Full export payload
 */
export async function getGdprExportForContact(id: string): Promise<ContactGdprExport> {
  const [contactResult, activitiesResult, dealsResult, notesResult, cfResult, auditResult] =
    await Promise.all([
      pool.query<ContactRow>('SELECT * FROM contacts WHERE id = $1 LIMIT 1', [id]),

      pool.query<ActivityRow>(
        `SELECT a.*, u.name AS owner_name
         FROM activities a
         JOIN users u ON u.id = a.owner_id
         WHERE a.contact_id = $1
         ORDER BY a.created_at DESC`,
        [id],
      ),

      pool.query<DealRow>(
        `SELECT d.*
         FROM deals d
         JOIN deal_contacts dc ON dc.deal_id = d.id
         WHERE dc.contact_id = $1
         ORDER BY d.created_at DESC`,
        [id],
      ),

      pool.query<NoteRow>(
        `SELECT
           n.id, n.entity_type, n.entity_id, n.title, n.body, n.body_text,
           n.visibility,
           COALESCE(
             (SELECT array_agg(t.name ORDER BY t.name)
              FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
              WHERE nt.note_id = n.id),
             ARRAY[]::text[]
           ) AS tags,
           n.created_by, n.updated_by, n.created_at, n.updated_at,
           creator.name AS created_by_name,
           updater.name AS updated_by_name
         FROM notes n
         JOIN users creator ON creator.id = n.created_by
         LEFT JOIN users updater ON updater.id = n.updated_by
         WHERE n.entity_type = 'contact' AND n.entity_id = $1 AND n.deleted_at IS NULL
         ORDER BY n.created_at DESC`,
        [id],
      ),

      pool.query<CustomFieldValueRaw>(
        `SELECT
           v.id, v.definition_id, v.record_id, v.value, v.created_at, v.updated_at,
           d.id AS def_id,
           d.entity_type AS def_entity_type,
           d.name AS def_name,
           d.field_type AS def_field_type,
           d.options AS def_options,
           d.sort_order AS def_sort_order,
           d.pii_excluded AS def_pii_excluded,
           d.created_at AS def_created_at
         FROM custom_field_values v
         JOIN custom_field_definitions d ON d.id = v.definition_id AND d.entity_type = 'contact'
         WHERE v.record_id = $1
         ORDER BY d.sort_order ASC, d.name ASC`,
        [id],
      ),

      // Audit history with GDPR masking applied
      pool.query<AuditLogRow>(
        `SELECT
           a.id, a.record_type, a.record_id, a.record_name, a.event_type, a.field_name,
           CASE WHEN g.record_id IS NOT NULL THEN '[GDPR deleted]' ELSE a.old_value END AS old_value,
           CASE WHEN g.record_id IS NOT NULL THEN '[GDPR deleted]' ELSE a.new_value END AS new_value,
           a.changed_by_id, a.changed_by_name, a.created_at
         FROM audit_log a
         LEFT JOIN gdpr_deletion_log g
           ON g.record_id = a.record_id AND g.record_type = a.record_type AND g.completed_at IS NOT NULL
         WHERE a.record_type = 'contact' AND a.record_id = $1
         ORDER BY a.created_at DESC`,
        [id],
      ),
    ]);

  const contact = contactResult.rows[0];

  const customFields: CustomFieldValueWithDefinition[] = cfResult.rows.map((row) => ({
    id: row.id,
    definition_id: row.definition_id,
    record_id: row.record_id,
    value: row.value,
    created_at: row.created_at,
    updated_at: row.updated_at,
    definition: {
      id: row.def_id,
      entity_type: row.def_entity_type,
      name: row.def_name,
      field_type: row.def_field_type,
      options: row.def_options,
      sort_order: row.def_sort_order,
      pii_excluded: row.def_pii_excluded,
      created_at: row.def_created_at,
    },
  }));

  // Cast NoteRow → NoteResponse (same shape; NoteResponse is the public-facing interface)
  const notes = notesResult.rows as unknown as NoteResponse[];

  return {
    subject: id,
    exported_at: new Date().toISOString(),
    contact,
    activities: activitiesResult.rows,
    deals: dealsResult.rows,
    notes,
    custom_fields: customFields,
    audit_history: auditResult.rows,
  };
}

/**
 * Assembles a full GDPR subject-access export for a lead.
 * Read-only; no transaction required.
 *
 * @param id - UUID of the lead
 * @returns Full export payload
 */
export async function getGdprExportForLead(id: string): Promise<LeadGdprExport> {
  const [leadResult, notesResult, cfResult, auditResult] = await Promise.all([
    pool.query<LeadRow>('SELECT * FROM leads WHERE id = $1 LIMIT 1', [id]),

    pool.query<NoteRow>(
      `SELECT
         n.id, n.entity_type, n.entity_id, n.title, n.body, n.body_text,
         n.visibility,
         COALESCE(
           (SELECT array_agg(t.name ORDER BY t.name)
            FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
            WHERE nt.note_id = n.id),
           ARRAY[]::text[]
         ) AS tags,
         n.created_by, n.updated_by, n.created_at, n.updated_at,
         creator.name AS created_by_name,
         updater.name AS updated_by_name
       FROM notes n
       JOIN users creator ON creator.id = n.created_by
       LEFT JOIN users updater ON updater.id = n.updated_by
       WHERE n.entity_type = 'lead' AND n.entity_id = $1 AND n.deleted_at IS NULL
       ORDER BY n.created_at DESC`,
      [id],
    ),

    pool.query<CustomFieldValueRaw>(
      `SELECT
         v.id, v.definition_id, v.record_id, v.value, v.created_at, v.updated_at,
         d.id AS def_id,
         d.entity_type AS def_entity_type,
         d.name AS def_name,
         d.field_type AS def_field_type,
         d.options AS def_options,
         d.sort_order AS def_sort_order,
         d.pii_excluded AS def_pii_excluded,
         d.created_at AS def_created_at
       FROM custom_field_values v
       JOIN custom_field_definitions d ON d.id = v.definition_id AND d.entity_type = 'lead'
       WHERE v.record_id = $1
       ORDER BY d.sort_order ASC, d.name ASC`,
      [id],
    ),

    // Audit history with GDPR masking applied
    pool.query<AuditLogRow>(
      `SELECT
         a.id, a.record_type, a.record_id, a.record_name, a.event_type, a.field_name,
         CASE WHEN g.record_id IS NOT NULL THEN '[GDPR deleted]' ELSE a.old_value END AS old_value,
         CASE WHEN g.record_id IS NOT NULL THEN '[GDPR deleted]' ELSE a.new_value END AS new_value,
         a.changed_by_id, a.changed_by_name, a.created_at
       FROM audit_log a
       LEFT JOIN gdpr_deletion_log g
         ON g.record_id = a.record_id AND g.record_type = a.record_type AND g.completed_at IS NOT NULL
       WHERE a.record_type = 'lead' AND a.record_id = $1
       ORDER BY a.created_at DESC`,
      [id],
    ),
  ]);

  const lead = leadResult.rows[0];

  const customFields: CustomFieldValueWithDefinition[] = cfResult.rows.map((row) => ({
    id: row.id,
    definition_id: row.definition_id,
    record_id: row.record_id,
    value: row.value,
    created_at: row.created_at,
    updated_at: row.updated_at,
    definition: {
      id: row.def_id,
      entity_type: row.def_entity_type,
      name: row.def_name,
      field_type: row.def_field_type,
      options: row.def_options,
      sort_order: row.def_sort_order,
      pii_excluded: row.def_pii_excluded,
      created_at: row.def_created_at,
    },
  }));

  const notes = notesResult.rows as unknown as NoteResponse[];

  return {
    subject: id,
    exported_at: new Date().toISOString(),
    lead,
    notes,
    custom_fields: customFields,
    audit_history: auditResult.rows,
  };
}

// ── Log queries ────────────────────────────────────────────────────────────────

/**
 * Returns a paginated list of GDPR erasure log entries, newest first.
 *
 * @param page - 1-based page number
 * @param limit - Records per page
 * @returns Paginated list of deletion log rows
 */
export async function listGdprDeletions(
  page: number,
  limit: number,
): Promise<PaginatedResponse<GdprDeletionLogRow>> {
  const offset = (page - 1) * limit;

  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM gdpr_deletion_log'),
    pool.query<GdprDeletionLogRow>(
      'SELECT * FROM gdpr_deletion_log ORDER BY requested_at DESC LIMIT $1 OFFSET $2',
      [limit, offset],
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
 * Returns the GDPR deletion log entry for a given record, or null if none exists.
 * Used by detail pages to display the erasure banner.
 *
 * @param recordType - 'contact' or 'lead'
 * @param recordId - UUID of the record
 * @returns The deletion log row, or null if the record has not been erased
 */
export async function getGdprStatusForRecord(
  recordType: string,
  recordId: string,
): Promise<GdprDeletionLogRow | null> {
  const result = await pool.query<GdprDeletionLogRow>(
    'SELECT * FROM gdpr_deletion_log WHERE record_type = $1 AND record_id = $2 LIMIT 1',
    [recordType, recordId],
  );
  return result.rows[0] ?? null;
}

// ── AI data cascade ────────────────────────────────────────────────────────────

/**
 * Cascades a GDPR erasure into AI session data for a contact.
 *
 * This function is designed to be called fire-and-forget (void, never awaited)
 * after the primary GDPR erasure transaction commits. It runs asynchronously so
 * it never blocks or rolls back the primary erasure operation.
 *
 * What it does:
 * 1. Fetches the contact's name and email from gdpr_deletion_log context (the
 *    contact row may already have PII overwritten by the time we run, so we
 *    also accept name/email explicitly from the caller's pre-erasure snapshot).
 * 2. Redacts ai_messages.content where it contains the contact name or email
 *    (case-insensitive ILIKE search; replaces matched substrings in-process
 *    via UPDATE ... WHERE content ILIKE any pattern).
 * 3. Removes user_ai_context entries whose value references the contact name
 *    or email.
 * 4. Inserts a row into ai_gdpr_cascade_log recording counts and outcome.
 * 5. Writes an audit entry on the contact record documenting the cascade.
 *
 * Errors inside this function are caught and logged — they do NOT propagate
 * to the caller, preserving the fire-and-forget contract.
 *
 * @param contactId  - UUID of the contact that was erased
 * @param contactName - Display name captured before PII overwrite
 * @param contactEmail - Email captured before PII overwrite
 * @param actor - Who triggered the cascade (null = system-initiated)
 */
export async function cascadeGdprErasureToAiData(
  contactId: string,
  contactName: string,
  contactEmail: string,
  actor: AuditActor | null,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Build case-insensitive ILIKE search patterns for PII identifiers.
    // ILIKE special characters (%, _) are escaped so a name like "50% Off"
    // cannot accidentally match unrelated rows. An empty contactName (allowed
    // by the DB — first_name NOT NULL but can be '') would produce ILIKE '%%'
    // which matches every row; guard against that by treating empty as absent.
    // contactEmail is always present (contacts.email is NOT NULL and non-empty).
    const escapeLike = (s: string) => s.replace(/([%_\\])/g, '\\$1');
    const hasName = contactName.trim().length > 0;
    const namePat = hasName ? `%${escapeLike(contactName)}%` : null;
    const emailPat = `%${escapeLike(contactEmail)}%`;

    // Escape ERE metacharacters so the value can be passed as a literal pattern
    // to PG regexp_replace with the 'gi' flag. PG ERE treats \. \* etc. as
    // escaped literals, so this JS escaping is compatible. We only produce a
    // nameRegex when contactName is non-empty to avoid an empty-pattern match.
    const escapeEre = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRegex = hasName ? escapeEre(contactName) : null;
    const emailRegex = escapeEre(contactEmail);

    // Step 1 — redact ai_messages.content and clear pending_action containing PII.
    // pending_action JSONB stores pre-PII-filter contact fields (entityName, input fields,
    // summary text) from mutation confirmation flows — it must be cleared on erasure.
    // Redact by email first (always present), then by name when non-empty.
    // Two separate statements are simpler than one dynamic statement with optional clauses.
    // Step 1 — redact ai_messages.content and clear pending_action containing PII.
    // A single UPDATE handles both email and name in one pass so a message matching
    // both identifiers is counted exactly once. When contactName is empty (hasName=false)
    // we omit the name clauses entirely to prevent ILIKE '%%' matching all rows.
    const msgResult = await client.query<{ count: string }>(
      namePat !== null && nameRegex !== null
        ? `WITH updated AS (
             UPDATE ai_messages
             SET
               content = regexp_replace(
                 regexp_replace(content, $1, '[redacted]', 'gi'),
                 $3, '[redacted]', 'gi'
               ),
               pending_action = CASE
                 WHEN pending_action IS NOT NULL AND (
                   pending_action::text ILIKE $2 OR pending_action::text ILIKE $4
                 ) THEN NULL
                 ELSE pending_action
               END
             WHERE content ILIKE $2 OR content ILIKE $4
                OR (pending_action IS NOT NULL AND (
                  pending_action::text ILIKE $2 OR pending_action::text ILIKE $4
                ))
             RETURNING id
           )
           SELECT count(*)::text AS count FROM updated`
        : `WITH updated AS (
             UPDATE ai_messages
             SET
               content = regexp_replace(content, $1, '[redacted]', 'gi'),
               pending_action = CASE
                 WHEN pending_action IS NOT NULL AND pending_action::text ILIKE $2
                 THEN NULL
                 ELSE pending_action
               END
             WHERE content ILIKE $2
                OR (pending_action IS NOT NULL AND pending_action::text ILIKE $2)
             RETURNING id
           )
           SELECT count(*)::text AS count FROM updated`,
      namePat !== null && nameRegex !== null
        ? [emailRegex, emailPat, nameRegex, namePat]
        : [emailRegex, emailPat],
    );
    const messagesRedacted = parseInt(msgResult.rows[0]?.count ?? '0', 10);

    // Step 2 — redact ai_sessions.name where it contains contact PII.
    // Session names may be auto-generated from message content that referenced the contact.
    await client.query(
      `UPDATE ai_sessions
       SET name = '[GDPR deleted]'
       WHERE name ILIKE $1 AND name IS NOT NULL`,
      [emailPat],
    );
    if (namePat !== null) {
      await client.query(
        `UPDATE ai_sessions
         SET name = '[GDPR deleted]'
         WHERE name ILIKE $1 AND name IS NOT NULL`,
        [namePat],
      );
    }

    // Step 3 — remove user_ai_context entries referencing contact PII.
    const ctxResult = await client.query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM user_ai_context
         WHERE value ILIKE $1 ${namePat ? 'OR value ILIKE $2' : ''}
         RETURNING id
       )
       SELECT count(*)::text AS count FROM deleted`,
      namePat ? [emailPat, namePat] : [emailPat],
    );
    const contextEntriesRemoved = parseInt(ctxResult.rows[0]?.count ?? '0', 10);

    // Step 4 — record the cascade outcome.
    // original_name and original_email are stored so a re-run (if this cascade
    // were to fail) could locate the same PII. Because this INSERT is in the same
    // transaction as the redaction, we immediately NULL them out on all log rows
    // for this contact in Step 4b — once the cascade commits successfully the PII
    // is no longer needed for re-runs and must not persist (GDPR Art. 17).
    await client.query(
      `INSERT INTO ai_gdpr_cascade_log
         (contact_id, triggered_by, messages_redacted, context_entries_removed, status,
          original_name, original_email)
       VALUES ($1, $2, $3, $4, 'completed', $5, $6)`,
      [
        contactId,
        actor?.id ?? null,
        messagesRedacted,
        contextEntriesRemoved,
        contactName || null,
        contactEmail || null,
      ],
    );

    // Step 4b — clear original PII from ALL cascade log rows for this contact now
    // that a successful cascade has completed. The data was only needed to support
    // a retry; retaining it after success would leave the erased contact's real
    // name and email in a table with no retention policy (GDPR Art. 17 violation).
    await client.query(
      `UPDATE ai_gdpr_cascade_log
       SET original_name = NULL, original_email = NULL
       WHERE contact_id = $1`,
      [contactId],
    );

    // Step 5 — audit entry on the contact record.
    await writeAuditEntry(client, {
      recordType: 'contact',
      recordId: contactId,
      eventType: 'ai_gdpr_cascade',
      newValue: `AI cascade: ${messagesRedacted} message(s) redacted, ${contextEntriesRemoved} context entry(ies) removed`,
      changedById: actor?.id ?? SYSTEM_ACTOR.id,
      changedByName: actor?.name ?? SYSTEM_ACTOR.name,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');

    // Log the error and record it in the cascade log (best-effort, outside tx).
    // original_name/original_email are stored on failed rows so a re-run can
    // locate the same PII — they remain populated until a successful cascade
    // NULLs them out (Step 4b above).
    const errorMessage = err instanceof Error ? err.message : String(err);
    try {
      await pool.query(
        `INSERT INTO ai_gdpr_cascade_log
           (contact_id, triggered_by, messages_redacted, context_entries_removed, status,
            error_detail, original_name, original_email)
         VALUES ($1, $2, 0, 0, 'failed', $3, $4, $5)`,
        [contactId, actor?.id ?? null, errorMessage, contactName || null, contactEmail || null],
      );
    } catch {
      // Best-effort — if even the error log insert fails, we just log it.
    }
    // Errors are intentionally not re-thrown — this is fire-and-forget.
    logger.error({ err, contactId }, 'gdpr: AI cascade failed');
  } finally {
    client.release();
  }
}

/**
 * Returns all ai_gdpr_cascade_log rows for a given contact, newest first.
 * Used to display the cascade status on the GDPR admin report.
 *
 * @param contactId - UUID of the contact
 */
export async function getAiCascadeLogForContact(contactId: string): Promise<AiGdprCascadeLogRow[]> {
  const result = await pool.query<AiGdprCascadeLogRow>(
    `SELECT * FROM ai_gdpr_cascade_log
     WHERE contact_id = $1
     ORDER BY triggered_at DESC`,
    [contactId],
  );
  return result.rows;
}

/**
 * Returns the original PII values (name, email) from the most recent failed cascade
 * log entry for a contact. Used by re-run cascade logic so the correct search terms
 * are available after the contacts row has been redacted.
 *
 * Successful cascades NULL out original_name/original_email immediately (GDPR Art. 17),
 * so only failed rows retain the values. Returns null when no failed row exists or when
 * the row pre-dates migration 136 (original_name/original_email not yet populated).
 */
export async function getOriginalPiiFromCascadeLog(
  contactId: string,
): Promise<{ original_name: string | null; original_email: string | null } | null> {
  const result = await pool.query<{ original_name: string | null; original_email: string | null }>(
    `SELECT original_name, original_email
     FROM ai_gdpr_cascade_log
     WHERE contact_id = $1
       AND status = 'failed'
       AND (original_name IS NOT NULL OR original_email IS NOT NULL)
     ORDER BY triggered_at DESC
     LIMIT 1`,
    [contactId],
  );
  return result.rows[0] ?? null;
}

/**
 * Returns true if a GDPR erasure record exists for the given contact.
 * Used by the AI cascade handler to guard against cascading on unerased contacts.
 *
 * @param contactId - UUID of the contact
 */
export async function hasGdprErasureForContact(contactId: string): Promise<boolean> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM gdpr_deletion_log WHERE record_type = 'contact' AND record_id = $1 LIMIT 1`,
    [contactId],
  );
  return result.rows.length > 0;
}
