/**
 * Deal health check controller — request/response shaping only.
 * No business logic here; all AI orchestration and DB access goes through dealHealthService.
 */

import type { Request, Response } from 'express';
import { handleAiServiceError } from '../utils/aiErrorHandling.js';
import { findDealById } from '../services/dealService.js';
import { canAccessOwnedRecord } from '../services/visibilityService.js';
import { generateDealHealthCheck } from '../services/dealHealthService.js';

const FORBIDDEN_VISIBILITY_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message: 'You do not have visibility into this deal.',
  },
};

/**
 * POST /api/deals/:id/health-check
 * Runs an on-demand AI health check for the deal and returns the result.
 * Not persisted — the client re-requests each time the action is triggered.
 */
export async function runDealHealthCheckHandler(req: Request, res: Response): Promise<void> {
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
    const result = await generateDealHealthCheck(id, req.user!.id);
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
