/**
 * Pipeline stage controller — request/response shaping for pipeline stage
 * configuration endpoints (MINCRM-180).
 * No business logic here; all DB access goes through pipelineStageService.
 */

import type { Request, Response } from 'express';
import {
  listPipelineStages,
  createPipelineStage,
  updatePipelineStage,
  deletePipelineStage,
  findPipelineStageById,
  toStageResponse,
} from '../services/pipelineStageService.js';
import {
  createPipelineStageSchema,
  updatePipelineStageSchema,
} from '@minicrm/shared/schemas/pipelineStageSchema.js';

/**
 * GET /api/settings/pipeline-stages
 * Returns all pipeline stages ordered by sort_order. Public endpoint —
 * the client fetches this on app startup to build the stage selector.
 *
 * @param _req - Express request (unused).
 * @param res - Express response.
 */
export async function listPipelineStagesHandler(_req: Request, res: Response): Promise<void> {
  const stages = await listPipelineStages();
  res.status(200).json({ stages: stages.map(toStageResponse) });
}

/**
 * POST /api/settings/pipeline-stages
 * Creates a new pipeline stage. Admin only.
 *
 * @param req - Express request with validated body.
 * @param res - Express response.
 */
export async function createPipelineStageHandler(req: Request, res: Response): Promise<void> {
  const parsed = createPipelineStageSchema.safeParse(req.body);
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
    const stage = await createPipelineStage(parsed.data);
    res.status(201).json(toStageResponse(stage));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'STAGE_NAME_CONFLICT') {
      res
        .status(409)
        .json({ error: { code: 'STAGE_NAME_CONFLICT', message: (err as Error).message } });
      return;
    }
    throw err;
  }
}

/**
 * PATCH /api/settings/pipeline-stages/:id
 * Updates an existing pipeline stage. Admin only.
 * Fixed stages cannot be renamed; renaming atomically updates all deals.
 *
 * @param req - Express request with `id` param and validated body.
 * @param res - Express response.
 */
export async function updatePipelineStageHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);

  const parsed = updatePipelineStageSchema.safeParse(req.body);
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
    const stage = await updatePipelineStage(id, parsed.data);
    if (!stage) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pipeline stage not found' } });
      return;
    }
    res.status(200).json(toStageResponse(stage));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'STAGE_FIXED') {
      res.status(403).json({ error: { code: 'STAGE_FIXED', message: (err as Error).message } });
      return;
    }
    if (code === 'STAGE_NAME_CONFLICT') {
      res
        .status(409)
        .json({ error: { code: 'STAGE_NAME_CONFLICT', message: (err as Error).message } });
      return;
    }
    throw err;
  }
}

/**
 * DELETE /api/settings/pipeline-stages/:id
 * Deletes a pipeline stage. Admin only.
 * Blocked if the stage is fixed or has open deals.
 *
 * @param req - Express request with `id` param.
 * @param res - Express response.
 */
export async function deletePipelineStageHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);

  // Confirm stage exists before attempting delete
  const existing = await findPipelineStageById(id);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pipeline stage not found' } });
    return;
  }

  try {
    await deletePipelineStage(id);
    res.status(200).json({ id });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'STAGE_FIXED') {
      res.status(403).json({ error: { code: 'STAGE_FIXED', message: (err as Error).message } });
      return;
    }
    if (code === 'STAGE_HAS_OPEN_DEALS') {
      const dealCount = (err as Error & { dealCount: number }).dealCount;
      res.status(409).json({
        error: {
          code: 'STAGE_HAS_OPEN_DEALS',
          message: (err as Error).message,
          dealCount,
        },
      });
      return;
    }
    throw err;
  }
}
