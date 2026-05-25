/**
 * Pipeline controller — request/response shaping for pipeline management
 * endpoints (MINCRM-397). No business logic; all DB access via pipelineService.
 */

import type { Request, Response } from 'express';
import {
  listPipelines,
  createPipeline,
  updatePipeline,
  deletePipeline,
  findPipelineById,
  toPipelineResponse,
} from '../services/pipelineService.js';
import {
  createPipelineSchema,
  updatePipelineSchema,
} from '@minicrm/shared/schemas/pipelineSchema.js';

/**
 * GET /api/v1/pipelines
 * Returns all pipelines ordered by default-first, then name.
 */
export async function listPipelinesHandler(_req: Request, res: Response): Promise<void> {
  const rows = await listPipelines();
  res.status(200).json({ pipelines: rows.map(toPipelineResponse) });
}

/**
 * POST /api/v1/pipelines
 * Creates a new non-default pipeline. Admin only.
 */
export async function createPipelineHandler(req: Request, res: Response): Promise<void> {
  const parsed = createPipelineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  try {
    const actor = { id: req.user!.id, name: req.user!.name };
    const pipeline = await createPipeline(parsed.data, actor);
    res.status(201).json(toPipelineResponse(pipeline));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'PIPELINE_NAME_CONFLICT') {
      res
        .status(409)
        .json({ error: { code: 'PIPELINE_NAME_CONFLICT', message: (err as Error).message } });
      return;
    }
    throw err;
  }
}

/**
 * PATCH /api/v1/pipelines/:id
 * Renames a pipeline. Admin only.
 */
export async function updatePipelineHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);

  const parsed = updatePipelineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  try {
    const actor = { id: req.user!.id, name: req.user!.name };
    const pipeline = await updatePipeline(id, parsed.data, actor);
    if (!pipeline) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pipeline not found' } });
      return;
    }
    res.status(200).json(toPipelineResponse(pipeline));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'PIPELINE_NAME_CONFLICT') {
      res
        .status(409)
        .json({ error: { code: 'PIPELINE_NAME_CONFLICT', message: (err as Error).message } });
      return;
    }
    throw err;
  }
}

/**
 * DELETE /api/v1/pipelines/:id
 * Deletes a non-default pipeline. Admin only.
 * Blocked if the pipeline is the default or has open deals.
 */
export async function deletePipelineHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);

  const existing = await findPipelineById(id);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pipeline not found' } });
    return;
  }

  try {
    const actor = { id: req.user!.id, name: req.user!.name };
    await deletePipeline(id, actor);
    res.status(200).json({ id });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'PIPELINE_DEFAULT') {
      res
        .status(403)
        .json({ error: { code: 'PIPELINE_DEFAULT', message: (err as Error).message } });
      return;
    }
    if (code === 'PIPELINE_HAS_DEALS') {
      const dealCount = (err as Error & { dealCount: number }).dealCount;
      res.status(409).json({
        error: {
          code: 'PIPELINE_HAS_DEALS',
          message: (err as Error).message,
          dealCount,
        },
      });
      return;
    }
    throw err;
  }
}
