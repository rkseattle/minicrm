/**
 * Lead score narrative controller — request/response shaping only. (MINCRM-441)
 * No business logic here; all AI orchestration goes through leadScoreNarrativeService.
 */

import type { Request, Response } from 'express';
import { handleAiServiceError } from '../utils/aiErrorHandling.js';
import { generateLeadScoreNarrative } from '../services/leadScoreNarrativeService.js';

/**
 * POST /api/v1/leads/:id/score-narrative
 * Runs an on-demand AI narrative explanation of the lead's quality score.
 * Not persisted — the client re-requests each time the action is triggered.
 */
export async function generateLeadScoreNarrativeHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = String(req.params['id']);

  try {
    const result = await generateLeadScoreNarrative(id, req.user!.id);
    if (!result) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
      return;
    }
    res.status(200).json(result);
  } catch (err: unknown) {
    if (handleAiServiceError(err, res)) return;
    throw err;
  }
}
