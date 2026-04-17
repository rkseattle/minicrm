/**
 * Bulk controller — request/response shaping for bulk operation endpoints.
 * No business logic here; all DB access goes through bulkService. (MINCRM-188)
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { bulkContacts, bulkAccounts, bulkDeals } from '../services/bulkService.js';

const FORBIDDEN_ERROR = { error: { code: 'FORBIDDEN', message: 'Forbidden' } };

/** Zod schema for bulk contacts/accounts requests */
const bulkContactAccountSchema = z
  .object({
    action: z.enum(['reassign', 'delete']),
    ids: z.array(z.string().uuid()).min(1, 'ids must contain at least one record'),
    owner_id: z.string().uuid().optional(),
  })
  .refine((data) => data.action !== 'reassign' || data.owner_id !== undefined, {
    message: 'owner_id is required for reassign action',
    path: ['owner_id'],
  });

/** Zod schema for bulk deals requests */
const bulkDealSchema = z
  .object({
    action: z.enum(['reassign', 'delete', 'change_stage']),
    ids: z.array(z.string().uuid()).min(1, 'ids must contain at least one record'),
    owner_id: z.string().uuid().optional(),
    stage: z.string().min(1).optional(),
  })
  .refine((data) => data.action !== 'reassign' || data.owner_id !== undefined, {
    message: 'owner_id is required for reassign action',
    path: ['owner_id'],
  })
  .refine((data) => data.action !== 'change_stage' || data.stage !== undefined, {
    message: 'stage is required for change_stage action',
    path: ['stage'],
  });

/**
 * POST /api/contacts/bulk
 * Bulk reassign or delete contacts.
 */
export async function bulkContactsHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkContactAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role };
  const result = await bulkContacts(parsed.data, actor);

  if ('forbidden' in result) {
    res.status(403).json(FORBIDDEN_ERROR);
    return;
  }

  res.json(result);
}

/**
 * POST /api/accounts/bulk
 * Bulk reassign or delete accounts.
 */
export async function bulkAccountsHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkContactAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role };
  const result = await bulkAccounts(parsed.data, actor);

  if ('forbidden' in result) {
    res.status(403).json(FORBIDDEN_ERROR);
    return;
  }

  res.json(result);
}

/**
 * POST /api/deals/bulk
 * Bulk reassign, delete, or change stage on deals.
 */
export async function bulkDealsHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkDealSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name, role: req.user!.role };
  const result = await bulkDeals(parsed.data, actor);

  if ('forbidden' in result) {
    res.status(403).json(FORBIDDEN_ERROR);
    return;
  }

  if ('invalidStage' in result) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: `Invalid stage: "${parsed.data.stage}"` },
    });
    return;
  }

  res.json(result);
}
