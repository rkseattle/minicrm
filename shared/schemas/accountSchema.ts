/**
 * Shared Zod schemas for account-related validation.
 * Imported by both the server (request validation) and the client (form validation).
 */

import { z } from 'zod';

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
});

/**
 * Schema for updating an existing account.
 * All fields are optional; at least one must be present.
 */
export const updateAccountSchema = createAccountSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
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
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type AccountResponse = z.infer<typeof accountResponseSchema>;
