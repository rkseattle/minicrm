/**
 * Task suggestion controller — request/response shaping only. (MINCRM-438)
 * No business logic here; all AI orchestration goes through taskSuggestionService.
 */

import type { Request, Response } from 'express';
import { handleAiServiceError } from '../utils/aiErrorHandling.js';
import { findActivityById } from '../services/activityService.js';
import { canAccessOwnedRecord } from '../services/visibilityService.js';
import { generateTaskSuggestions } from '../services/taskSuggestionService.js';

const FORBIDDEN_VISIBILITY_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message: 'You do not have visibility into this activity.',
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

  const canAccess = await canAccessOwnedRecord(
    'activity',
    activity.owner_id,
    req.user!.id,
    req.user!.role,
  );
  if (!canAccess) {
    res.status(403).json(FORBIDDEN_VISIBILITY_ERROR);
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
    if (handleAiServiceError(err, res)) return;
    throw err;
  }
}
