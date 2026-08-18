/**
 * Follow-up timing controller — request/response shaping only.
 * No business logic here; all cached-read/recompute access goes through followUpTimingService.
 */

import type { Request, Response } from 'express';
import { findContactById } from '../services/contactService.js';
import { canAccessOwnedRecord } from '../services/visibilityService.js';
import { getFollowUpTiming } from '../services/followUpTimingService.js';

/**
 * GET /api/contacts/:id/followup-timing
 * Returns the best-time-to-contact suggestion for the contact, or null when
 * there is insufficient interaction history (fewer than 5 logged interactions).
 */
export async function getFollowUpTimingHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
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
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'You do not have visibility into this contact.' },
    });
    return;
  }

  const suggestion = await getFollowUpTiming(id);
  res.status(200).json({ suggestion });
}
