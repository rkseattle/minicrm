/**
 * Shared Zod schemas for account-related validation.
 * Imported by both the server (request validation) and the client (form validation).
 */

import { z } from 'zod';

/** Valid values for the account_type field (MINCRM-183) */
export const ACCOUNT_TYPE_VALUES = [
  'Prospect',
  'Customer',
  'Partner',
  'Vendor',
  'Competitor',
  'Other',
] as const;
export type AccountType = (typeof ACCOUNT_TYPE_VALUES)[number];

/**
 * Schema for creating a new account.
 * name is required; all other fields are optional.
 */
export const createAccountSchema = z.object({
  name: z
    .string({ required_error: 'Company name is required' })
    .min(1, 'Company name is required')
    .trim(),
  industry: z.string().trim().optional(),
  website: z.string().trim().url('Website must be a valid URL').optional(),
  employee_range: z.string().trim().optional(),
  revenue_range: z.string().trim().optional(),
  /** UUIDs of contacts to link to this account */
  contact_ids: z.array(z.string().uuid('Each contact ID must be a valid UUID')).optional(),
  /** Account classification type (MINCRM-183) */
  account_type: z.enum(ACCOUNT_TYPE_VALUES).nullable().optional(),
  /** UUID of the parent account (MINCRM-184) */
  parent_account_id: z.string().uuid('Parent account must be a valid UUID').nullable().optional(),
});

/**
 * Schema for updating an existing account.
 * All create fields are optional; owner_id may also be changed.
 * At least one field must be present.
 */
export const updateAccountSchema = createAccountSchema
  .extend({
    owner_id: z.string().uuid('Owner must be a valid user UUID').optional(),
    /** Optimistic lock version — must match the current DB value (MINCRM-349) */
    version: z.number().int().positive('Version must be a positive integer'),
  })
  .partial()
  .extend({
    version: z.number().int().positive('Version must be a positive integer'),
  })
  .refine((data) => Object.keys(data).filter((k) => k !== 'version').length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * Schema for the safe account response shape returned to API consumers.
 */
export const accountResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  industry: z.string().nullable(),
  website: z.string().nullable(),
  employee_range: z.string().nullable(),
  revenue_range: z.string().nullable(),
  owner_id: z.string().uuid(),
  /** Account classification type (MINCRM-183) */
  account_type: z.enum(ACCOUNT_TYPE_VALUES).nullable().optional(),
  /** UUID of the parent account (MINCRM-184) */
  parent_account_id: z.string().uuid().nullable().optional(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
  /** Optimistic lock version (MINCRM-349) */
  version: z.number().int(),
  /** Tags attached to this account — only present in list responses (MINCRM-186) */
  tags: z.array(z.object({ id: z.string().uuid(), name: z.string() })).optional(),
});

// ── Envelope schemas (for API response validation) ─────────────────────────────

export const accountResponseEnvelopeSchema = z.object({ account: accountResponseSchema });

// ── Inferred types ─────────────────────────────────────────────────────────────

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type AccountResponse = z.infer<typeof accountResponseSchema>;
