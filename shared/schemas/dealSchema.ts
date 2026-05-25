/**
 * Shared Zod schemas for deal-related validation.
 * Imported by both the server (request validation) and the client (form validation).
 *
 * Pipeline stages are now stored in the pipeline_stages DB table (MINCRM-180).
 * PIPELINE_STAGES is kept as the seed/fallback set for bootstrapping; runtime
 * validation uses the live stage list fetched from the API.
 */

import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from './settingsSchema.js';

/**
 * Seed pipeline stage names — used for bootstrapping and as the fallback when the
 * live stage list is not yet available. The authoritative list lives in the
 * pipeline_stages table and is fetched via GET /api/settings/pipeline-stages.
 */
export const PIPELINE_STAGES = [
  'Prospecting',
  'Qualification',
  'Proposal',
  'Negotiation',
  'Closed Won',
  'Closed Lost',
] as const;

/** Type-level union of the seed stage names (kept for backward compatibility). */
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
  /** UUID of the pipeline this deal belongs to (MINCRM-397). Defaults to the default pipeline. */
  pipeline_id: z.string().uuid('Pipeline must be a valid UUID').optional(),
  /**
   * Stage is validated as a non-empty string at the schema level.
   * The server additionally validates the value against the live pipeline_stages
   * table (MINCRM-180). The client validates against the cached stage list.
   */
  stage: z.string({ required_error: 'Stage is required' }).min(1, 'Stage is required'),
  value: z.number().nonnegative('Value must be 0 or greater').optional(),
  /** ISO 4217 currency code for the deal value. Defaults to the system default currency. (MINCRM-189) */
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  close_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Close date must be in YYYY-MM-DD format')
    .optional(),
  account_id: z.string().uuid('Account must be a valid UUID').optional(),
  /**
   * Optional per-deal probability override (0–100).
   * When omitted, the deal inherits its probability from the pipeline stage default.
   * (MINCRM-179)
   */
  probability: z
    .number()
    .int('Probability must be an integer')
    .min(0, 'Probability must be 0 or greater')
    .max(100, 'Probability must be 100 or less')
    .optional(),
});

/** Terminal pipeline stages that require a close date <= today */
export const CLOSED_PIPELINE_STAGES: ReadonlyArray<PipelineStage> = ['Closed Won', 'Closed Lost'];

/**
 * Schema for updating an existing deal.
 * All create fields are optional; owner_id may also be changed.
 * At least one field must be present.
 * When stage is a terminal stage, close_date must not be in the future.
 */
export const updateDealSchema = createDealSchema
  .extend({
    owner_id: z.string().uuid('Owner must be a valid user UUID').optional(),
    loss_reason: z.string().trim().nullable().optional(),
  })
  .partial()
  .extend({
    // Allow null to explicitly clear these nullable columns
    value: z.number().nonnegative('Value must be 0 or greater').nullable().optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    close_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Close date must be in YYYY-MM-DD format')
      .nullable()
      .optional(),
    account_id: z.string().uuid('Account must be a valid UUID').nullable().optional(),
    // Allow null to clear a manual probability override (reverts to stage default)
    probability: z
      .number()
      .int('Probability must be an integer')
      .min(0, 'Probability must be 0 or greater')
      .max(100, 'Probability must be 100 or less')
      .nullable()
      .optional(),
  })
  .extend({
    /** Optimistic lock version — must match the current DB value (MINCRM-349) */
    version: z.number().int().positive('Version must be a positive integer'),
  })
  .refine((data) => Object.keys(data).filter((k) => k !== 'version').length > 0, {
    message: 'At least one field must be provided',
  })
  .refine(
    (data) => {
      if (
        data.stage &&
        (CLOSED_PIPELINE_STAGES as ReadonlyArray<string>).includes(data.stage) &&
        data.close_date
      ) {
        const today = new Date().toISOString().split('T')[0];
        return data.close_date <= today;
      }
      return true;
    },
    { message: 'Close date cannot be in the future' },
  );

/**
 * Schema for the safe deal response shape returned to API consumers.
 */
export const dealResponseSchema = z.object({
  id: z.string().uuid(),
  /** UUID of the pipeline this deal belongs to (MINCRM-397) */
  pipeline_id: z.string().uuid(),
  name: z.string(),
  stage: z.string(),
  value: z.string().nullable(), // pg returns numeric as string
  /** ISO 4217 currency code for the deal value (MINCRM-189) */
  currency: z.string(),
  close_date: z.string().nullable(),
  loss_reason: z.string().nullable(),
  account_id: z.string().uuid().nullable(),
  owner_id: z.string().uuid(),
  /** Set when the deal was created via lead conversion (MINCRM-175) */
  source_lead_id: z.string().uuid().nullable().optional(),
  /**
   * Resolved probability for this deal (0–100).
   * Equals the deal's manual override when set; otherwise the current stage default.
   * (MINCRM-179)
   */
  effective_probability: z.number().int(),
  /**
   * True when the deal's probability has been manually overridden from the stage default.
   * (MINCRM-179)
   */
  probability_is_overridden: z.boolean(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
  /** Optimistic lock version (MINCRM-349) */
  version: z.number().int(),
  /** Tags attached to this deal — only present in list responses (MINCRM-186) */
  tags: z.array(z.object({ id: z.string().uuid(), name: z.string() })).optional(),
});

// ── Envelope schemas (for API response validation) ─────────────────────────────

export const dealResponseEnvelopeSchema = z.object({ deal: dealResponseSchema });

// ── Inferred types ─────────────────────────────────────────────────────────────

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type DealResponse = z.infer<typeof dealResponseSchema>;
