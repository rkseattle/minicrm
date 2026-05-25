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
  linkContactToDeal,
  unlinkContactFromDeal,
  exportDealsForCsv,
  DEAL_SORT_COLUMNS,
} from '../services/dealService.js';
import { getStageNames, getTerminalStageNames } from '../services/pipelineStageService.js';
import { findContactById } from '../services/contactService.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import { findUserById } from '../services/userService.js';
import { queueAssignmentNotification } from '../services/notificationService.js';
import { serializeToCsv, csvFilename } from '../utils/csvUtils.js';
import { listDefinitions, getValuesForRecord } from '../services/customFieldService.js';
import { z } from 'zod';

const FORBIDDEN_OWNERSHIP_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message:
      'You can only edit or delete records you own. Contact an admin to make changes to records owned by others.',
  },
};

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

  // Validate stage against live pipeline_stages table for the specified pipeline (MINCRM-180, MINCRM-397)
  const validStages = await getStageNames(parsed.data.pipeline_id);
  if (!validStages.includes(parsed.data.stage)) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: `Invalid stage: "${parsed.data.stage}"` },
    });
    return;
  }

  const deal = await createDeal(
    { ...parsed.data, owner_id: req.user!.id },
    { id: req.user!.id, name: req.user!.name },
  );
  res.status(201).json({ deal });
}

/**
 * GET /api/deals
 * Lists deals with optional filters and pagination:
 *   ?owner=me         — scope to the authenticated user's deals
 *   ?account=<uuid>   — filter by account UUID
 *   ?hideClosed=true  — exclude Closed Won and Closed Lost deals (MINCRM-176)
 *   ?sort=<col>       — sort column (created_at|name|close_date|value)
 *   ?dir=asc|desc     — sort direction
 *   ?page=<n>         — 1-based page number (default 1)
 *   ?limit=<n>        — records per page (default 50, max 100)
 */
export async function listDealsHandler(req: Request, res: Response): Promise<void> {
  const ownerId = req.query.owner === 'me' ? req.user!.id : undefined;
  const accountId =
    typeof req.query.account === 'string' && req.query.account ? req.query.account : undefined;
  const excludeClosedStages = req.query.hideClosed === 'true';

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

  // Tag filter (MINCRM-186): ?tags=uuid,uuid — comma-separated tag IDs (any-match)
  const tagIds =
    typeof req.query.tags === 'string' && req.query.tags.trim().length > 0
      ? req.query.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

  // Optional ?pipelineId= filters the board to a specific pipeline (MINCRM-397)
  const pipelineId =
    typeof req.query['pipelineId'] === 'string' && req.query['pipelineId'].length > 0
      ? req.query['pipelineId']
      : undefined;

  const result = await listDeals({
    ownerId,
    accountId,
    excludeClosedStages,
    pipelineId,
    sort,
    dir,
    tagIds,
    ...paginationParsed.data,
  });
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
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  // Validate stage against live pipeline_stages for this deal's pipeline (MINCRM-180, MINCRM-397)
  if (parsed.data.stage !== undefined) {
    const validStages = await getStageNames(existing.pipeline_id);
    if (!validStages.includes(parsed.data.stage)) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: `Invalid stage: "${parsed.data.stage}"` },
      });
      return;
    }
  }

  // MINCRM-121: reject a future close_date even when stage is not in the payload —
  // use existing.stage to determine if the deal is already in a terminal stage.
  // Use live terminal stage list so custom terminal stages are respected (MINCRM-180, MINCRM-397).
  if (parsed.data.close_date) {
    const effectiveStage = parsed.data.stage ?? existing.stage;
    const today = new Date().toISOString().split('T')[0];
    const terminalStages = await getTerminalStageNames(existing.pipeline_id);
    if (terminalStages.includes(effectiveStage) && parsed.data.close_date > today) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Close date cannot be in the future' },
      });
      return;
    }
  }

  let deal;
  try {
    deal = await updateDeal(id, parsed.data, { id: req.user!.id, name: req.user!.name }, existing);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'OPTIMISTIC_LOCK_CONFLICT') {
      // Include current server state so the client can render a three-way merge without a second round-trip (MINCRM-351)
      const current = await findDealById(id);
      res.status(409).json({ error: { code, message: (err as Error).message, current } });
      return;
    }
    throw err;
  }
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
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
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
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
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
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  await deleteDeal(id, { id: req.user!.id, name: req.user!.name }, existing.name);
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

  // Custom field columns — fetch definitions and values in application code (MINCRM-276)
  const customDefs = await listDefinitions('deal');
  const recordIds = rows.map((r) => r.id);
  const valuesByRecord = new Map<string, Map<string, string | null>>();
  await Promise.all(
    recordIds.map(async (recordId) => {
      const vals = await getValuesForRecord(recordId);
      const byDef = new Map<string, string | null>();
      for (const v of vals) {
        byDef.set(v.definition_id, v.value);
      }
      valuesByRecord.set(recordId, byDef);
    }),
  );

  const headers = [
    'Name',
    'Stage',
    'Value',
    'Currency',
    'Close Date',
    'Loss Reason',
    'Account',
    'Contacts',
    'Owner',
    'Created',
    'Updated',
    ...customDefs.map((d) => d.name),
  ];

  const csvRows = rows.map((r) => {
    const base: Record<string, string | number | Date | null | undefined> = {
      Name: r.name,
      Stage: r.stage,
      Value: r.value,
      Currency: r.currency,
      'Close Date': r.close_date,
      'Loss Reason': r.loss_reason,
      Account: r.account_name,
      Contacts: r.contact_names,
      Owner: r.owner_name,
      Created: r.created_at,
      Updated: r.updated_at,
    };
    const recordVals = valuesByRecord.get(r.id);
    for (const def of customDefs) {
      base[def.name] = recordVals?.get(def.id) ?? '';
    }
    return base;
  });

  const csv = serializeToCsv(headers, csvRows);
  const filename = csvFilename('deals');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}
