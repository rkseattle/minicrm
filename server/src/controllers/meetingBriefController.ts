/**
 * Meeting brief controller — request/response shaping only. (MINCRM-465)
 * No business logic here; all AI orchestration and DB access goes through meetingBriefService.
 */

import type { Request, Response } from 'express';
import { handleAiServiceError } from '../utils/aiErrorHandling.js';
import { findActivityById } from '../services/activityService.js';
import { generateMeetingBrief, getMeetingBrief } from '../services/meetingBriefService.js';

const FORBIDDEN_OWNERSHIP_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message:
      'You can only generate or view briefs for activities you own. Contact an admin to act on activities owned by others.',
  },
};

/**
 * POST /api/activities/:id/brief
 * Generates (or regenerates) the pre-meeting brief for the activity.
 */
export async function generateMeetingBriefHandler(req: Request, res: Response): Promise<void> {
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
    const result = await generateMeetingBrief(id, req.user!.id);
    if (!result) {
      res.status(400).json({
        error: {
          code: 'NO_LINKED_CONTACT',
          message: 'A meeting brief requires the activity to be linked to a contact.',
        },
      });
      return;
    }
    res.status(200).json(result);
  } catch (err: unknown) {
    if (handleAiServiceError(err, res)) return;
    throw err;
  }
}

/**
 * GET /api/activities/:id/brief
 * Returns the most recently generated brief for the activity (for the
 * shareable, authenticated link). 404 when none has been generated yet.
 */
export async function getMeetingBriefHandler(req: Request, res: Response): Promise<void> {
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

  const result = await getMeetingBrief(id);
  if (!result) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'No brief has been generated for this activity yet' },
    });
    return;
  }
  res.status(200).json(result);
}
