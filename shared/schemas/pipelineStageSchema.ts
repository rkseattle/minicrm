/**
 * Shared Zod schemas for pipeline stage configuration.
 * Imported by both server (request validation) and client (API response typing).
 */

import { z } from 'zod';

/**
 * Schema for the stage_exit_requirements jsonb column.
 *
 * required_fields: deal fields that must be non-null before leaving this stage; blocks the transition.
 * warning_fields:  deal fields that ideally should be set; the transition is allowed but a warning is returned.
 */
export const stageExitRequirementsSchema = z.object({
  required_fields: z.array(z.string()),
  warning_fields: z.array(z.string()),
});

export type StageExitRequirements = z.infer<typeof stageExitRequirementsSchema>;

/**
 * Shape of a pipeline stage row as returned by GET /api/settings/pipeline-stages.
 */
export const pipelineStageResponseSchema = z.object({
  id: z.string().uuid(),
  /** UUID of the pipeline this stage belongs to */
  pipeline_id: z.string().uuid(),
  name: z.string(),
  sort_order: z.number().int(),
  probability: z.number().int().min(0).max(100),
  is_terminal: z.boolean(),
  is_fixed: z.boolean(),
  /** Configurable data quality gates for stage transitions */
  stage_exit_requirements: stageExitRequirementsSchema,
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
 * Fixed stages may only update probability, sort_order, and stage_exit_requirements.
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
    /** Configurable data quality gates for stage transitions */
    stage_exit_requirements: stageExitRequirementsSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdatePipelineStageInput = z.infer<typeof updatePipelineStageSchema>;

/**
 * Request body for atomically reordering all pipeline stages.
 * The client sends the full ordered array of stage IDs; the server assigns
 * sort_order 1..N in that order within a single transaction.
 */
export const reorderPipelineStagesSchema = z.object({
  stages: z
    .array(z.string().uuid('Each stage ID must be a valid UUID'))
    .min(1, 'At least one stage ID is required'),
});

export type ReorderPipelineStagesInput = z.infer<typeof reorderPipelineStagesSchema>;
