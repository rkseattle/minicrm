/**
 * Shared Zod schemas for contact-related validation.
 * Imported by both the server (request validation) and the client (form validation).
 */

import { z } from 'zod';

/**
 * Schema for creating a new contact.
 * first_name, last_name, and email are required; all other fields are optional.
 */
export const createContactSchema = z.object({
  first_name: z
    .string({ required_error: 'First name is required' })
    .min(1, 'First name is required')
    .trim(),
  last_name: z
    .string({ required_error: 'Last name is required' })
    .min(1, 'Last name is required')
    .trim(),
  email: z
    .string({ required_error: 'Email is required' })
    .email('Must be a valid email address')
    .toLowerCase()
    .trim(),
  phone: z.string().trim().optional(),
  title: z.string().trim().optional(),
  department: z.string().trim().optional(),
  account_id: z.string().uuid('Account ID must be a valid UUID').nullable().optional(),
});

/**
 * Schema for updating an existing contact.
 * All create fields are optional; owner_id may also be changed.
 * At least one field must be present.
 */
export const updateContactSchema = createContactSchema
  .extend({
    owner_id: z.string().uuid('Owner must be a valid user UUID').optional(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * Schema for the safe contact response shape returned to API consumers.
 */
export const contactResponseSchema = z.object({
  id: z.string().uuid(),
  first_name: z.string(),
  last_name: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  department: z.string().nullable(),
  account_id: z.string().uuid().nullable(),
  owner_id: z.string().uuid(),
  /** Set when the contact was created via lead conversion (MINCRM-175) */
  source_lead_id: z.string().uuid().nullable().optional(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ContactResponse = z.infer<typeof contactResponseSchema>;
