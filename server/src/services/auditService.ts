/**
 * Audit service — write and query structured audit log entries.
 * All writes go through this module. Entries are always written inside the
 * caller's transaction so a failed audit write rolls back the triggering change
 * and vice versa. (MINCRM-170)
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Record types that can appear in the audit log */
export type AuditRecordType = 'contact' | 'account' | 'deal' | 'user' | 'system_settings';

/** Event types that can appear in the audit log */
export type AuditEventType =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'login'
  | 'logout'
  | 'password_changed'
  | 'role_changed'
  | 'deactivated'
  | 'reactivated'
  | 'ownership_reassigned'
  /** Contact merge — winner record absorbed the loser (MINCRM-187) */
  | 'merged';

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
       (record_type, record_id, record_name, event_type, field_name, old_value, new_value, changed_by_id, changed_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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
  /** Filter by event type */
  eventType?: AuditEventType;
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

/**
 * Returns audit log entries for a single record, newest first.
 * Used by the Change History section on detail pages. (MINCRM-171)
 *
 * @param options - Record type, record ID, and optional limit/all flag
 * @returns Array of audit log rows
 */
export async function getRecordAuditLog(options: GetRecordAuditLogOptions): Promise<AuditLogRow[]> {
  const { recordType, recordId, limit = 20, all = false } = options;

  const query = all
    ? `SELECT * FROM audit_log WHERE record_type = $1 AND record_id = $2 ORDER BY created_at DESC`
    : `SELECT * FROM audit_log WHERE record_type = $1 AND record_id = $2 ORDER BY created_at DESC LIMIT $3`;

  const params = all ? [recordType, recordId] : [recordType, recordId, limit];

  const result = await pool.query<AuditLogRow>(query, params);
  return result.rows;
}

/**
 * Returns paginated audit log entries for the system-wide admin view.
 * Supports filtering by date range, user, record type, and event type. (MINCRM-172)
 *
 * @param options - Filter and pagination options
 * @returns Paginated audit log entries
 */
export async function listAuditLog(options: ListAuditLogOptions = {}): Promise<AuditLogPage> {
  const { from, to, userId, recordType, eventType, page = 1, limit = 50 } = options;

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (from) {
    values.push(from);
    conditions.push(`created_at >= $${values.length}`);
  }

  if (to) {
    values.push(to);
    conditions.push(`created_at <= $${values.length}`);
  }

  if (userId) {
    values.push(userId);
    conditions.push(`changed_by_id = $${values.length}`);
  }

  if (recordType) {
    values.push(recordType);
    conditions.push(`record_type = $${values.length}`);
  }

  if (eventType) {
    values.push(eventType);
    conditions.push(`event_type = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM audit_log ${where}`, values),
    pool.query<AuditLogRow>(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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
         (record_type, record_id, record_name, event_type, field_name, old_value, new_value, changed_by_id, changed_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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
      ],
    );
  } catch (err) {
    logger.warn({ err }, 'writeAuditEntryBestEffort: failed to write audit entry');
  }
}

/**
 * Returns all distinct users who have entries in the audit log.
 * Used to populate the user filter dropdown on the admin audit log page.
 *
 * @param actorIds Optional allowlist of changed_by_id values; returns all actors when omitted.
 * @returns Array of { id, name } pairs ordered by name
 */
export async function listAuditLogActors(actorIds?: string[]): Promise<{ id: string; name: string }[]> {
  const result = await pool.query<{ id: string; name: string }>(
    actorIds && actorIds.length > 0
      ? `SELECT DISTINCT changed_by_id AS id, changed_by_name AS name
         FROM audit_log
         WHERE changed_by_id IS NOT NULL
           AND changed_by_id = ANY($1)
         ORDER BY changed_by_name ASC`
      : `SELECT DISTINCT changed_by_id AS id, changed_by_name AS name
         FROM audit_log
         WHERE changed_by_id IS NOT NULL
         ORDER BY changed_by_name ASC`,
    actorIds && actorIds.length > 0 ? [actorIds] : [],
  );
  return result.rows;
}
