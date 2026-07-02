/**
 * Objection matching controller — request/response shaping only. (MINCRM-471)
 * No business logic here; all AI orchestration and DB access goes through objectionMatchingService.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { findActivityById } from '../services/activityService.js';
import {
  classifyActivityObjection,
  findObjectionPrecedents,
} from '../services/objectionMatchingService.js';
import { OBJECTION_CATEGORIES } from '@minicrm/shared/schemas/objectionSchema.js';

/**
 * POST /api/activities/:id/classify-objection
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

  try {
    const result = await classifyActivityObjection(id, req.user!.id);
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

const precedentsQuerySchema = z.object({
  category: z.enum(OBJECTION_CATEGORIES),
});

/**
 * GET /api/activities/:id/objection-precedents?category=Price
 * Returns the top 3 similar objections from past won deals for the given category.
 */
export async function getObjectionPrecedentsHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const activity = await findActivityById(id);
  if (!activity) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Activity not found' } });
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
