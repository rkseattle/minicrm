/**
 * Shared Zod schemas for tag-related validation (MINCRM-186).
 * Imported by both the server (request validation) and the client (form validation).
 */

import { z } from 'zod';

/**
 * Schema for creating a new tag.
 * name is required; it is lowercased and trimmed before storage.
 */
export const createTagSchema = z.object({
  name: z
    .string({ required_error: 'Tag name is required' })
    .min(1, 'Tag name is required')
    .max(100, 'Tag name must be 100 characters or fewer')
    .trim()
    .toLowerCase(),
});

/**
 * Schema for renaming an existing tag (admin only).
 * All fields are optional but at least one must be present.
 */
export const updateTagSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Tag name is required')
      .max(100, 'Tag name must be 100 characters or fewer')
      .trim()
      .toLowerCase()
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * Schema for attaching a tag to a record by name.
 * The server will create the tag if it does not already exist.
 */
export const attachTagSchema = z.object({
  name: z
    .string({ required_error: 'Tag name is required' })
    .min(1, 'Tag name is required')
    .max(100, 'Tag name must be 100 characters or fewer')
    .trim()
    .toLowerCase(),
});

/** Shape of a tag returned by the API */
export const tagResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
export type AttachTagInput = z.infer<typeof attachTagSchema>;
export type TagResponse = z.infer<typeof tagResponseSchema>;
