/**
 * Shared Zod schemas for sales sequences.
 * Imported by both the server (request validation) and the client (form validation).
 */

import { z } from 'zod';

// ── Step action types ──────────────────────────────────────────────────────────

export const SEQUENCE_STEP_ACTION_TYPES = [
  'send_email',
  'log_call_reminder',
  'create_task',
] as const;

export type SequenceStepActionType = (typeof SEQUENCE_STEP_ACTION_TYPES)[number];

// ── Enrollment statuses ────────────────────────────────────────────────────────

export const SEQUENCE_ENROLLMENT_STATUSES = ['active', 'completed', 'unenrolled'] as const;

export type SequenceEnrollmentStatus = (typeof SEQUENCE_ENROLLMENT_STATUSES)[number];

// ── Step action config schemas ─────────────────────────────────────────────────

/** Config for a send_email step — creates a Task reminder for the rep. */
export const sendEmailStepConfigSchema = z.object({
  subject: z.string().min(1, 'Email subject is required').trim(),
  body: z.string().min(1, 'Email body is required').trim(),
});

/** Config for a log_call_reminder step — creates a Call activity. */
export const logCallReminderStepConfigSchema = z.object({
  subject: z.string().min(1, 'Call subject is required').trim(),
  notes: z.string().trim().optional(),
});

/** Config for a create_task step — creates a Task activity. */
export const createTaskStepConfigSchema = z.object({
  subject: z.string().min(1, 'Task subject is required').trim(),
  notes: z.string().trim().optional(),
});

// ── Step schemas ───────────────────────────────────────────────────────────────

export const createSequenceStepSchema = z.object({
  sort_order: z
    .number()
    .int('Sort order must be a whole number')
    .min(1, 'Sort order must be at least 1'),
  action_type: z.enum(SEQUENCE_STEP_ACTION_TYPES, {
    required_error: 'Action type is required',
  }),
  action_config: z.record(z.unknown()),
  delay_days: z
    .number()
    .int('Delay days must be a whole number')
    .min(0, 'Delay days must be 0 or greater')
    .default(0),
});

export const updateSequenceStepSchema = z
  .object({
    sort_order: z.number().int().min(1).optional(),
    action_type: z.enum(SEQUENCE_STEP_ACTION_TYPES).optional(),
    action_config: z.record(z.unknown()).optional(),
    delay_days: z.number().int().min(0).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

// ── Sequence schemas ───────────────────────────────────────────────────────────

export const createSequenceSchema = z.object({
  name: z.string().min(1, 'Sequence name is required').trim(),
  description: z.string().trim().optional(),
  enabled: z.boolean().default(true),
});

export const updateSequenceSchema = z
  .object({
    name: z.string().min(1, 'Sequence name is required').trim().optional(),
    description: z.string().trim().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

// ── Enrollment schema ──────────────────────────────────────────────────────────

export const enrollContactSchema = z.object({
  contact_id: z.string().uuid('contact_id must be a valid UUID'),
});

// ── Response row types ─────────────────────────────────────────────────────────

export const sequenceStepResponseSchema = z.object({
  id: z.string().uuid(),
  sequence_id: z.string().uuid(),
  sort_order: z.number(),
  action_type: z.enum(SEQUENCE_STEP_ACTION_TYPES),
  action_config: z.record(z.unknown()),
  delay_days: z.number(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
});

export const sequenceResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  created_by: z.string().uuid().nullable(),
  step_count: z.number(),
  active_enrollment_count: z.number(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
});

export const enrollmentResponseSchema = z.object({
  id: z.string().uuid(),
  sequence_id: z.string().uuid(),
  sequence_name: z.string(),
  contact_id: z.string().uuid(),
  enrolled_by_id: z.string().uuid().nullable(),
  enrolled_at: z.string().or(z.date()),
  status: z.enum(SEQUENCE_ENROLLMENT_STATUSES),
  current_step_id: z.string().uuid().nullable(),
  current_step_sort_order: z.number().nullable(),
  next_action_at: z.string().or(z.date()).nullable(),
  unenrolled_at: z.string().or(z.date()).nullable(),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type CreateSequenceInput = z.infer<typeof createSequenceSchema>;
export type UpdateSequenceInput = z.infer<typeof updateSequenceSchema>;
export type CreateSequenceStepInput = z.infer<typeof createSequenceStepSchema>;
export type UpdateSequenceStepInput = z.infer<typeof updateSequenceStepSchema>;
export type EnrollContactInput = z.infer<typeof enrollContactSchema>;
export type SequenceResponse = z.infer<typeof sequenceResponseSchema>;
export type SequenceStepResponse = z.infer<typeof sequenceStepResponseSchema>;
export type EnrollmentResponse = z.infer<typeof enrollmentResponseSchema>;
export type SendEmailStepConfig = z.infer<typeof sendEmailStepConfigSchema>;
export type LogCallReminderStepConfig = z.infer<typeof logCallReminderStepConfigSchema>;
export type CreateTaskStepConfig = z.infer<typeof createTaskStepConfigSchema>;
