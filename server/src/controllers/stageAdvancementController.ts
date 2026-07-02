/**
 * Stage advancement controller — request/response shaping only. (MINCRM-443)
 * No business logic here; all AI orchestration and DB access goes through stageAdvancementService.
 */

import type { Request, Response } from 'express';
import { findDealById } from '../services/dealService.js';
import { checkStageAdvancement } from '../services/stageAdvancementService.js';

const FORBIDDEN_OWNERSHIP_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message:
      'You can only check stage advancement on deals you own. Contact an admin to check deals owned by others.',
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

  if (deal.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  const result = await checkStageAdvancement(id, req.user!.id);
  if (!result) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  res.status(200).json(result);
}
