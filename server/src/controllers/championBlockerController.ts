/**
 * Champion/blocker controller — request/response shaping only. (MINCRM-466)
 * No business logic here; all AI orchestration and DB access goes through championBlockerService.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { findContactById } from '../services/contactService.js';
import { findDealById } from '../services/dealService.js';
import {
  getContactChampionBlockerStatus,
  dismissContactClassification,
  overrideContactClassification,
  getDealStakeholderMap,
} from '../services/championBlockerService.js';
import { CHAMPION_BLOCKER_STATUSES } from '@minicrm/shared/schemas/championBlockerSchema.js';

const overrideSchema = z.object({
  status: z.enum(CHAMPION_BLOCKER_STATUSES),
  reason: z.string().trim().max(1000).nullable().optional(),
});

/**
 * GET /api/contacts/:id/champion-blocker
 * Returns the effective champion/blocker classification for the contact.
 */
export async function getContactChampionBlockerHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const contact = await findContactById(id);
  if (!contact) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  const result = await getContactChampionBlockerStatus(id);
  res.status(200).json(result);
}

/**
 * POST /api/contacts/:id/champion-blocker/dismiss
 * Records a rep's "Not accurate" feedback, suppressing the badge until new signals arrive.
 */
export async function dismissContactChampionBlockerHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = String(req.params['id']);
  const contact = await findContactById(id);
  if (!contact) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  await dismissContactClassification(id, req.user!.id);
  const result = await getContactChampionBlockerStatus(id);
  res.status(200).json(result);
}

/**
 * PATCH /api/contacts/:id/champion-blocker/override
 * Records a rep's manual override, with an optional reason. Persists until new signals shift it.
 */
export async function overrideContactChampionBlockerHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = String(req.params['id']);
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const contact = await findContactById(id);
  if (!contact) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  await overrideContactClassification(
    id,
    parsed.data.status,
    parsed.data.reason ?? null,
    req.user!.id,
  );
  const result = await getContactChampionBlockerStatus(id);
  res.status(200).json(result);
}

/**
 * GET /api/deals/:id/stakeholder-map
 * Returns the champion/blocker stakeholder map for the deal's linked contacts.
 */
export async function getDealStakeholderMapHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const deal = await findDealById(id);
  if (!deal) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  const result = await getDealStakeholderMap(id);
  res.status(200).json(result);
}
