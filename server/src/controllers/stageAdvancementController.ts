/**
 * Stage advancement controller — request/response shaping only.
 * No business logic here; all AI orchestration and DB access goes through stageAdvancementService.
 */

import type { Request, Response } from 'express';
import { handleAiServiceError } from '../utils/aiErrorHandling.js';
import { findDealById } from '../services/dealService.js';
import { canAccessOwnedRecord } from '../services/visibilityService.js';
import { checkStageAdvancement } from '../services/stageAdvancementService.js';

const FORBIDDEN_VISIBILITY_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message: 'You do not have visibility into this deal.',
  },
};

/**
 * GET /api/deals/:id/stage-advancement
 * Runs a passive AI check for whether the deal looks ready to advance to its
 * next pipeline stage. Returns { ready: false } (not an error) when the deal
 * is in a terminal stage, has no next stage, or the AI is not confident.
 */
export async function getStageAdvancementHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const deal = await findDealById(id);

  if (!deal) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  const canAccess = await canAccessOwnedRecord('deal', deal.owner_id, req.user!.id, req.user!.role);
  if (!canAccess) {
    res.status(403).json(FORBIDDEN_VISIBILITY_ERROR);
    return;
  }

  try {
    const result = await checkStageAdvancement(id, req.user!.id);
    if (!result) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
      return;
    }
    res.status(200).json(result);
  } catch (err: unknown) {
    if (handleAiServiceError(err, res)) return;
    throw err;
  }
}
