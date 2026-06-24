/**
 * Audit service — write and query structured audit log entries.
 * All writes go through this module. Entries are always written inside the
 * caller's transaction so a failed audit write rolls back the triggering change
 * and vice versa. (MINCRM-170)
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import type { AuditNotification } from './auditEventBus.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Identity of the user performing a write operation.
 * Shared across all write services — import from auditService, not from individual services.
 */
export interface AuditActor {
  id: string;
  name: string;
}

/** System actor used as default for seeding, migrations, and automation triggers. */
export const SYSTEM_ACTOR: AuditActor = {
  id: '00000000-0000-0000-0000-000000000000',
  name: 'System',
};

/**
 * Returns the actor's UUID for use as system_settings.updated_by.
 * SYSTEM_ACTOR writes are not attributable to a real user row, so NULL is stored
 * rather than the synthetic all-zeros UUID (which would violate the FK constraint).
 */
export function actorIdOrNull(actor: AuditActor): string | null {
  return actor.id === SYSTEM_ACTOR.id ? null : actor.id;
}

/** Record types that can appear in the audit log */
export type AuditRecordType =
  | 'contact'
  | 'account'
  | 'deal'
  | 'user'
  | 'system_settings'
  | 'lead'
  | 'activity'
  /** Saved custom report definitions (MINCRM-402) */
  | 'custom_report'
  /** Sales sequence definitions and enrollments (MINCRM-403) */
  | 'sequence'
  | 'sequence_enrollment'
  /** Feature flag registry entries (MINCRM-463) */
  | 'feature_flag'
  /** Feature flag group entries (MINCRM-491) */
  | 'feature_flag_group'
  /** AI provider/model configuration (MINCRM-457) */
  | 'ai_settings'
  /** Teams and team membership (MINCRM-537) */
  | 'team'
  /** Per-object-type data visibility policies (MINCRM-538) */
  | 'org_visibility_settings'
  /** Capability-based RBAC custom role definitions (MINCRM-542) */
  | 'custom_role'
  /** SCIM provisioning bearer token lifecycle (MINCRM-541) */
  | 'scim_token'
  /** SCIM group-to-custom-role mapping changes (MINCRM-541) */
  | 'scim_group_role_mapping';

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
  | 'merged'
  /** Note CRUD events (MINCRM-352) */
  | 'note_created'
  | 'note_updated'
  | 'note_deleted'
  | 'note_visibility_changed'
  /** GDPR Art. 17 erasure (MINCRM-364) */
  | 'gdpr_erasure'
  /** MFA enabled/disabled by user (MINCRM-392) */
  | 'mfa_enabled'
  | 'mfa_disabled'
  /** SSO identity events (MINCRM-399) */
  | 'sso_login'
  | 'sso_provisioned'
  | 'sso_linked'
  | 'sso_unlinked'
  /** Service account API token lifecycle (MINCRM-536) */
  | 'api_token_issued'
  | 'api_token_revoked';

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
  /** Filter by the UUID of the record that was changed */
  recordId?: string;
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

  // Apply read-time GDPR masking via LEFT JOIN on gdpr_deletion_log. (MINCRM-364)
  // When a record has a completed erasure, old_value/new_value are replaced with
  // '[GDPR deleted]' so audit history does not leak PII that was erased.
  const query = all
    ? `SELECT
         a.id, a.record_type, a.record_id, a.record_name, a.event_type, a.field_name,
         CASE WHEN g.record_id IS NOT NULL THEN '[GDPR deleted]' ELSE a.old_value END AS old_value,
         CASE WHEN g.record_id IS NOT NULL THEN '[GDPR deleted]' ELSE a.new_value END AS new_value,
         a.changed_by_id, a.changed_by_name, a.created_at
       FROM audit_log a
       LEFT JOIN gdpr_deletion_log g
         ON g.record_id = a.record_id AND g.record_type = a.record_type AND g.completed_at IS NOT NULL
       WHERE a.record_type = $1 AND a.record_id = $2
       ORDER BY a.created_at DESC`
    : `SELECT
         a.id, a.record_type, a.record_id, a.record_name, a.event_type, a.field_name,
         CASE WHEN g.record_id IS NOT NULL THEN '[GDPR deleted]' ELSE a.old_value END AS old_value,
         CASE WHEN g.record_id IS NOT NULL THEN '[GDPR deleted]' ELSE a.new_value END AS new_value,
         a.changed_by_id, a.changed_by_name, a.created_at
       FROM audit_log a
       LEFT JOIN gdpr_deletion_log g
         ON g.record_id = a.record_id AND g.record_type = a.record_type AND g.completed_at IS NOT NULL
       WHERE a.record_type = $1 AND a.record_id = $2
       ORDER BY a.created_at DESC LIMIT $3`;

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
  const { from, to, userId, recordType, recordId, eventType, page = 1, limit = 50 } = options;

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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  // Apply read-time GDPR masking via LEFT JOIN on gdpr_deletion_log. (MINCRM-364)
  // When a record has a completed erasure, old_value/new_value display '[GDPR deleted]'.
  // WHERE conditions are prefixed with `a.` to avoid ambiguity after the join.
  const gdprJoin = `LEFT JOIN gdpr_deletion_log g ON g.record_id = a.record_id AND g.record_type = a.record_type AND g.completed_at IS NOT NULL`;

  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM audit_log a ${gdprJoin} ${where}`,
      values,
    ),
    pool.query<AuditLogRow>(
      `SELECT
         a.id, a.record_type, a.record_id, a.record_name, a.event_type, a.field_name,
         CASE WHEN g.record_id IS NOT NULL THEN '[GDPR deleted]' ELSE a.old_value END AS old_value,
         CASE WHEN g.record_id IS NOT NULL THEN '[GDPR deleted]' ELSE a.new_value END AS new_value,
         a.changed_by_id, a.changed_by_name, a.created_at
       FROM audit_log a ${gdprJoin}
       ${where}
       ORDER BY a.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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
 * Applies GDPR read-time masking to a raw AuditNotification from the NOTIFY channel.
 * The NOTIFY payload is emitted before the read-time SQL masking in getRecordAuditLog
 * is applied, so subscribers that forward events to clients must call this first.
 *
 * When the record has a completed erasure in gdpr_deletion_log, old_value and
 * new_value are replaced with '[GDPR deleted]'. (MINCRM-375, MINCRM-364)
 *
 * @param event - Raw audit notification from the auditEventBus
 * @returns A copy of the event with values masked if the record has been erased
 */
export async function maskAuditEvent(event: AuditNotification): Promise<AuditNotification> {
  if (!event.record_id) return event;

  const result = await pool.query<{ erased: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM gdpr_deletion_log
       WHERE record_id = $1 AND record_type = $2 AND completed_at IS NOT NULL
     ) AS erased`,
    [event.record_id, event.record_type],
  );

  if (!result.rows[0].erased) return event;

  return {
    ...event,
    old_value: event.old_value !== null ? '[GDPR deleted]' : null,
    new_value: event.new_value !== null ? '[GDPR deleted]' : null,
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
