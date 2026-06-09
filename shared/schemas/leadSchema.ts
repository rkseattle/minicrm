/**
 * Shared Zod schemas for lead-related validation.
 * Imported by both the server (request validation) and the client (form validation).
 * (MINCRM-173, MINCRM-174, MINCRM-175)
 */

import { z } from 'zod';

/** Valid lead source values */
export const LEAD_SOURCES = ['Web', 'Referral', 'Trade Show', 'Cold Outreach', 'Other'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/** Valid lead status values (MINCRM-174) */
export const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Disqualified'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * Schema for creating a new lead.
 * first_name and email are required; all other fields are optional.
 */
export const createLeadSchema = z.object({
  first_name: z
    .string({ required_error: 'First name is required' })
    .min(1, 'First name is required')
    .trim(),
  last_name: z.string().trim().optional(),
  email: z
    .string({ required_error: 'Email is required' })
    .email('Must be a valid email address')
    .toLowerCase()
    .trim(),
  phone: z.string().trim().optional(),
  company_name: z.string().trim().optional(),
  lead_source: z.enum(LEAD_SOURCES).optional(),
  notes: z.string().trim().optional(),
  owner_id: z.string().uuid('Owner must be a valid user UUID').optional(),
});

/**
 * Schema for updating an existing lead.
 * All create fields are optional plus status and disqualification_reason.
 * At least one field must be present.
 */
export const updateLeadSchema = createLeadSchema
  .extend({
    status: z.enum(LEAD_STATUSES).optional(),
    disqualification_reason: z.string().trim().nullable().optional(),
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
 * Schema for the convert-lead request body (MINCRM-175).
 */
export const convertLeadSchema = z.object({
  contact: z.object({
    first_name: z.string().min(1, 'First name is required').trim(),
    last_name: z.string().trim().min(1, 'Last name is required to convert a lead to a contact'),
    email: z.string().email('Must be a valid email address').toLowerCase().trim(),
    phone: z.string().trim().optional(),
  }),
  account: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('create'),
      name: z.string().min(1, 'Account name is required').trim(),
    }),
    z.object({
      mode: z.literal('link'),
      account_id: z.string().uuid('Account ID must be a valid UUID'),
    }),
  ]),
  deal: z.object({
    name: z.string().min(1, 'Deal name is required').trim(),
    stage: z.string().optional(),
    value: z.string().trim().optional(),
    close_date: z.string().optional(),
  }),
});

/**
 * Schema for the safe lead response shape returned to API consumers.
 */
export const leadResponseSchema = z.object({
  id: z.string().uuid(),
  first_name: z.string(),
  last_name: z.string().nullable(),
  email: z.string().email(),
  phone: z.string().nullable(),
  company_name: z.string().nullable(),
  lead_source: z.enum(LEAD_SOURCES).nullable(),
  status: z.enum(LEAD_STATUSES),
  disqualification_reason: z.string().nullable(),
  notes: z.string().nullable(),
  owner_id: z.string().uuid(),
  converted_at: z.string().or(z.date()).nullable(),
  converted_contact_id: z.string().uuid().nullable(),
  converted_account_id: z.string().uuid().nullable(),
  converted_deal_id: z.string().uuid().nullable(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
  /** Optimistic lock version (MINCRM-349) */
  version: z.number().int(),
});

/** Status history entry shape */
export const leadStatusHistorySchema = z.object({
  id: z.string().uuid(),
  lead_id: z.string().uuid(),
  from_status: z.enum(LEAD_STATUSES).nullable(),
  to_status: z.enum(LEAD_STATUSES),
  changed_by_name: z.string().nullable(),
  created_at: z.string().or(z.date()),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;
export type LeadResponse = z.infer<typeof leadResponseSchema>;
export type LeadStatusHistory = z.infer<typeof leadStatusHistorySchema>;
