/**
 * Shared Zod schemas for the audit log.
 * Used by both server (input validation) and client (type inference).
 */

import { z } from 'zod';

/**
 * Every record type the audit log holds. The server's AuditRecordType is derived from this
 * list, so a type the server writes is always one the admin filter can offer.
 */
export const AUDIT_RECORD_TYPES = [
  'contact',
  'account',
  'deal',
  'user',
  'system_settings',
  'lead',
  'activity',
  /** Saved custom report definitions */
  'custom_report',
  /** Sales sequence definitions and enrollments */
  'sequence',
  'sequence_enrollment',
  /** Feature flag registry entries */
  'feature_flag',
  /** Feature flag group entries */
  'feature_flag_group',
  /** AI provider/model configuration */
  'ai_settings',
  /** Teams and team membership */
  'team',
  /** Per-object-type data visibility policies */
  'org_visibility_settings',
  /** Capability-based RBAC custom role definitions */
  'custom_role',
  /** SCIM provisioning bearer token lifecycle */
  'scim_token',
  /** SCIM group-to-custom-role mapping changes */
  'scim_group_role_mapping',
  /** AI conversation sessions */
  'ai_sessions',
  /** Per-user AI context preferences */
  'user_ai_context',
  /** Email templates for sequences and activities */
  'email_templates',
  /** Global tag definitions renamed by NLI or admin */
  'tag',
  /** AI data minimization field exclusion toggles */
  'ai_field_exclusion',
  /** AI lead routing suggestion decisions */
  'lead_routing_decision',
  /** Coverage/TIA testing sessions */
  'coverage_session',
  /** Per-user linked mailboxes */
  'connected_account',
] as const;

/**
 * Every event type the audit log holds. The server's AuditEventType is derived from this list,
 * so an event the server writes is always one the admin filter can offer and label.
 */
export const AUDIT_EVENT_TYPES = [
  'created',
  'updated',
  'deleted',
  'login',
  'logout',
  'password_changed',
  'role_changed',
  'deactivated',
  'reactivated',
  'ownership_reassigned',
  /** Contact merge — winner record absorbed the loser */
  'merged',
  /** Note CRUD events */
  'note_created',
  'note_updated',
  'note_deleted',
  'note_visibility_changed',
  /** GDPR Art. 17 erasure */
  'gdpr_erasure',
  /** MFA enabled/disabled by user */
  'mfa_enabled',
  'mfa_disabled',
  /** SSO identity events */
  'sso_login',
  'sso_provisioned',
  'sso_linked',
  'sso_unlinked',
  /** Service account API token lifecycle */
  'api_token_issued',
  'api_token_revoked',
  /** GDPR AI data cascade — PII redaction from ai_messages/user_ai_context */
  'ai_gdpr_cascade',
  /** AI lead routing suggestion accepted or overridden */
  'routing_accepted',
  'routing_overridden',
  /** Coverage/TIA session lifecycle */
  'coverage_session_started',
  'coverage_session_ended',
  /** Mailbox linked to or unlinked from a user account */
  'connected_account_connected',
  'connected_account_disconnected',
  'connected_account_sync_suspended',
  /**
   * A synced message linked to or unlinked from a CRM record by hand.
   *
   * Filed against the mailbox rather than the linked record: getRecordAuditLog filters
   * nothing, so an entry on a contact would reach ChangeHistory's switch, match no case,
   * and render a raw identifier. Automatic links are not audited at all — match_type
   * already records how a link was made.
   */
  'email_linked',
  'email_unlinked',
  /** A message sent through a connected mailbox. Filed against the mailbox, as above. */
  'email_sent',
  /** A send that may have gone out but was not filed, recorded so it is never unaudited. */
  'email_send_unconfirmed',
] as const;

/** The events that land on a contact, account or deal and render in its Change History. */
export const RECORD_HISTORY_EVENT_TYPES = [
  'created',
  'updated',
  'deleted',
  'login',
  'logout',
  'password_changed',
  'role_changed',
  'deactivated',
  'reactivated',
  'ownership_reassigned',
  'merged',
  'note_created',
  'note_updated',
  'note_deleted',
  'note_visibility_changed',
  'gdpr_erasure',
] as const satisfies readonly (typeof AUDIT_EVENT_TYPES)[number][];

export type RecordHistoryEventType = (typeof RECORD_HISTORY_EVENT_TYPES)[number];

/** A single audit log entry as returned by the API */
export const auditLogEntrySchema = z.object({
  id: z.string().uuid(),
  record_type: z.enum(AUDIT_RECORD_TYPES),
  record_id: z.string().uuid().nullable(),
  record_name: z.string().nullable(),
  event_type: z.enum(AUDIT_EVENT_TYPES),
  field_name: z.string().nullable(),
  old_value: z.string().nullable(),
  new_value: z.string().nullable(),
  changed_by_id: z.string().uuid().nullable(),
  changed_by_name: z.string().nullable(),
  source: z.string().nullable(),
  created_at: z.string(),
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

/** Query params schema for the system-wide audit log list endpoint */
export const listAuditLogParamsSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.string().uuid().optional(),
  recordType: z.enum(AUDIT_RECORD_TYPES).optional(),
  eventType: z.enum(AUDIT_EVENT_TYPES).optional(),
  source: z.enum(['AI (NLI)', 'AI (context)', 'human']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type ListAuditLogParams = z.infer<typeof listAuditLogParamsSchema>;

/** Query params schema for the per-record audit log endpoint */
export const recordAuditLogParamsSchema = z.object({
  record_type: z.enum(AUDIT_RECORD_TYPES),
  record_id: z.string().uuid(),
  all: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});
