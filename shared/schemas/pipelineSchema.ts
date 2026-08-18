/**
 * Shared Zod schemas for pipeline management.
 * Imported by both server (request validation) and client (API response typing).
 */

import { z } from 'zod';

/**
 * Shape of a pipeline row as returned by GET /api/v1/pipelines.
 */
export const pipelineResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  is_default: z.boolean(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
});

export type PipelineResponse = z.infer<typeof pipelineResponseSchema>;

/**
 * Request body for creating a new pipeline.
 */
export const createPipelineSchema = z.object({
  name: z
    .string({ required_error: 'Pipeline name is required' })
    .trim()
    .min(1, 'Pipeline name cannot be blank')
    .max(100, 'Pipeline name must be 100 characters or fewer'),
});

export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;

/**
 * Request body for updating an existing pipeline.
 * Only name may be changed; is_default is managed by promoting/demoting.
 */
export const updatePipelineSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Pipeline name cannot be blank')
      .max(100, 'Pipeline name must be 100 characters or fewer')
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>;
