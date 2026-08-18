/**
 * Activity summary controller — request/response shaping only.
 * No business logic here; all AI orchestration goes through activitySummaryService.
 */

import type { Request, Response } from 'express';
import { handleAiServiceError } from '../utils/aiErrorHandling.js';
import { summarizeActivityTextSchema } from '@minicrm/shared/schemas/activitySummarySchema.js';
import { summarizeActivityText } from '../services/activitySummaryService.js';

/**
 * POST /api/v1/activities/summarize
 * Runs an on-demand AI summarization of pasted call/meeting/note text.
 * Not persisted — the client saves the (possibly edited) result via the
 * normal activity create/update endpoints.
 */
export async function summarizeActivityHandler(req: Request, res: Response): Promise<void> {
  const parsed = summarizeActivityTextSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid input',
      },
    });
    return;
  }

  try {
    const result = await summarizeActivityText(parsed.data.raw_text, req.user!.id);
    res.status(200).json(result);
  } catch (err: unknown) {
    if (handleAiServiceError(err, res)) return;
    throw err;
  }
}
