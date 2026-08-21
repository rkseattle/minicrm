/**
 * Objection matching controller — request/response shaping only.
 * No business logic here; all AI orchestration and DB access goes through objectionMatchingService.
 */

import type { Request, Response } from 'express';
import { handleAiServiceError } from '../utils/aiErrorHandling.js';
import { z } from 'zod';
import { findActivityById } from '../services/activityService.js';
import { canAccessOwnedRecord } from '../services/visibilityService.js';
import {
  classifyActivityObjection,
  findObjectionPrecedents,
} from '../services/objectionMatchingService.js';
import { OBJECTION_CATEGORIES } from '@minicrm/shared/schemas/objectionSchema.js';

const FORBIDDEN_VISIBILITY_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message: 'You do not have visibility into this activity.',
  },
};

/**
 * POST /api/v1/activities/:id/classify-objection
 * Classifies the activity's note text into an objection category on demand.
 * Returns null when no clear objection is detected.
 */
export async function classifyActivityObjectionHandler(req: Request, res: Response): Promise<void> {
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
    const result = await classifyActivityObjection(id, req.user!.id);
    res.status(200).json(result);
  } catch (err: unknown) {
    if (handleAiServiceError(err, res)) return;
    throw err;
  }
}

const precedentsQuerySchema = z.object({
  category: z.enum(OBJECTION_CATEGORIES),
});

/**
 * GET /api/v1/activities/:id/objection-precedents?category=Price
 * Returns the top 3 similar objections from past won deals for the given category.
 */
export async function getObjectionPrecedentsHandler(req: Request, res: Response): Promise<void> {
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

  const parsed = precedentsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const result = await findObjectionPrecedents(parsed.data.category);
  res.status(200).json(result);
}
