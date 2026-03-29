/**
 * Deal controller — request/response shaping for deal endpoints.
 * No business logic here; all DB access goes through dealService.
 */

import type { Request, Response } from 'express';
import { createDealSchema, updateDealSchema } from '@minicrm/shared/schemas/dealSchema.js';
import {
  createDeal,
  findDealById,
  listDeals,
  updateDeal,
  deleteDeal,
  listDealContacts,
} from '../services/dealService.js';

const FORBIDDEN_ERROR = { error: { code: 'FORBIDDEN', message: 'Forbidden' } };

/**
 * POST /api/deals
 * Creates a new deal owned by the authenticated user.
 */
export async function createDealHandler(req: Request, res: Response): Promise<void> {
  const parsed = createDealSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const deal = await createDeal({ ...parsed.data, owner_id: req.user!.id });
  res.status(201).json({ deal });
}

/**
 * GET /api/deals
 * Lists deals. Pass ?owner=me to scope to the authenticated user's deals.
 * Pass ?account=<uuid> to filter by account.
 */
export async function listDealsHandler(req: Request, res: Response): Promise<void> {
  const ownerId = req.query.owner === 'me' ? req.user!.id : undefined;
  const accountId =
    typeof req.query.account === 'string' && req.query.account ? req.query.account : undefined;

  const deals = await listDeals({ ownerId, accountId });
  res.status(200).json({ deals });
}

/**
 * GET /api/deals/:id
 * Returns a single deal by ID, including its linked contacts.
 */
export async function getDealHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const deal = await findDealById(id);

  if (!deal) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  const contacts = await listDealContacts(id);
  res.status(200).json({ deal, contacts });
}

/**
 * PATCH /api/deals/:id
 * Updates one or more fields of an existing deal.
 * Reps may only update deals they own; admins may update any deal.
 */
export async function updateDealHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateDealSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const id = String(req.params['id']);
  const existing = await findDealById(id);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_ERROR);
    return;
  }

  const deal = await updateDeal(id, parsed.data);
  res.status(200).json({ deal });
}

/**
 * DELETE /api/deals/:id
 * Deletes a deal. Linked contacts and accounts are not affected.
 * Returns 204 No Content on success.
 * Reps may only delete deals they own; admins may delete any deal.
 */
export async function deleteDealHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const existing = await findDealById(id);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_ERROR);
    return;
  }

  await deleteDeal(id);
  res.status(204).send();
}
