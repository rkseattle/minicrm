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
  reorderPipelineStages,
  toStageResponse,
} from '../services/pipelineStageService.js';
import { markPipelineStagesReviewed } from '../services/settingsService.js';
import {
  createPipelineStageSchema,
  updatePipelineStageSchema,
  reorderPipelineStagesSchema,
} from '@minicrm/shared/schemas/pipelineStageSchema.js';
import logger from '../logger.js';

/**
 * GET /api/settings/pipeline-stages
 * Returns all pipeline stages ordered by sort_order. Public endpoint —
 * the client fetches this on app startup to build the stage selector.
 *
 * @param _req - Express request (unused).
 * @param res - Express response.
 */
export async function listPipelineStagesHandler(req: Request, res: Response): Promise<void> {
  // Optional ?pipelineId= query param scopes the response to a specific pipeline (MINCRM-397)
  const pipelineId =
    typeof req.query['pipelineId'] === 'string' ? req.query['pipelineId'] : undefined;
  const stages = await listPipelineStages(pipelineId);
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
    // req.user is guaranteed by the authenticate middleware on this route
    const actor = { id: req.user!.id, name: req.user!.name };
    // Accept pipeline_id from body or query string (MINCRM-397)
    const pipelineId =
      (typeof req.body['pipeline_id'] === 'string' ? req.body['pipeline_id'] : undefined) ??
      (typeof req.query['pipelineId'] === 'string' ? req.query['pipelineId'] : undefined);
    const stage = await createPipelineStage({ ...parsed.data, pipeline_id: pipelineId }, actor);
    res.status(201).json(toStageResponse(stage));
    // Mark task 1 of the setup checklist done (MINCRM-379), fire-and-forget
    void markPipelineStagesReviewed().catch((err: unknown) =>
      logger.warn({ err }, 'markPipelineStagesReviewed failed after create'),
    );
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
    // req.user is guaranteed by the authenticate middleware on this route
    const actor = { id: req.user!.id, name: req.user!.name };
    const stage = await updatePipelineStage(id, parsed.data, actor);
    if (!stage) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pipeline stage not found' } });
      return;
    }
    res.status(200).json(toStageResponse(stage));
    // Mark task 1 of the setup checklist done (MINCRM-379), fire-and-forget
    void markPipelineStagesReviewed().catch((err: unknown) =>
      logger.warn({ err }, 'markPipelineStagesReviewed failed after update'),
    );
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
    if (code === 'STAGE_SORT_ORDER_CONFLICT') {
      res
        .status(409)
        .json({ error: { code: 'STAGE_SORT_ORDER_CONFLICT', message: (err as Error).message } });
      return;
    }
    throw err;
  }
}

/**
 * PUT /api/settings/pipeline-stages/reorder
 * Atomically reorders all pipeline stages. Admin only (MINCRM-381).
 * Accepts { stages: [id1, id2, ...] } in desired order and writes all
 * sort_order values in a single transaction — no transient unique conflicts.
 *
 * @param req - Express request with body { stages: string[] }.
 * @param res - Express response with { stages: PipelineStageResponse[] }.
 */
export async function reorderPipelineStagesHandler(req: Request, res: Response): Promise<void> {
  const parsed = reorderPipelineStagesSchema.safeParse(req.body);
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
    // req.user is guaranteed by the authenticate middleware on this route
    const actor = { id: req.user!.id, name: req.user!.name };
    const rows = await reorderPipelineStages(parsed.data, actor);
    res.status(200).json({ stages: rows.map(toStageResponse) });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'STAGE_NOT_FOUND') {
      res.status(404).json({ error: { code: 'STAGE_NOT_FOUND', message: (err as Error).message } });
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
    // req.user is guaranteed by the authenticate middleware on this route
    const actor = { id: req.user!.id, name: req.user!.name };
    await deletePipelineStage(id, actor);
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
