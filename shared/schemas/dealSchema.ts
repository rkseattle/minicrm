/**
 * Shared Zod schemas for deal-related validation.
 * Imported by both the server (request validation) and the client (form validation).
 */

import { z } from 'zod';

/** Fixed pipeline stages for the alpha release. Order reflects the sales funnel. */
export const PIPELINE_STAGES = [
  'Prospecting',
  'Qualification',
  'Proposal',
  'Negotiation',
  'Closed Won',
  'Closed Lost',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/**
 * Schema for creating a new deal.
 * name and stage are required; all other fields are optional.
 */
export const createDealSchema = z.object({
  name: z
    .string({ required_error: 'Deal name is required' })
    .min(1, 'Deal name is required')
    .trim(),
  stage: z.enum(PIPELINE_STAGES, { required_error: 'Stage is required' }),
  value: z.number().nonnegative('Value must be 0 or greater').optional(),
  close_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Close date must be in YYYY-MM-DD format')
    .optional(),
  account_id: z.string().uuid('Account must be a valid UUID').optional(),
});

/**
 * Schema for updating an existing deal.
 * All create fields are optional; owner_id may also be changed.
 * At least one field must be present.
 */
export const updateDealSchema = createDealSchema
  .extend({
    owner_id: z.string().uuid('Owner must be a valid user UUID').optional(),
    loss_reason: z.string().trim().optional(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * Schema for the safe deal response shape returned to API consumers.
 */
export const dealResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  stage: z.enum(PIPELINE_STAGES),
  value: z.string().nullable(), // pg returns numeric as string
  close_date: z.string().nullable(),
  loss_reason: z.string().nullable(),
  account_id: z.string().uuid().nullable(),
  owner_id: z.string().uuid(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type DealResponse = z.infer<typeof dealResponseSchema>;
