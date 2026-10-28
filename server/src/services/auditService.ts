/**
 * Audit service — write and query structured audit log entries.
 * All writes go through this module. Entries are always written inside the
 * caller's transaction so a failed audit write rolls back the triggering change
 * and vice versa.
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import {
  GDPR_REDACTED_SQL,
  GDPR_REDACTED_TEXT,
  erasedAddressDigest,
} from './mail/gdprRedaction.js';
import logger from '../logger.js';
import type { AuditNotification } from './auditEventBus.js';
import type { AUDIT_EVENT_TYPES, AUDIT_RECORD_TYPES } from '@minicrm/shared/schemas/auditSchema.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export { SYSTEM_ACTOR, actorIdOrNull, type AuditActor } from './auditActor.js';

/** Record types that can appear in the audit log; the list lives in the shared schema. */
export type AuditRecordType = (typeof AUDIT_RECORD_TYPES)[number];

/** Event types that can appear in the audit log; the list lives in the shared schema. */
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/** Input for a single audit log entry */
export interface AuditEntryInput {
  /** The type of entity affected */
  recordType: AuditRecordType;
  /** UUID of the affected record (omit for system-level events) */
  recordId?: string | null;
  /** Human-readable name of the record at the time of the event */
  recordName?: string | null;
  /** Type of change event */
  eventType: AuditEventType;
  /** For 'updated' events: the field that changed (omit for non-field events) */
  fieldName?: string | null;
  /** Previous value (omit for sensitive fields or non-field events) */
  oldValue?: string | null;
  /** New value (omit for sensitive fields or non-field events) */
  newValue?: string | null;
  /** UUID of the user performing the action */
  changedById?: string | null;
  /** Display name of the user performing the action */
  changedByName?: string | null;
  /** Source of the write operation: AI assistant or NULL for human/REST */
  source?: 'AI (NLI)' | 'AI (context)' | null;
}

/** A row returned from the audit_log table */
export interface AuditLogRow {
  id: string;
  record_type: AuditRecordType;
  record_id: string | null;
  record_name: string | null;
  event_type: AuditEventType;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  changed_by_id: string | null;
  changed_by_name: string | null;
  source: string | null;
  created_at: Date;
}

/**
 * Fields whose values are never written to the audit log.
 * The event is still recorded, but old_value and new_value are omitted.
 */
const SENSITIVE_FIELDS = new Set([
  'password_hash',
  'secret_access_key',
  'password_reset_token_hash',
]);

// ── Write helpers ─────────────────────────────────────────────────────────────

/**
 * Writes a single audit log entry inside an existing transaction.
 * Callers must supply the active PoolClient — this function never acquires its own.
 *
 * @param client - Active PoolClient from the caller's BEGIN/COMMIT transaction
 * @param entry - The audit entry to write
 */
export async function writeAuditEntry(client: PoolClient, entry: AuditEntryInput): Promise<void> {
  const isSensitive = entry.fieldName != null && SENSITIVE_FIELDS.has(entry.fieldName);

  await client.query(
    `INSERT INTO audit_log
       (record_type, record_id, record_name, event_type, field_name, old_value, new_value, changed_by_id, changed_by_name, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.recordType,
      entry.recordId ?? null,
      entry.recordName ?? null,
      entry.eventType,
      entry.fieldName ?? null,
      isSensitive ? null : (entry.oldValue ?? null),
      isSensitive ? null : (entry.newValue ?? null),
      entry.changedById ?? null,
      entry.changedByName ?? null,
      entry.source ?? null,
    ],
  );
}

/**
 * Writes multiple audit log entries in a single transaction.
 * Use this when one action produces several field-level change entries.
 *
 * @param client - Active PoolClient from the caller's transaction
 * @param entries - Array of audit entries to write
 */
export async function writeAuditEntries(
  client: PoolClient,
  entries: AuditEntryInput[],
): Promise<void> {
  for (const entry of entries) {
    await writeAuditEntry(client, entry);
  }
}

// ── Field diff helper ─────────────────────────────────────────────────────────

/**
 * Maps internal field names (DB column names) to human-readable display labels.
 * Used when generating field_name values in audit entries.
 */
const FIELD_DISPLAY_NAMES: Record<string, string> = {
  // Contacts
  first_name: 'First Name',
  last_name: 'Last Name',
  email: 'Email',
  phone: 'Phone',
  title: 'Title',
  department: 'Department',
  account_id: 'Account',
  owner_id: 'Owner',
  // Accounts
  name: 'Name',
  industry: 'Industry',
  website: 'Website',
  employee_range: 'Employee Range',
  revenue_range: 'Revenue Range',
  // Deals
  stage: 'Stage',
  value: 'Deal Value',
  close_date: 'Close Date',
  loss_reason: 'Loss Reason',
  // Users
  role: 'Role',
  status: 'Status',
  // Settings
  default_language: 'Default Language',
  nav_layout: 'Navigation Layout',
  email_notifications_enabled: 'Email Notifications',
  // Connected mailboxes
  sync_paused: 'Sync Paused',
  excluded_domains: 'Excluded Domains',
};

/**
 * Returns the display name for a field, falling back to the raw field name if not mapped.
 *
 * @param fieldName - DB column name
 * @returns Human-readable display label
 */
export function getFieldDisplayName(fieldName: string): string {
  return FIELD_DISPLAY_NAMES[fieldName] ?? fieldName;
}

/**
 * Computes the set of changed fields between two record snapshots.
 * Returns one AuditEntryInput per changed field (event_type = 'updated').
 * Fields whose values did not change are omitted.
 * Sensitive fields are included in the entries but with null values.
 *
 * @param before - Snapshot of the record before the change
 * @param after - Snapshot of the record after the change
 * @param base - Common fields for all generated entries (recordType, recordId, etc.)
 * @returns Array of per-field audit entry inputs; empty if nothing changed
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  base: Omit<AuditEntryInput, 'eventType' | 'fieldName' | 'oldValue' | 'newValue'>,
): AuditEntryInput[] {
  const entries: AuditEntryInput[] = [];

  for (const key of Object.keys(after)) {
    // Skip internal metadata columns
    if (key === 'id' || key === 'created_at' || key === 'updated_at') continue;

    const oldVal = before[key];
    const newVal = after[key];

    // Normalize: treat null and undefined as equivalent
    const normalizedOld = oldVal ?? null;
    const normalizedNew = newVal ?? null;

    if (normalizedOld === normalizedNew) continue;
    if (
      normalizedOld !== null &&
      normalizedNew !== null &&
      String(normalizedOld) === String(normalizedNew)
    )
      continue;

    entries.push({
      ...base,
      eventType: 'updated',
      fieldName: getFieldDisplayName(key),
      oldValue: normalizedOld !== null ? String(normalizedOld) : null,
      newValue: normalizedNew !== null ? String(normalizedNew) : null,
    });
  }

  return entries;
}

// ── Query helpers ─────────────────────────────────────────────────────────────

/** Options for querying audit log entries for a single record */
interface GetRecordAuditLogOptions {
  recordType: AuditRecordType;
  recordId: string;
  /** Maximum number of entries to return; defaults to 20 */
  limit?: number;
  /** When true, returns all entries (overrides limit) */
  all?: boolean;
}

/** Options for querying the system-wide audit log (admin) */
export interface ListAuditLogOptions {
  /** ISO date string — only entries at or after this timestamp */
  from?: string;
  /** ISO date string — only entries at or before this timestamp */
  to?: string;
  /** Filter by the ID of the user who made the change */
  userId?: string;
  /** Filter by record type */
  recordType?: AuditRecordType;
  /** Filter by the UUID of the record that was changed */
  recordId?: string;
  /** Filter by event type */
  eventType?: AuditEventType;
  /** Filter by source: 'AI (NLI)' | 'AI (context)' | 'human' (NULL rows) */
  source?: 'AI (NLI)' | 'AI (context)' | 'human';
  /** 1-based page number; defaults to 1 */
  page?: number;
  /** Records per page; defaults to 50 */
  limit?: number;
}

/** Paginated response shape for audit log queries */
export interface AuditLogPage {
  data: AuditLogRow[];
  total: number;
  page: number;
  limit: number;
}

/** The audit events whose value names recipients' addresses rather than a record's fields. */
const ADDRESS_BEARING_EVENTS: ReadonlySet<string> = new Set([
  'email_sent',
  'email_send_unconfirmed',
]);

/** The value of an `email_sent` entry, written when a send is filed. */
export interface EmailSentAuditValue {
  message_id: string;
  recipient_count: number;
  to: readonly string[];
  cc: readonly string[];
  linked_records: readonly string[];
}

/** The value of an `email_send_unconfirmed` entry, written when the sweep gives up on one. */
export interface EmailSendUnconfirmedAuditValue {
  intent_id: string;
  provider_confirmed: boolean;
  to: readonly string[];
  cc: readonly string[];
  sent_from_record: string | null;
}

/** The recipient lists those entries carry; both value types above share them. */
const RECIPIENT_FIELDS = ['to', 'cc'] as const satisfies readonly (keyof EmailSentAuditValue &
  keyof EmailSendUnconfirmedAuditValue)[];

/** Each row's send-entry value, parsed; null for any other event or an unparseable value. */
function parsedSendValues(
  rows: readonly { id?: string; event_type: string; new_value: string | null }[],
): (Record<string, unknown> | null)[] {
  return rows.map((row) =>
    ADDRESS_BEARING_EVENTS.has(row.event_type) ? parseRecipients(row) : null,
  );
}

/** The fields that say who a send concerned, hidden for a send in a private thread. */
const PRIVATE_SEND_FIELDS = [
  'to',
  'cc',
  'linked_records',
  'sent_from_record',
] as const satisfies readonly (keyof EmailSentAuditValue | keyof EmailSendUnconfirmedAuditValue)[];

/**
 * Parses an address-bearing value, or null when it is not the JSON object filing writes.
 * A value that does not parse is shown as stored, so it is logged: masking could not reach it.
 */
function parseRecipients(row: {
  id?: string;
  new_value: string | null;
}): Record<string, unknown> | null {
  if (row.new_value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.new_value);
  } catch {
    logger.warn({ auditId: row.id }, 'auditService: email_sent value is not JSON; left unmasked');
    return null;
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>) // Safe: checked to be a plain object above.
    : null;
}

function recipientsOf(value: Record<string, unknown>): string[] {
  return RECIPIENT_FIELDS.flatMap((field) => {
    const list = value[field];
    return Array.isArray(list) ? list.filter((a): a is string => typeof a === 'string') : [];
  });
}

/**
 * Masks the addresses of GDPR-erased data subjects in address-bearing audit values.
 *
 * Those entries are filed under the mailbox, not the erased record, so the record-keyed
 * masking join never reaches them. The audit log is immutable, so this happens on read:
 * every address on the page is digested and looked up against the erasure log in one
 * query, and each match reads `[GDPR deleted]`.
 */
async function maskErasedAddresses<
  T extends { id?: string; event_type: string; new_value: string | null },
>(rows: readonly T[], parsedByRow: readonly (Record<string, unknown> | null)[]): Promise<T[]> {
  const addresses = [
    ...new Set(parsedByRow.flatMap((parsed) => (parsed ? recipientsOf(parsed) : []))),
  ];
  if (addresses.length === 0) return [...rows];

  const digestByAddress = new Map(addresses.map((a) => [a, erasedAddressDigest(a)]));
  const erased = await pool.query<{ erased_address_hmac: string }>(
    `SELECT erased_address_hmac FROM gdpr_deletion_log
      WHERE completed_at IS NOT NULL AND erased_address_hmac = ANY($1)`,
    [[...digestByAddress.values()]],
  );
  const erasedDigests = new Set(erased.rows.map((r) => r.erased_address_hmac));
  if (erasedDigests.size === 0) return [...rows];

  return rows.map((row, index) => {
    const parsed = parsedByRow[index];
    if (!parsed) return row;
    let changed = false;
    const masked: Record<string, unknown> = { ...parsed };
    for (const field of RECIPIENT_FIELDS) {
      const list = parsed[field];
      if (!Array.isArray(list)) continue;
      masked[field] = list.map((address) => {
        const hit =
          typeof address === 'string' && erasedDigests.has(digestByAddress.get(address) ?? '');
        if (hit) changed = true;
        return hit ? GDPR_REDACTED_TEXT : address;
      });
    }
    return changed ? { ...row, new_value: JSON.stringify(masked) } : row;
  });
}

/**
 * Records a private thread's send entries on a mailbox as private, so reads hide who they
 * concerned. Kept in redacted_records against the entry itself: the message and send intent
 * the entries name can be deleted, and the decision must outlive them.
 *
 * @param keys - The thread's messages (email_sent) and private sends (email_send_unconfirmed).
 */
export async function markSendEntriesPrivate(
  client: PoolClient,
  connectedAccountId: string,
  keys: { messageIds?: readonly string[]; intentIds?: readonly string[] },
): Promise<void> {
  const messageIds = keys.messageIds ?? [];
  const intentIds = keys.intentIds ?? [];
  if (messageIds.length === 0 && intentIds.length === 0) return;
  await client.query(
    `INSERT INTO redacted_records (record_type, record_id, reason)
     SELECT 'audit_log', a.id, 'private_thread' FROM audit_log a
      WHERE a.record_type = 'connected_account' AND a.record_id = $1
        AND (CASE
               -- Guarded: evaluation order is undefined, and the log holds non-JSON values.
               WHEN a.event_type = 'email_sent' AND a.new_value IS JSON OBJECT
                 THEN (a.new_value::jsonb ->> 'message_id') = ANY($2::text[])
               WHEN a.event_type = 'email_send_unconfirmed' AND a.new_value IS JSON OBJECT
                 THEN (a.new_value::jsonb ->> 'intent_id') = ANY($3::text[])
               ELSE false
             END)
     ON CONFLICT DO NOTHING`,
    [connectedAccountId, messageIds, intentIds],
  );
}

/**
 * Hides who a send in a private thread concerned: recipients and linked records read
 * `[Private]` for the entries markSendEntriesPrivate recorded. Admins read these entries in
 * the audit log, and a private thread is its owner's alone.
 */
async function maskPrivateSends<
  T extends { id?: string; event_type: string; new_value: string | null },
>(rows: readonly T[], parsedByRow: readonly (Record<string, unknown> | null)[]): Promise<T[]> {
  const candidates = rows.flatMap((row, index) => (parsedByRow[index] && row.id ? [row.id] : []));
  if (candidates.length === 0) return [...rows];
  const hiddenRows = await pool.query<{ id: string }>(
    `SELECT record_id::text AS id FROM redacted_records
      WHERE record_type = 'audit_log' AND record_id = ANY($1::uuid[])`,
    [candidates],
  );
  const hidden = new Set(hiddenRows.rows.map((r) => r.id));
  if (hidden.size === 0) return [...rows];

  return rows.map((row, index) => {
    const parsed = parsedByRow[index];
    if (!parsed || !row.id || !hidden.has(row.id)) return row;
    const masked: Record<string, unknown> = { ...parsed };
    for (const field of PRIVATE_SEND_FIELDS) {
      if (field in masked) masked[field] = PRIVATE_REDACTED_TEXT;
    }
    return { ...row, new_value: JSON.stringify(masked) };
  });
}

/** Both read-time maskings of send entries: erased addresses, then private sends. */
async function maskSendEntries<
  T extends { id?: string; event_type: string; new_value: string | null },
>(rows: readonly T[]): Promise<T[]> {
  const parsed = parsedSendValues(rows);
  // The private mask replaces every address field, so it may start from the unmasked parse.
  return maskPrivateSends(await maskErasedAddresses(rows, parsed), parsed);
}

/** Shown in place of values a private-thread scrub hid; no erasure happened. */
export const PRIVATE_REDACTED_TEXT = '[Private]';

/**
 * Joins what masks an audit row's name and values: a completed erasure of its record, or a
 * redacted_records row for it. Expects audit_log as `a`. An erasure masks every entry. A
 * private-thread scrub masks only entries written before it, under its own label: it is
 * the owner's choice about later sends, and the record's history after it stays auditable.
 */
export const MASKING_JOIN = `LEFT JOIN gdpr_deletion_log g
         ON g.record_id = a.record_id AND g.record_type = a.record_type AND g.completed_at IS NOT NULL
       LEFT JOIN redacted_records r
         ON r.record_type = a.record_type AND r.record_id = a.record_id`;
const ERASED_SQL = "(g.record_id IS NOT NULL OR r.reason = 'gdpr_erasure')";
const PRIVATE_SQL = "(r.reason = 'private_thread' AND a.created_at < r.redacted_at)";
const maskedColumn = (column: string): string =>
  `CASE WHEN ${ERASED_SQL} THEN ${GDPR_REDACTED_SQL} WHEN ${PRIVATE_SQL} THEN '${PRIVATE_REDACTED_TEXT}' ELSE a.${column} END AS ${column}`;
/** record_name, old_value and new_value, masked; for a select over MASKING_JOIN. */
export const MASKED_AUDIT_VALUES = [
  maskedColumn('record_name'),
  maskedColumn('old_value'),
  maskedColumn('new_value'),
].join(',\n         ');

/**
 * Returns audit log entries for a single record, newest first.
 * Used by the Change History section on detail pages.
 *
 * @param options - Record type, record ID, and optional limit/all flag
 * @returns Array of audit log rows
 */
export async function getRecordAuditLog(options: GetRecordAuditLogOptions): Promise<AuditLogRow[]> {
  const { recordType, recordId, limit = 20, all = false } = options;

  // Read-time masking (MASKING_JOIN): '[GDPR deleted]' for an erased record, '[Private]' for
  // a scrubbed activity's entries from before its scrub.
  const query = all
    ? `SELECT
         a.id, a.record_type, a.record_id, a.event_type, a.field_name,
         ${MASKED_AUDIT_VALUES},
         a.changed_by_id, a.changed_by_name, a.source, a.created_at
       FROM audit_log a
       ${MASKING_JOIN}
       WHERE a.record_type = $1 AND a.record_id = $2
       ORDER BY a.created_at DESC`
    : `SELECT
         a.id, a.record_type, a.record_id, a.event_type, a.field_name,
         ${MASKED_AUDIT_VALUES},
         a.changed_by_id, a.changed_by_name, a.source, a.created_at
       FROM audit_log a
       ${MASKING_JOIN}
       WHERE a.record_type = $1 AND a.record_id = $2
       ORDER BY a.created_at DESC LIMIT $3`;

  const params = all ? [recordType, recordId] : [recordType, recordId, limit];

  const result = await pool.query<AuditLogRow>(query, params);
  return maskSendEntries(result.rows);
}

/**
 * Returns paginated audit log entries for the system-wide admin view.
 * Supports filtering by date range, user, record type, and event type.
 *
 * @param options - Filter and pagination options
 * @returns Paginated audit log entries
 */
export async function listAuditLog(options: ListAuditLogOptions = {}): Promise<AuditLogPage> {
  const {
    from,
    to,
    userId,
    recordType,
    recordId,
    eventType,
    source,
    page = 1,
    limit = 50,
  } = options;

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (from) {
    values.push(from);
    conditions.push(`a.created_at >= $${values.length}`);
  }

  if (to) {
    values.push(to);
    conditions.push(`a.created_at <= $${values.length}`);
  }

  if (userId) {
    values.push(userId);
    conditions.push(`a.changed_by_id = $${values.length}`);
  }

  if (recordType) {
    values.push(recordType);
    conditions.push(`a.record_type = $${values.length}`);
  }

  if (recordId) {
    values.push(recordId);
    conditions.push(`a.record_id = $${values.length}`);
  }

  if (eventType) {
    values.push(eventType);
    conditions.push(`a.event_type = $${values.length}`);
  }

  if (source) {
    if (source === 'human') {
      conditions.push(`a.source IS NULL`);
    } else {
      values.push(source);
      conditions.push(`a.source = $${values.length}`);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  // Read-time masking, as getRecordAuditLog applies it. WHERE conditions are prefixed with
  // `a.` to avoid ambiguity after the join.

  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM audit_log a ${MASKING_JOIN} ${where}`,
      values,
    ),
    pool.query<AuditLogRow>(
      `SELECT
         a.id, a.record_type, a.record_id, a.event_type, a.field_name,
         ${MASKED_AUDIT_VALUES},
         a.changed_by_id, a.changed_by_name, a.source, a.created_at
       FROM audit_log a ${MASKING_JOIN}
       ${where}
       ORDER BY a.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    ),
  ]);

  return {
    data: await maskSendEntries(dataResult.rows),
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  };
}

/**
 * Writes an audit entry using the pool directly (no transaction).
 * Use for events like login/logout where audit failure should not block the operation.
 * Errors are swallowed and logged — callers should not await or rely on success.
 *
 * @param entry - The audit entry to write
 */
export async function writeAuditEntryBestEffort(entry: AuditEntryInput): Promise<void> {
  const isSensitive = entry.fieldName != null && SENSITIVE_FIELDS.has(entry.fieldName);

  try {
    await pool.query(
      `INSERT INTO audit_log
         (record_type, record_id, record_name, event_type, field_name, old_value, new_value, changed_by_id, changed_by_name, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.recordType,
        entry.recordId ?? null,
        entry.recordName ?? null,
        entry.eventType,
        entry.fieldName ?? null,
        isSensitive ? null : (entry.oldValue ?? null),
        isSensitive ? null : (entry.newValue ?? null),
        entry.changedById ?? null,
        entry.changedByName ?? null,
        entry.source ?? null,
      ],
    );
  } catch (err) {
    logger.warn({ err }, 'writeAuditEntryBestEffort: failed to write audit entry');
  }
}

/**
 * Applies GDPR read-time masking to a raw AuditNotification from the NOTIFY channel.
 * The NOTIFY payload is emitted before the read-time SQL masking in getRecordAuditLog
 * is applied, so subscribers that forward events to clients must call this first.
 *
 * Masks as the read queries do: '[GDPR deleted]' when the record is erased, '[Private]'
 * when a private-thread scrub came after the event.
 *
 * @param event - Raw audit notification from the auditEventBus
 * @returns A copy of the event with its name and values masked where the reads would
 */
export async function maskAuditEvent(event: AuditNotification): Promise<AuditNotification> {
  const [addressMasked] = await maskSendEntries([event]);
  // Safe: one row in, one row out.
  return maskErasedRecord(addressMasked!);
}

/** Masks a live event whose own record is erased or scrubbed, as MASKING_JOIN does. */
async function maskErasedRecord(event: AuditNotification): Promise<AuditNotification> {
  if (!event.record_id) return event;

  // Compared in SQL, at the same microsecond precision as MASKING_JOIN.
  const result = await pool.query<{ erased: boolean; private_hidden: boolean }>(
    `SELECT EXISTS (
              SELECT 1 FROM gdpr_deletion_log
               WHERE record_id = $1 AND record_type = $2 AND completed_at IS NOT NULL
            ) OR EXISTS (
              SELECT 1 FROM redacted_records
               WHERE record_id = $1 AND record_type = $2 AND reason = 'gdpr_erasure'
            ) AS erased,
            EXISTS (
              SELECT 1 FROM redacted_records
               WHERE record_id = $1 AND record_type = $2 AND reason = 'private_thread'
                 AND ($3::timestamptz IS NULL OR redacted_at > $3::timestamptz)
            ) AS private_hidden`,
    // A payload missing its timestamp is masked rather than shown: privacy fails closed.
    [event.record_id, event.record_type, event.created_at || null],
  );
  const { erased, private_hidden: privateHidden } = result.rows[0]!; // Safe: a SELECT of scalars yields one row.
  const hidden = erased ? GDPR_REDACTED_TEXT : privateHidden ? PRIVATE_REDACTED_TEXT : null;
  if (!hidden) return event;

  return {
    ...event,
    record_name: event.record_name !== null ? hidden : null,
    old_value: event.old_value !== null ? hidden : null,
    new_value: event.new_value !== null ? hidden : null,
  };
}

/**
 * Returns all distinct users who have entries in the audit log.
 * Used to populate the user filter dropdown on the admin audit log page.
 *
 * @returns Array of { id, name } pairs ordered by name
 */
export async function listAuditLogActors(): Promise<{ id: string; name: string }[]> {
  const result = await pool.query<{ id: string; name: string }>(
    `SELECT DISTINCT changed_by_id AS id, changed_by_name AS name
     FROM audit_log
     WHERE changed_by_id IS NOT NULL
     ORDER BY changed_by_name ASC`,
  );
  return result.rows;
}
