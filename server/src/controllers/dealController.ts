/**
 * Deal controller — request/response shaping for deal endpoints.
 * No business logic here; all DB access goes through dealService.
 */

import type { Request, Response } from 'express';
import {
  createDealSchema,
  updateDealSchema,
  CLOSED_PIPELINE_STAGES,
} from '@minicrm/shared/schemas/dealSchema.js';
import {
  createDeal,
  findDealById,
  listDeals,
  updateDeal,
  deleteDeal,
  listDealContacts,
  linkContactToDeal,
  unlinkContactFromDeal,
  exportDealsForCsv,
  DEAL_SORT_COLUMNS,
} from '../services/dealService.js';
import { findContactById } from '../services/contactService.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import { findUserById } from '../services/userService.js';
import { queueAssignmentNotification } from '../services/notificationService.js';
import { serializeToCsv, csvFilename } from '../utils/csvUtils.js';
import { z } from 'zod';

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
 * Lists deals with optional filters and pagination:
 *   ?owner=me      — scope to the authenticated user's deals
 *   ?account=<uuid> — filter by account UUID
 *   ?sort=<col>    — sort column (created_at|name|close_date|value)
 *   ?dir=asc|desc  — sort direction
 *   ?page=<n>      — 1-based page number (default 1)
 *   ?limit=<n>     — records per page (default 50, max 100)
 */
export async function listDealsHandler(req: Request, res: Response): Promise<void> {
  const ownerId = req.query.owner === 'me' ? req.user!.id : undefined;
  const accountId =
    typeof req.query.account === 'string' && req.query.account ? req.query.account : undefined;

  const paginationParsed = paginationParamsSchema.safeParse({
    page: req.query.page,
    limit: req.query.limit,
  });
  if (!paginationParsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: paginationParsed.error.errors[0].message },
    });
    return;
  }

  const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : '';
  const sort = (DEAL_SORT_COLUMNS as readonly string[]).includes(sortRaw)
    ? (sortRaw as (typeof DEAL_SORT_COLUMNS)[number])
    : undefined;
  const dir = req.query.dir === 'desc' ? ('DESC' as const) : ('ASC' as const);

  const result = await listDeals({ ownerId, accountId, sort, dir, ...paginationParsed.data });
  res.status(200).json(result);
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

  // MINCRM-121: reject a future close_date even when stage is not in the payload —
  // use existing.stage to determine if the deal is already in a terminal stage.
  if (parsed.data.close_date) {
    const effectiveStage = parsed.data.stage ?? existing.stage;
    const today = new Date().toISOString().split('T')[0];
    if (
      (CLOSED_PIPELINE_STAGES as readonly string[]).includes(effectiveStage) &&
      parsed.data.close_date > today
    ) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Close date cannot be in the future' },
      });
      return;
    }
  }

  const deal = await updateDeal(id, parsed.data);
  if (!deal) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }
  res.status(200).json({ deal });

  // Fire-and-forget: notify the new owner when the deal is reassigned. (MINCRM-162)
  if (parsed.data.owner_id !== undefined && parsed.data.owner_id !== existing.owner_id) {
    void (async () => {
      try {
        const newOwner = await findUserById(parsed.data.owner_id!);
        if (newOwner && newOwner.notify_assignments) {
          queueAssignmentNotification(newOwner.id, newOwner.email, newOwner.name, {
            recordType: 'deal',
            recordName: deal.name,
            recordPath: `/deals/${deal.id}`,
            assignedByName: req.user!.name,
          });
        }
      } catch {
        // Swallow — notification failure must not affect the response
      }
    })();
  }
}

/**
 * POST /api/deals/:id/contacts/:contactId
 * Links a contact to a deal.
 * Returns the updated contacts list for the deal.
 */
export async function linkContactHandler(req: Request, res: Response): Promise<void> {
  const dealId = String(req.params['id']);
  const contactId = String(req.params['contactId']);

  const deal = await findDealById(dealId);
  if (!deal) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  if (deal.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_ERROR);
    return;
  }

  const contact = await findContactById(contactId);
  if (!contact) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  await linkContactToDeal(dealId, contactId);
  const contacts = await listDealContacts(dealId);
  res.status(200).json({ contacts });
}

/**
 * DELETE /api/deals/:id/contacts/:contactId
 * Unlinks a contact from a deal without deleting either record.
 * Returns the updated contacts list for the deal.
 */
export async function unlinkContactHandler(req: Request, res: Response): Promise<void> {
  const dealId = String(req.params['id']);
  const contactId = String(req.params['contactId']);

  const deal = await findDealById(dealId);
  if (!deal) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  if (deal.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_ERROR);
    return;
  }

  await unlinkContactFromDeal(dealId, contactId);
  const contacts = await listDealContacts(dealId);
  res.status(200).json({ contacts });
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

/**
 * GET /api/deals/export
 * Streams all matching deals as a UTF-8 CSV file.
 *
 * Query params mirror the list endpoint (owner, account) except pagination/sort.
 * Reps automatically get their own deals; admins may pass ?all=true to export all.
 * (MINCRM-166)
 */
export async function exportDealsHandler(req: Request, res: Response): Promise<void> {
  const isAdmin = req.user!.role === 'admin';
  const exportAll = req.query.all === 'true';

  const ownerId = !isAdmin || !exportAll ? req.user!.id : undefined;

  let accountId: string | undefined;
  if (typeof req.query.account === 'string' && req.query.account.length > 0) {
    const parsed = z.string().uuid().safeParse(req.query.account);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'account must be a valid UUID' },
      });
      return;
    }
    accountId = parsed.data;
  }

  const rows = await exportDealsForCsv({ ownerId, accountId });

  const headers = [
    'Name',
    'Stage',
    'Value',
    'Close Date',
    'Loss Reason',
    'Account',
    'Contacts',
    'Owner',
    'Created',
    'Updated',
  ];

  const csvRows = rows.map((r) => ({
    Name: r.name,
    Stage: r.stage,
    Value: r.value,
    'Close Date': r.close_date,
    'Loss Reason': r.loss_reason,
    Account: r.account_name,
    Contacts: r.contact_names,
    Owner: r.owner_name,
    Created: r.created_at,
    Updated: r.updated_at,
  }));

  const csv = serializeToCsv(headers, csvRows);
  const filename = csvFilename('deals');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}
