/**
 * Email draft controller — request/response shaping only.
 * No business logic here; all AI orchestration goes through emailDraftService.
 */

import type { Request, Response } from 'express';
import { handleAiServiceError } from '../utils/aiErrorHandling.js';
import { generateEmailDraftSchema } from '@minicrm/shared/schemas/emailDraftSchema.js';
import { findContactById } from '../services/contactService.js';
import { canAccessOwnedRecord } from '../services/visibilityService.js';
import { generateEmailDraft } from '../services/emailDraftService.js';

const FORBIDDEN_VISIBILITY_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message: 'You do not have visibility into this contact.',
  },
};

/**
 * POST /api/v1/contacts/:id/email-draft
 * Runs an on-demand AI email draft generation for the contact and returns the result.
 * Not persisted — the client re-requests each time the action or tone is changed.
 */
export async function generateEmailDraftHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const parsed = generateEmailDraftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid input',
      },
    });
    return;
  }

  const contact = await findContactById(id);
  if (!contact) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  const canAccess = await canAccessOwnedRecord(
    'contact',
    contact.owner_id,
    req.user!.id,
    req.user!.role,
  );
  if (!canAccess) {
    res.status(403).json(FORBIDDEN_VISIBILITY_ERROR);
    return;
  }

  try {
    const result = await generateEmailDraft(id, parsed.data.tone, req.user!.id);
    if (!result) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
      return;
    }
    res.status(200).json(result);
  } catch (err: unknown) {
    if (handleAiServiceError(err, res)) return;
    throw err;
  }
}
