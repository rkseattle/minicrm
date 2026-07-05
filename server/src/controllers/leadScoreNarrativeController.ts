/**
 * Lead score narrative controller — request/response shaping only. (MINCRM-441)
 * No business logic here; all AI orchestration goes through leadScoreNarrativeService.
 */

import type { Request, Response } from 'express';
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
    const tagged = err as { statusCode?: number; message?: string };
    if (tagged.statusCode === 502) {
      res.status(502).json({
        error: { code: 'AI_PROVIDER_ERROR', message: tagged.message ?? 'AI provider error' },
      });
      return;
    }
    if (tagged.statusCode === 503) {
      res.status(503).json({
        error: { code: 'AI_NOT_CONFIGURED', message: tagged.message ?? 'AI is not configured' },
      });
      return;
    }
    throw err;
  }
}
