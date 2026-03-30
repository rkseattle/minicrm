/**
 * Shared Zod schemas for activity-related validation.
 * Imported by both the server (request validation) and the client (form validation).
 */

import { z } from 'zod';

/** All supported activity types. */
export const ACTIVITY_TYPES = ['Note', 'Call', 'Email', 'Meeting', 'Task'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** All supported activity statuses. */
export const ACTIVITY_STATUSES = ['open', 'complete'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

/**
 * Schema for creating a new activity.
 * type and subject are required. At least one parent ID (contact, account, or deal) must be set.
 */
export const createActivitySchema = z
  .object({
    type: z.enum(ACTIVITY_TYPES, { required_error: 'Activity type is required' }),
    subject: z
      .string({ required_error: 'Subject is required' })
      .min(1, 'Subject is required')
      .trim(),
    notes: z.string().trim().optional(),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be in YYYY-MM-DD format')
      .optional(),
    contact_id: z.string().uuid('contact_id must be a valid UUID').optional(),
    account_id: z.string().uuid('account_id must be a valid UUID').optional(),
    deal_id: z.string().uuid('deal_id must be a valid UUID').optional(),
  })
  .refine((data) => Boolean(data.contact_id ?? data.account_id ?? data.deal_id), {
    message: 'At least one of contact_id, account_id, or deal_id must be provided',
  });

/**
 * Schema for updating an existing activity.
 * Parent IDs cannot be changed after creation.
 * At least one field must be present.
 */
export const updateActivitySchema = z
  .object({
    type: z.enum(ACTIVITY_TYPES).optional(),
    subject: z.string().min(1, 'Subject is required').trim().optional(),
    notes: z.string().trim().nullable().optional(),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be in YYYY-MM-DD format')
      .nullable()
      .optional(),
    status: z.enum(ACTIVITY_STATUSES).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * Schema for the safe activity response shape returned to API consumers.
 */
export const activityResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(ACTIVITY_TYPES),
  subject: z.string(),
  notes: z.string().nullable(),
  due_date: z.string().nullable(),
  status: z.enum(ACTIVITY_STATUSES),
  contact_id: z.string().uuid().nullable(),
  account_id: z.string().uuid().nullable(),
  deal_id: z.string().uuid().nullable(),
  owner_id: z.string().uuid(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;
export type ActivityResponse = z.infer<typeof activityResponseSchema>;
