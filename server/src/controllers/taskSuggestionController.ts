/**
 * Task suggestion controller — request/response shaping only. (MINCRM-438)
 * No business logic here; all AI orchestration goes through taskSuggestionService.
 */

import type { Request, Response } from 'express';
import { findActivityById } from '../services/activityService.js';
import { generateTaskSuggestions } from '../services/taskSuggestionService.js';

const FORBIDDEN_OWNERSHIP_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message:
      'You can only get task suggestions for activities you own. Contact an admin for others.',
  },
};

/**
 * POST /api/v1/activities/:id/task-suggestions
 * Runs an on-demand AI follow-up task suggestion for the activity.
 * Not persisted — the client calls this once, immediately after activity save.
 */
export async function generateTaskSuggestionsHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const activity = await findActivityById(id);

  if (!activity) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Activity not found' } });
    return;
  }

  if (activity.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  try {
    const result = await generateTaskSuggestions(id, req.user!.id);
    if (!result) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Activity not found' } });
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
