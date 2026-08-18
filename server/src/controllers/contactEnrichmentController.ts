/**
 * Contact enrichment controller — request/response shaping only.
 * No business logic here; all AI orchestration goes through contactEnrichmentService.
 */

import type { Request, Response } from 'express';
import { handleAiServiceError } from '../utils/aiErrorHandling.js';
import { enrichContactFromTextSchema } from '@minicrm/shared/schemas/contactEnrichmentSchema.js';
import { enrichContactFromText } from '../services/contactEnrichmentService.js';

/**
 * POST /api/v1/contacts/enrich-from-text
 * Runs an on-demand AI extraction of contact fields from pasted freeform text.
 * Not persisted — the raw text is never stored; extracted fields are only
 * saved if the user submits the contact create form.
 */
export async function enrichContactFromTextHandler(req: Request, res: Response): Promise<void> {
  const parsed = enrichContactFromTextSchema.safeParse(req.body);
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
    const result = await enrichContactFromText(parsed.data.raw_text, req.user!.id);
    res.status(200).json(result);
  } catch (err: unknown) {
    if (handleAiServiceError(err, res)) return;
    throw err;
  }
}
