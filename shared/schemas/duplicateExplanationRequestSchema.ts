/**
 * Shared Zod schema for the duplicate explanation request body.
 *
 * record_b is either an existing record's UUID (record_b_id) or raw field
 * values for an unsaved record (record_b_fields) — the latter covers the
 * contact/account create-form duplicate banner, where the "new" side of the
 * pair has not been persisted yet (the create request was rejected with 409).
 */

import { z } from 'zod';

const duplicateFieldsSchema = z.object({
  first_name: z.string().trim().optional(),
  last_name: z.string().trim().optional(),
  email: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  name: z.string().trim().optional(),
});

export const explainDuplicateSchema = z
  .object({
    entity_type: z.enum(['contact', 'account']),
    record_a_id: z.string().uuid('record_a_id must be a valid UUID'),
    record_b_id: z.string().uuid('record_b_id must be a valid UUID').optional(),
    record_b_fields: duplicateFieldsSchema.optional(),
  })
  .refine((data) => Boolean(data.record_b_id) !== Boolean(data.record_b_fields), {
    message: 'Exactly one of record_b_id or record_b_fields must be provided',
  });
export type ExplainDuplicateInput = z.infer<typeof explainDuplicateSchema>;
