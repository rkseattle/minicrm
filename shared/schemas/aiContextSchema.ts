/**
 * Shared Zod schemas and TypeScript types for the user AI context feature.
 * Used by both client and server.
 * (MINCRM-427, MINCRM-428, MINCRM-429, MINCRM-430)
 */

import { z } from 'zod';

export const createAiContextSchema = z.object({
  key: z.string().trim().min(1, 'Key is required').max(100, 'Key must be 100 characters or fewer'),
  value: z
    .string()
    .trim()
    .min(1, 'Value is required')
    .max(500, 'Value must be 500 characters or fewer'),
});

export type CreateAiContextInput = z.infer<typeof createAiContextSchema>;

export const updateAiContextSchema = z
  .object({
    key: z.string().trim().min(1).max(100).optional(),
    value: z.string().trim().min(1).max(500).optional(),
  })
  .refine((data) => data.key !== undefined || data.value !== undefined, {
    message: 'At least one of key or value must be provided',
  });

export type UpdateAiContextInput = z.infer<typeof updateAiContextSchema>;

export interface AiContextEntryResponse {
  id: string;
  user_id: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

/**
 * A context entry proposed by the AI for the user to accept or dismiss.
 * Extracted from the assistant message content by the server before storage.
 * (MINCRM-429, MINCRM-430)
 */
export interface AiContextProposal {
  /** The key under which this preference should be stored (e.g. "a while"). */
  key: string;
  /** The resolved value for the preference (e.g. "30+ days without activity"). */
  value: string;
  /** Plain-language rationale shown to the user alongside the accept/dismiss chip. */
  reason: string;
}
