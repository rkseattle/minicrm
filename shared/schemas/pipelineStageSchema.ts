/**
 * Shared Zod schemas for pipeline stage configuration (MINCRM-180).
 * Imported by both server (request validation) and client (API response typing).
 */

import { z } from 'zod';

/**
 * Shape of a pipeline stage row as returned by GET /api/settings/pipeline-stages.
 */
export const pipelineStageResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sort_order: z.number().int(),
  probability: z.number().int().min(0).max(100),
  is_terminal: z.boolean(),
  is_fixed: z.boolean(),
});

export type PipelineStageResponse = z.infer<typeof pipelineStageResponseSchema>;

/**
 * Request body for creating a new pipeline stage.
 * sort_order is intentionally absent — the server auto-assigns it as
 * MAX(non-terminal sort_order) + 10, eliminating client-side collision risk.
 */
export const createPipelineStageSchema = z.object({
  name: z
    .string({ required_error: 'Stage name is required' })
    .min(1, 'Stage name cannot be blank')
    .max(100, 'Stage name must be 100 characters or fewer')
    .trim(),
  probability: z.number().int().min(0).max(100).optional().default(0),
});

export type CreatePipelineStageInput = z.infer<typeof createPipelineStageSchema>;

/**
 * Request body for updating an existing pipeline stage.
 * All fields optional; at least one must be provided.
 * Fixed stages may only update probability and sort_order.
 */
export const updatePipelineStageSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Stage name cannot be blank')
      .max(100, 'Stage name must be 100 characters or fewer')
      .trim()
      .optional(),
    sort_order: z.number().int().nonnegative().optional(),
    probability: z.number().int().min(0).max(100).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdatePipelineStageInput = z.infer<typeof updatePipelineStageSchema>;

/**
 * Request body for atomically reordering all pipeline stages (MINCRM-381).
 * The client sends the full ordered array of stage IDs; the server assigns
 * sort_order 1..N in that order within a single transaction.
 */
export const reorderPipelineStagesSchema = z.object({
  stages: z
    .array(z.string().uuid('Each stage ID must be a valid UUID'))
    .min(1, 'At least one stage ID is required'),
});

export type ReorderPipelineStagesInput = z.infer<typeof reorderPipelineStagesSchema>;
