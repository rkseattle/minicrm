/**
 * Meeting brief controller — request/response shaping only.
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

/** Activity types eligible for meeting brief generation — mirrors ActivityTimeline's BRIEF_ELIGIBLE_TYPES. */
const BRIEF_ELIGIBLE_TYPES: ReadonlySet<string> = new Set(['Call', 'Meeting']);

/**
 * Mirrors the UI gate in ActivityTimeline: briefs are only for
 * future-dated Call/Meeting activities linked to a contact. Enforced here too
 * so a direct POST cannot generate a brief for an activity the UI would never
 * show the action for (e.g. an owned Email, Note, or Task).
 */
function isBriefEligible(activity: { type: string; due_date: string | null }): boolean {
  if (!BRIEF_ELIGIBLE_TYPES.has(activity.type)) return false;
  if (!activity.due_date) return false;
  const today = new Date().toISOString().slice(0, 10);
  return activity.due_date >= today;
}

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

  if (!activity.contact_id || !isBriefEligible(activity)) {
    res.status(400).json({
      error: {
        code: 'NOT_BRIEF_ELIGIBLE',
        message:
          'A meeting brief can only be generated for a future-dated Call or Meeting activity linked to a contact.',
      },
    });
    return;
  }

  try {
    const result = await generateMeetingBrief(id, req.user!.id, req.user!.role);
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
