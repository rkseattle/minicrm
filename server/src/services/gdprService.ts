/**
 * GDPR service — handles personal data erasure (Art. 17 right to erasure) and
 * subject-access exports for contacts and leads.
 *
 * Erasure is transactional: the gdpr_deletion_log INSERT, all PII overwrites,
 * and the audit entry are committed together or all roll back.
 *
 * Export is read-only (no transaction required).
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import { captureException } from '../sentry.js';
import { writeAuditEntry, SYSTEM_ACTOR } from './auditService.js';
import { setRlsUserId } from './rlsContextService.js';
import {
  GDPR_PLACEHOLDER_EMAIL_SQL,
  GDPR_REDACTED_SQL,
  GDPR_REDACTED_TEXT,
  erasedAddressDigest,
  erasedPlaceholderAddress,
  lockForErasure,
  redactMessages,
} from './mail/gdprRedaction.js';
import { normalizeAddress } from '../utils/emailAddress.js';
import type { AuditActor, AuditLogRow } from './auditService.js';
import type { NoteResponse } from '@minicrm/shared/schemas/noteSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import type { ContactRow } from './contactService.js';
import type { LeadRow } from './leadsService.js';
import type { ActivityRow } from './activityService.js';
import type { DealRow } from './dealService.js';
import type { CustomFieldValueWithDefinition } from './customFieldService.js';
import { MASKED_AUDIT_VALUES, MASKING_JOIN } from './auditService.js';
import { activityIdsForPerson, scrubActivities } from './activityService.js';
import { deleteLinksForDeletedEntity } from './emailMatchingService.js';
import { redactIntentsForErasure } from './emailSendIntentService.js';
import type { GdprDeletionLogEntry } from '@minicrm/shared/types/gdpr.js';
import { deleteSignalsForContact } from './championBlockerService.js';

// ── PII field lists ────────────────────────────────────────────────────────────

/** Contact personal data fields to erase per GDPR Art. 17 */
const CONTACT_PII_FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'title',
  'department',
  // Address rows are deleted from contact_addresses table
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
  email_messages_redacted: number;
  email_links_deleted: number;
  /** Keyed digest of the erased address, so later mail to it is redacted on ingest. */
  erased_address_hmac: string | null;
}

/** A log row without the address digest, which only ingest needs, before wire conversion. */
type GdprDeletionLogPublicRow = Omit<GdprDeletionLogRow, 'erased_address_hmac'>;

/**
 * The API's shape for a log row. The digest is never selected: a client could test candidate
 * addresses against it if the key ever leaked.
 */
function toDeletionLogEntry(row: GdprDeletionLogPublicRow): GdprDeletionLogEntry {
  return {
    ...row,
    requested_at: row.requested_at.toISOString(),
    completed_at: row.completed_at?.toISOString() ?? null,
  };
}

/** The public columns of a log row, so no read path can return the digest by `*`. */
const DELETION_LOG_PUBLIC_COLUMNS = `id, record_type, record_id, requested_by, requested_at,
  completed_at, erasure_scope, notes, email_messages_redacted, email_links_deleted`;

/**
 * Shortest free-text value the cascade will search for.
 *
 * Unlike a name or email, free text is not an identity: below this it is as
 * likely to be a common phrase, which would redact unrelated messages across
 * every user. Word boundaries do not help against a short phrase.
 */
const MIN_FREE_TEXT_TERM_LENGTH = 12;

/**
 * Longest single term, and longest assembled pattern, the cascade will build.
 *
 * Every term shares one alternation, so one oversized value aborts all of them.
 * Postgres rejects a pattern as too complex somewhere past 32k characters;
 * these are deliberate margins well under that, not the hard limit.
 */
const MAX_TERM_LENGTH = 200;
const MAX_PATTERN_LENGTH = 4_000;

/** Which entity an AI cascade was run for. Matches ai_gdpr_cascade_log.record_type. */
export type CascadeRecordType = 'contact' | 'lead';

/**
 * Cascade outcome as reported to an admin.
 *
 * Deliberately omits original_name/original_email. A failed cascade retains them
 * so a re-run can find the same rows, which means the erased subject's real name
 * and email are still in the table — returning those over the API would hand
 * back the very PII the erasure was performed to remove.
 */
export interface AiGdprCascadeLogEntry {
  id: string;
  record_type: CascadeRecordType;
  record_id: string;
  /** NULL for non-contact rows. */
  contact_id: string | null;
  triggered_at: Date;
  triggered_by: string | null;
  messages_redacted: number;
  context_entries_removed: number;
  status: 'completed' | 'failed';
  error_detail: string | null;
}

/** Full ai_gdpr_cascade_log row, including the retained-for-retry PII columns. */
export interface AiGdprCascadeLogRow extends AiGdprCascadeLogEntry {
  original_name: string | null;
  original_email: string | null;
}

/**
 * One synced message as a subject-access export carries it: the message as stored, the
 * mailbox that synced it, and the records it is linked to. Private threads are included,
 * as private notes are: Art. 15 binds the operator whatever its internal sharing.
 */
export interface GdprEmailMessage {
  id: string;
  mailbox: string;
  direction: 'inbound' | 'outbound';
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  reply_to_addresses: string[];
  subject: string | null;
  sent_at: Date | null;
  has_attachments: boolean;
  body_text: string | null;
  is_private: boolean;
  links: { record_type: string; record_id: string }[];
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
  email_messages: GdprEmailMessage[];
}

/** Full GDPR export payload for a lead */
export interface LeadGdprExport {
  subject: string;
  exported_at: string;
  lead: LeadRow;
  activities: ActivityRow[];
  notes: NoteResponse[];
  custom_fields: CustomFieldValueWithDefinition[];
  audit_history: AuditLogRow[];
  email_messages: GdprEmailMessage[];
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

/** The tables the email cascade touches, appended to erasure_scope beside the record's fields. */
const EMAIL_ERASURE_SCOPE = ['email_messages', 'email_message_links'] as const;

/** What the email part of an erasure touched, for gdpr_deletion_log. */
interface EmailCascadeCounts {
  messagesRedacted: number;
  linksDeleted: number;
}

/**
 * Selects the synced mail one erased record's data subject appears in: any message carrying
 * their address in any address field, in any mailbox, plus any message linked to the record.
 * Used by both erasure and export, so the two can never disagree about what is theirs.
 */
export const EMAIL_SCOPE_FOR_SUBJECT_SQL = `SELECT m.id FROM email_messages m
   WHERE public.email_message_addresses(m.from_address, m.to_addresses, m.cc_addresses,
                                        m.reply_to_addresses) @> ARRAY[$3::text]
   UNION
   SELECT l.email_message_id FROM email_message_links l
    WHERE l.record_type = $1 AND l.record_id = $2`;

/**
 * Redacts the data subject from synced mail and send intents, and drops the record's links.
 * Runs inside the erasure's transaction, after lockForErasure.
 */
async function cascadeErasureToEmail(
  client: PoolClient,
  recordType: CascadeRecordType,
  recordId: string,
  originalEmail: string,
): Promise<EmailCascadeCounts> {
  const address = normalizeAddress(originalEmail);
  const placeholder = erasedPlaceholderAddress(recordId);

  const scope = await client.query<{ id: string }>(EMAIL_SCOPE_FOR_SUBJECT_SQL, [
    recordType,
    recordId,
    address,
  ]);
  const scopeIds = scope.rows.map((r) => r.id);
  // A send's activity on a deal or account carries the mail's text.
  const activityIds = await activityIdsForPerson(client, { recordType, recordId }, scopeIds);
  const messagesRedacted = await redactMessages(client, scopeIds, address, placeholder);
  await scrubActivities(client, activityIds, GDPR_REDACTED_TEXT, 'gdpr_erasure');

  const linksDeleted = await deleteLinksForDeletedEntity(client, recordType, recordId);
  await redactIntentsForErasure(client, { recordType, recordId }, address, placeholder);

  return { messagesRedacted, linksDeleted };
}

/**
 * Erases personal data for a contact per GDPR Art. 17.
 *
 * Single transaction, taking the exclusive GDPR ingest lock first so mail being stored
 * concurrently is committed, and then redacted, before the cascade reads it:
 * 1. Verify the contact exists.
 * 2. Check that erasure has not already been performed.
 * 3. Insert a pending gdpr_deletion_log row.
 * 4. Overwrite PII fields on the contacts row.
 * 5. Delete the contact's addresses.
 * 6. Scrub subject/notes on linked activities.
 * 7. Scrub linked notes (soft-delete–aware).
 * 8. Delete custom field values.
 * 9. Redact the subject from synced mail and send intents; delete the record's links.
 * 10. Mark the log row completed, with the email counts and the address digest.
 * 11. Write an audit entry.
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
    // First, before any intent or message row: ingest holds this shared until it commits.
    await lockForErasure(client);

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
         first_name = ${GDPR_REDACTED_SQL},
         last_name = ${GDPR_REDACTED_SQL},
         email = ${GDPR_PLACEHOLDER_EMAIL_SQL},
         phone = NULL,
         title = NULL,
         department = NULL,
         linkedin_url = NULL,
         twitter_x_url = NULL,
         other_url = NULL
       WHERE id = $1`,
      [id],
    );

    // Step 5 — delete all contact_addresses rows (address data is PII).
    await client.query(`DELETE FROM contact_addresses WHERE contact_id = $1`, [id]);

    // Step 6 — scrub subject and notes on linked activities
    const own = await client.query<{ id: string }>(
      'SELECT id FROM activities WHERE contact_id = $1',
      [id],
    );
    await scrubActivities(
      client,
      own.rows.map((row) => row.id),
      GDPR_REDACTED_TEXT,
      'gdpr_erasure',
    );
    // The AI's inference about the person, with quotes from their mail and notes.
    await deleteSignalsForContact(client, id);

    // Step 7 — scrub linked notes. Soft-deleted rows are included: the row still holds
    // the subject's personal data, and nothing else ever purges it.
    await client.query(
      `UPDATE notes SET title = NULL, body = ${GDPR_REDACTED_SQL}, body_text = ${GDPR_REDACTED_SQL}
       WHERE entity_type = 'contact' AND entity_id = $1`,
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

    // Step 9 — redact the subject from synced mail and drop the record's links
    const email = await cascadeErasureToEmail(client, 'contact', id, contactEmail);

    // Step 10 — mark the log row as completed, with what the email cascade touched
    const logResult = await client.query<GdprDeletionLogRow>(
      `UPDATE gdpr_deletion_log
          SET completed_at = now(),
              email_messages_redacted = $2,
              email_links_deleted = $3,
              erased_address_hmac = $4,
              erasure_scope = erasure_scope || $5::text[]
        WHERE record_type = 'contact' AND record_id = $1
        RETURNING *`,
      [
        id,
        email.messagesRedacted,
        email.linksDeleted,
        erasedAddressDigest(contactEmail),
        EMAIL_ERASURE_SCOPE,
      ],
    );
    const logRow = logResult.rows[0];

    // Step 11 — audit entry in the same transaction
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
    void cascadeGdprErasureToAiData(id, 'contact', contactName, contactEmail, actor);

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
 * Single transaction, taking the exclusive GDPR ingest lock first, as eraseContact does:
 * 1. Verify the lead exists.
 * 2. Check that erasure has not already been performed.
 * 3. Insert a pending gdpr_deletion_log row.
 * 4. Overwrite PII fields on the leads row.
 * 5. Scrub linked notes (soft-delete–aware).
 * 6. Delete custom field values.
 * 7. Redact the subject from synced mail and send intents; delete the record's links.
 * 8. Mark the log row completed, with the email counts and the address digest.
 * 9. Write an audit entry.
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
    // First, before any intent or message row: ingest holds this shared until it commits.
    await lockForErasure(client);

    // Step 1 — verify the lead exists and capture PII before overwrite.
    // Name and email are captured here so the AI cascade (fired after COMMIT)
    // can search ai_messages for the original values, not the placeholders.
    const leadResult = await client.query<{
      id: string;
      first_name: string;
      last_name: string | null;
      email: string;
      company_name: string | null;
      notes: string | null;
    }>(
      'SELECT id, first_name, last_name, email, company_name, notes FROM leads WHERE id = $1 LIMIT 1',
      [id],
    );
    if (leadResult.rows.length === 0) {
      throw Object.assign(new Error('Lead not found'), { code: 'NOT_FOUND' });
    }
    const leadPii = leadResult.rows[0];
    const leadName = [leadPii.first_name, leadPii.last_name].filter(Boolean).join(' ');
    const leadEmail = leadPii.email;

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
         first_name = ${GDPR_REDACTED_SQL},
         last_name = NULL,
         email = ${GDPR_PLACEHOLDER_EMAIL_SQL},
         phone = NULL,
         company_name = NULL,
         notes = NULL
       WHERE id = $1`,
      [id],
    );

    // Step 5 — scrub linked notes, soft-deleted rows included
    await client.query(
      `UPDATE notes SET title = NULL, body = ${GDPR_REDACTED_SQL}, body_text = ${GDPR_REDACTED_SQL}
       WHERE entity_type = 'lead' AND entity_id = $1`,
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

    // Step 7 — redact the subject from synced mail and drop the record's links
    const email = await cascadeErasureToEmail(client, 'lead', id, leadEmail);

    // Step 8 — mark the log row as completed, with what the email cascade touched
    const logResult = await client.query<GdprDeletionLogRow>(
      `UPDATE gdpr_deletion_log
          SET completed_at = now(),
              email_messages_redacted = $2,
              email_links_deleted = $3,
              erased_address_hmac = $4,
              erasure_scope = erasure_scope || $5::text[]
        WHERE record_type = 'lead' AND record_id = $1
        RETURNING *`,
      [
        id,
        email.messagesRedacted,
        email.linksDeleted,
        erasedAddressDigest(leadEmail),
        EMAIL_ERASURE_SCOPE,
      ],
    );
    const logRow = logResult.rows[0];

    // Step 9 — audit entry in the same transaction
    await writeAuditEntry(client, {
      recordType: 'lead',
      recordId: id,
      eventType: 'gdpr_erasure',
      newValue: 'Personal data erased per GDPR Art. 17 request',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    // Fire-and-forget AI cascade, after COMMIT so it never blocks or rolls back
    // the primary erasure. Errors are caught and logged inside the cascade.
    //
    // company_name and notes are searched too: eraseLead scrubs them from the
    // row, and both reach ai_messages as free text.
    void cascadeGdprErasureToAiData(id, 'lead', leadName, leadEmail, actor, [
      leadPii.company_name,
      leadPii.notes,
    ]);

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
 * The activities an export owes the subject: a contact's own, and every activity erasure would
 * scrub as theirs (activityIdsForPerson over the same scope), so the two never disagree.
 */
async function getActivitiesForSubject(
  recordType: CascadeRecordType,
  recordId: string,
  scopeIds: readonly string[],
): Promise<ActivityRow[]> {
  const theirs = await activityIdsForPerson(pool, { recordType, recordId }, scopeIds);
  const result = await pool.query<ActivityRow>(
    `SELECT a.*, u.name AS owner_name
       FROM activities a
       JOIN users u ON u.id = a.owner_id
      WHERE ($1 = 'contact' AND a.contact_id = $2) OR a.id = ANY($3::uuid[])
      ORDER BY a.created_at DESC`,
    [recordType, recordId, theirs],
  );
  return result.rows;
}

/** The ids of the synced mail in the subject's scope, read once for a whole export. */
async function emailScopeForSubject(
  recordType: CascadeRecordType,
  recordId: string,
  email: string,
): Promise<string[]> {
  const scope = await pool.query<{ id: string }>(EMAIL_SCOPE_FOR_SUBJECT_SQL, [
    recordType,
    recordId,
    normalizeAddress(email),
  ]);
  return scope.rows.map((r) => r.id);
}

/** The synced mail a subject-access export includes; the same scope erasure redacts. */
async function getEmailMessagesForSubject(
  scopeIds: readonly string[],
): Promise<GdprEmailMessage[]> {
  const result = await pool.query<GdprEmailMessage>(
    `SELECT m.id, ca.email_address AS mailbox, m.direction, m.from_address, m.to_addresses,
            m.cc_addresses, m.reply_to_addresses, m.subject, m.sent_at, m.has_attachments,
            m.message_body_text AS body_text,
            m.is_private,
            COALESCE(
              (SELECT json_agg(json_build_object('record_type', l.record_type,
                                                 'record_id', l.record_id)
                               ORDER BY l.record_type, l.record_id)
                 FROM email_message_links l WHERE l.email_message_id = m.id),
              '[]'::json) AS links
       FROM email_messages m
       JOIN connected_accounts ca ON ca.id = m.connected_account_id
      WHERE m.id = ANY($1::uuid[])
      ORDER BY m.sent_at DESC NULLS LAST, m.id`,
    [scopeIds],
  );
  return result.rows;
}

/**
 * Assembles a full GDPR subject-access export for a contact.
 * Read-only; no transaction required.
 *
 * Audit history is returned with read-time masking applied (MASKING_JOIN in
 * auditService): '[GDPR deleted]' once erasure is complete, '[Private]' for entries a
 * private-thread scrub hid.
 *
 * @param id - UUID of the contact
 * @returns Full export payload
 * @throws Error with code NOT_FOUND when no such contact exists
 */
export async function getGdprExportForContact(id: string): Promise<ContactGdprExport> {
  const [contactResult, dealsResult, notesResult, cfResult, auditResult] = await Promise.all([
    pool.query<ContactRow>('SELECT * FROM contacts WHERE id = $1 LIMIT 1', [id]),

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
         -- Private notes are included: Art. 15 entitles the subject to all personal data
         -- held about them, and note visibility is an internal access control, not a
         -- carve-out from that right.
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
           a.id, a.record_type, a.record_id, a.event_type, a.field_name,
           ${MASKED_AUDIT_VALUES},
           a.changed_by_id, a.changed_by_name, a.created_at
         FROM audit_log a
         ${MASKING_JOIN}
         WHERE a.record_type = 'contact' AND a.record_id = $1
         ORDER BY a.created_at DESC`,
      [id],
    ),
  ]);

  const contact = contactResult.rows[0];
  if (!contact) {
    throw Object.assign(new Error('Contact not found'), { code: 'NOT_FOUND' });
  }
  // One scope for the whole export, so its activities and messages describe the same mail.
  const scopeIds = await emailScopeForSubject('contact', id, contact.email);

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
    activities: await getActivitiesForSubject('contact', id, scopeIds),
    deals: dealsResult.rows,
    notes,
    custom_fields: customFields,
    audit_history: auditResult.rows,
    email_messages: await getEmailMessagesForSubject(scopeIds),
  };
}

/**
 * Assembles a full GDPR subject-access export for a lead.
 * Read-only; no transaction required.
 *
 * @param id - UUID of the lead
 * @returns Full export payload
 * @throws Error with code NOT_FOUND when no such lead exists
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
       -- Private notes included, as on the contact export: Art. 15 covers all personal
       -- data held about the subject.
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
         a.id, a.record_type, a.record_id, a.event_type, a.field_name,
           ${MASKED_AUDIT_VALUES},
         a.changed_by_id, a.changed_by_name, a.created_at
       FROM audit_log a
       ${MASKING_JOIN}
       WHERE a.record_type = 'lead' AND a.record_id = $1
       ORDER BY a.created_at DESC`,
      [id],
    ),
  ]);

  const lead = leadResult.rows[0];
  if (!lead) {
    throw Object.assign(new Error('Lead not found'), { code: 'NOT_FOUND' });
  }
  const scopeIds = await emailScopeForSubject('lead', id, lead.email);

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
    activities: await getActivitiesForSubject('lead', id, scopeIds),
    email_messages: await getEmailMessagesForSubject(scopeIds),
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
): Promise<PaginatedResponse<GdprDeletionLogEntry>> {
  const offset = (page - 1) * limit;

  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM gdpr_deletion_log'),
    pool.query<GdprDeletionLogPublicRow>(
      `SELECT ${DELETION_LOG_PUBLIC_COLUMNS} FROM gdpr_deletion_log
        ORDER BY requested_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
  ]);

  return {
    data: dataResult.rows.map(toDeletionLogEntry),
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
): Promise<GdprDeletionLogEntry | null> {
  const result = await pool.query<GdprDeletionLogPublicRow>(
    `SELECT ${DELETION_LOG_PUBLIC_COLUMNS} FROM gdpr_deletion_log
      WHERE record_type = $1 AND record_id = $2 LIMIT 1`,
    [recordType, recordId],
  );
  const row = result.rows[0];
  return row ? toDeletionLogEntry(row) : null;
}

// ── AI data cascade ────────────────────────────────────────────────────────────

/**
 * Cascades a GDPR erasure into AI session data for a contact or a lead.
 *
 * This function is designed to be called fire-and-forget (void, never awaited)
 * after the primary GDPR erasure transaction commits. It runs asynchronously so
 * it never blocks or rolls back the primary erasure operation.
 *
 * What it does:
 * 1. Searches for the name and email the caller captured before the erasure
 *    overwrote the row, plus any free-text identifiers within the length bounds.
 * 2. Redacts ai_messages.content wherever an identifier appears, and clears
 *    pending_action when it references one.
 * 3. Redacts ai_sessions.name and removes matching user_ai_context entries.
 * 4. Inserts a row into ai_gdpr_cascade_log recording counts and outcome.
 * 5. Writes an audit entry on the erased record documenting the cascade.
 *
 * Errors inside this function are caught and logged — they do NOT propagate
 * to the caller, preserving the fire-and-forget contract.
 *
 * @param recordId - UUID of the record that was erased
 * @param recordType - Which entity the record is
 * @param originalName - Display name captured before overwrite; stored on a failed
 *   row so a re-run can recover it
 * @param originalEmail - Email captured before overwrite, stored the same way
 * @param actor - Who triggered the cascade (null = system-initiated)
 * @param extraIdentifiers - Further PII the erasure scrubs, such as a lead's
 *   company_name and notes. NOT persisted, so a re-run after a failed cascade
 *   searches on name and email alone — the erasure has already NULLed these on
 *   the row and nothing else holds them.
 */
export async function cascadeGdprErasureToAiData(
  recordId: string,
  recordType: CascadeRecordType,
  originalName: string | null,
  originalEmail: string | null,
  actor: AuditActor | null,
  extraIdentifiers: readonly (string | null)[] = [],
): Promise<void> {
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // Match on word boundaries, not substrings. The cascade's statements carry no
    // ownership predicate — every user shares one data namespace (ADR-001) and no
    // column links a record to the rows mentioning it — so precision is the only
    // safeguard: a substring search for a lead named "Ann" also rewrites "annual".
    const escapeEre = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // \m and \M assert a position adjacent to a word character, so anchoring a
    // term that starts or ends with punctuation ("Acme Corp.") can never match.
    // Anchor each end only where the term actually has a word character there.
    //
    // Unicode-aware, matching what Postgres counts as a word character rather
    // than JavaScript's ASCII-only \w: a name like "李明" tests false on both
    // ends under \w, so it would go in unanchored and match as a substring —
    // inside "李明华", and across every user's AI data.
    const WORD_CHAR_START = /^[\p{L}\p{N}_]/u;
    const WORD_CHAR_END = /[\p{L}\p{N}_]$/u;
    const anchorTerm = (term: string) => {
      const leading = WORD_CHAR_START.test(term) ? '\\m' : '';
      const trailing = WORD_CHAR_END.test(term) ? '\\M' : '';
      return `${leading}${escapeEre(term)}${trailing}`;
    };

    // The cap applies to every term, identity included. leads.first_name,
    // last_name, and email are unbounded `text` — contacts are varchar(255) and
    // safe only incidentally — so an oversized name would otherwise abort the
    // whole cascade with "regular expression is too complex", redacting nothing
    // while the erasure still reported success. Capped here rather than in the
    // Zod schema so a row written directly to the database is covered too.
    const identity = [originalName, originalEmail]
      .map((value) => (value ?? '').trim())
      .filter((value) => value.length > 0);

    // Free text is not an identity, so it also carries a minimum: a notes value
    // of "Follow up" would redact that phrase from every user's messages, which
    // word boundaries do nothing to prevent.
    const freeText = extraIdentifiers
      .map((value) => (value ?? '').trim())
      .filter((value) => value.length > 0);

    const candidates = [...identity, ...freeText];
    const searchTerms = [
      ...identity.filter((value) => value.length <= MAX_TERM_LENGTH),
      ...freeText.filter(
        (value) => value.length >= MIN_FREE_TEXT_TERM_LENGTH && value.length <= MAX_TERM_LENGTH,
      ),
    ];

    const skipped = candidates.length - searchTerms.length;
    if (skipped > 0) {
      // Either bound leaves references to the skipped value in AI data while the
      // cascade still reports completed, so the omission has to be visible.
      logger.warn(
        { recordId, recordType, skipped },
        'gdpr: cascade skipped identifiers outside the searchable length bounds',
      );
    }

    // Every erasure path supplies an email, NOT NULL on both contacts and leads,
    // so an empty set means the caller passed nothing searchable. Proceeding would
    // match nothing, which a 'completed' row would misreport as a successful purge.
    if (searchTerms.length === 0) {
      throw new Error('cascade requires at least one non-empty PII identifier');
    }

    // One alternation rather than nested replaces: a nested replace runs against
    // text an earlier layer already rewrote, so a term that is a substring of
    // '[redacted]' would mangle the placeholder just written.
    const boundedPattern = searchTerms.map(anchorTerm).join('|');

    // Per-term caps bound the total, but assert it: PG rejects a pattern it
    // considers too complex, and that rejection aborts every term at once.
    if (boundedPattern.length > MAX_PATTERN_LENGTH) {
      throw new Error(
        `cascade pattern of ${boundedPattern.length} characters exceeds the ${MAX_PATTERN_LENGTH} cap`,
      );
    }
    const queryParams = [boundedPattern];

    const redactExpression = `regexp_replace(content, $1, '[redacted]', 'gi')`;
    const contentMatches = `content ~* $1`;
    const pendingMatches = `pending_action::text ~* $1`;

    // Step 1 — redact ai_messages.content and clear pending_action containing PII.
    // pending_action JSONB stores pre-PII-filter record fields (entityName, input
    // fields, summary text) from mutation confirmation flows — it must be cleared
    // on erasure. One UPDATE covers every identifier so a message matching several
    // is counted exactly once.
    const msgResult = await client.query<{ count: string }>(
      `WITH updated AS (
         UPDATE ai_messages
         SET
           content = ${redactExpression},
           pending_action = CASE
             WHEN pending_action IS NOT NULL AND (${pendingMatches}) THEN NULL
             ELSE pending_action
           END
         WHERE ${contentMatches}
            OR (pending_action IS NOT NULL AND (${pendingMatches}))
         RETURNING id
       )
       SELECT count(*)::text AS count FROM updated`,
      queryParams,
    );
    const messagesRedacted = parseInt(msgResult.rows[0]?.count ?? '0', 10);

    // Step 2 — redact ai_sessions.name where it contains record PII.
    // Session names may be auto-generated from message content that referenced it.
    await client.query(
      `UPDATE ai_sessions
       SET name = ${GDPR_REDACTED_SQL}
       WHERE name IS NOT NULL AND name ~* $1`,
      queryParams,
    );

    // Step 3 — remove user_ai_context entries referencing record PII.
    const ctxResult = await client.query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM user_ai_context
         WHERE value ~* $1
         RETURNING id
       )
       SELECT count(*)::text AS count FROM deleted`,
      queryParams,
    );
    const contextEntriesRemoved = parseInt(ctxResult.rows[0]?.count ?? '0', 10);

    // Step 4 — record the cascade outcome.
    // original_name and original_email are stored so a re-run (if this cascade
    // were to fail) could locate the same PII. Because this INSERT is in the same
    // transaction as the redaction, we immediately NULL them out on all log rows
    // for this record in Step 4b — once the cascade commits successfully the PII
    // is no longer needed for re-runs and must not persist (GDPR Art. 17).
    await client.query(
      `INSERT INTO ai_gdpr_cascade_log
         (record_type, record_id, contact_id, triggered_by, messages_redacted,
          context_entries_removed, status, original_name, original_email)
       VALUES ($7, $1, $8, $2, $3, $4, 'completed', $5, $6)`,
      [
        recordId,
        actor?.id ?? null,
        messagesRedacted,
        contextEntriesRemoved,
        originalName,
        originalEmail,
        recordType,
        recordType === 'contact' ? recordId : null,
      ],
    );

    // Step 4b — clear original PII from ALL cascade log rows for this record now
    // that a successful cascade has completed. The data was only needed to support
    // a retry; retaining it after success would leave the erased subject's real
    // name and email in a table with no retention policy (GDPR Art. 17 violation).
    await client.query(
      `UPDATE ai_gdpr_cascade_log
       SET original_name = NULL, original_email = NULL
       WHERE record_type = $2 AND record_id = $1`,
      [recordId, recordType],
    );

    // Step 5 — audit entry on the erased record.
    await writeAuditEntry(client, {
      recordType,
      recordId,
      eventType: 'ai_gdpr_cascade',
      newValue: `AI cascade: ${messagesRedacted} message(s) redacted, ${contextEntriesRemoved} context entry(ies) removed`,
      changedById: actor?.id ?? SYSTEM_ACTOR.id,
      changedByName: actor?.name ?? SYSTEM_ACTOR.name,
    });

    await client.query('COMMIT');
  } catch (err) {
    // A throwing ROLLBACK would escape before the failure row is written.
    if (client) {
      await client.query('ROLLBACK').catch((rollbackErr: unknown) => {
        logger.error({ err: rollbackErr, recordId, recordType }, 'gdpr: cascade rollback failed');
      });
    }

    // Record the failure in the cascade log (best-effort, outside tx).
    // original_name/original_email are stored on failed rows so a re-run can
    // locate the same PII — they remain populated until a successful cascade
    // NULLs them out (Step 4b above).
    const errorMessage = err instanceof Error ? err.message : String(err);
    try {
      await pool.query(
        `INSERT INTO ai_gdpr_cascade_log
           (record_type, record_id, contact_id, triggered_by, messages_redacted,
            context_entries_removed, status, error_detail, original_name, original_email)
         VALUES ($6, $1, $7, $2, 0, 0, 'failed', $3, $4, $5)`,
        [
          recordId,
          actor?.id ?? null,
          errorMessage,
          originalName,
          originalEmail,
          recordType,
          recordType === 'contact' ? recordId : null,
        ],
      );
    } catch (logErr) {
      // Nothing recorded the failure, so the log is the only remaining trace:
      // an absent row is indistinguishable from a cascade that never ran.
      logger.error(
        { err: logErr, recordId, recordType },
        'gdpr: AI cascade failure could not be recorded',
      );
      captureException(logErr);
    }
    // An incomplete Art. 17 erasure is a compliance incident and nothing else
    // escalates one. captureException sends the error alone and redactPiiFromEvent
    // drops `extra`, so no subject PII leaves the process.
    logger.error({ err, recordId, recordType }, 'gdpr: AI cascade failed');
    captureException(err);
  } finally {
    client?.release();
  }
}

/**
 * Returns all ai_gdpr_cascade_log rows for a given record, newest first.
 * Used to display the cascade status on the GDPR admin report.
 *
 * @param recordId - UUID of the erased record
 * @param recordType - Which entity the record is
 */
export async function getAiCascadeLogForRecord(
  recordId: string,
  recordType: CascadeRecordType,
): Promise<AiGdprCascadeLogEntry[]> {
  // Explicit columns: original_name and original_email must not leave the server.
  const result = await pool.query<AiGdprCascadeLogEntry>(
    `SELECT id, record_type, record_id, contact_id, triggered_at, triggered_by,
            messages_redacted, context_entries_removed, status, error_detail
     FROM ai_gdpr_cascade_log
     WHERE record_type = $2 AND record_id = $1
     ORDER BY triggered_at DESC`,
    [recordId, recordType],
  );
  return result.rows;
}

/**
 * Returns the original PII values (name, email) from the most recent failed cascade
 * log entry for a record. Used by re-run cascade logic so the correct search terms
 * are available after the record's own row has been redacted.
 *
 * Successful cascades NULL out original_name/original_email immediately (GDPR Art. 17),
 * so only failed rows retain the values. Returns null when no failed row exists, or when
 * the row pre-dates the columns and never captured them.
 */
export async function getOriginalPiiFromCascadeLog(
  recordId: string,
  recordType: CascadeRecordType,
): Promise<Pick<AiGdprCascadeLogRow, 'original_name' | 'original_email'> | null> {
  const result = await pool.query<Pick<AiGdprCascadeLogRow, 'original_name' | 'original_email'>>(
    `SELECT original_name, original_email
     FROM ai_gdpr_cascade_log
     WHERE record_type = $2 AND record_id = $1
       AND status = 'failed'
       AND (original_name IS NOT NULL OR original_email IS NOT NULL)
     ORDER BY triggered_at DESC
     LIMIT 1`,
    [recordId, recordType],
  );
  return result.rows[0] ?? null;
}

/**
 * Returns true if a GDPR erasure record exists for the given record.
 * Used by the AI cascade handler to guard against cascading on unerased records.
 *
 * @param recordId - UUID of the record
 * @param recordType - Which entity the record is
 */
export async function hasGdprErasureForRecord(
  recordId: string,
  recordType: CascadeRecordType,
): Promise<boolean> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM gdpr_deletion_log WHERE record_type = $2 AND record_id = $1 LIMIT 1`,
    [recordId, recordType],
  );
  return result.rows.length > 0;
}
