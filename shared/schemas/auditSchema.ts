/**
 * Shared Zod schemas for the audit log.
 * Used by both server (input validation) and client (type inference).
 */

import { z } from 'zod';

/** Valid record types in the audit log */
export const AUDIT_RECORD_TYPES = [
  'contact',
  'account',
  'deal',
  'lead',
  'activity',
  'user',
  'system_settings',
  'custom_report',
  /** Sales sequence definitions and enrollments */
  'sequence',
  'sequence_enrollment',
  /** Feature flag registry entries */
  'feature_flag',
  /** AI provider/model configuration */
  'ai_settings',
  /** AI data minimization field exclusion toggles */
  'ai_field_exclusion',
] as const;

/** Valid event types in the audit log */
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
  'merged',
  'note_created',
  'note_updated',
  'note_deleted',
  'note_visibility_changed',
  // Written against a contact, so it reaches the record-level Change History panel.
  // The server's AuditEventType union is broader; these are the ones that surface there.
  'gdpr_erasure',
] as const;

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
