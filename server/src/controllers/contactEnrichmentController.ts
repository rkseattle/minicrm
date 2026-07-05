/**
 * Contact enrichment controller — request/response shaping only. (MINCRM-439)
 * No business logic here; all AI orchestration goes through contactEnrichmentService.
 */

import type { Request, Response } from 'express';
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
