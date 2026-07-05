/**
 * Lead score controller — request/response shaping only. (MINCRM-441 prerequisite)
 * No business logic here; scoring goes through leadScoreService.
 */

import type { Request, Response } from 'express';
import { findLeadById } from '../services/leadsService.js';
import { scoreLead } from '../services/leadScoreService.js';

/**
 * GET /api/v1/leads/:id/score
 * Computes an on-demand rule-based quality score for the lead. Not
 * persisted — recomputed on every request.
 */
export async function getLeadScoreHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const lead = await findLeadById(id);

  if (!lead) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    return;
  }

  const result = await scoreLead(lead);
  res.status(200).json(result);
}
