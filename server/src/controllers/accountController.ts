/**
 * Account controller — request/response shaping for account endpoints.
 * No business logic here; all DB access goes through accountService.
 */

import type { Request, Response } from 'express';
import { createAccountSchema, updateAccountSchema } from '@minicrm/shared/schemas/accountSchema.js';
import {
  createAccount,
  findAccountById,
  listAccounts,
  updateAccount,
  deleteAccount,
  exportAccountsForCsv,
  ACCOUNT_SORT_COLUMNS,
} from '../services/accountService.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import { findUserById } from '../services/userService.js';
import { queueAssignmentNotification } from '../services/notificationService.js';
import { serializeToCsv, csvFilename } from '../utils/csvUtils.js';

const FORBIDDEN_ERROR = { error: { code: 'FORBIDDEN', message: 'Forbidden' } };

/**
 * POST /api/accounts
 * Creates a new account owned by the authenticated user.
 */
export async function createAccountHandler(req: Request, res: Response): Promise<void> {
  const parsed = createAccountSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const account = await createAccount({ ...parsed.data, owner_id: req.user!.id });
  res.status(201).json({ account });
}

/**
 * GET /api/accounts
 * Lists accounts with optional filters and pagination:
 *   ?owner=me        — scope to the authenticated user's accounts
 *   ?search=<text>   — case-insensitive substring match on account name
 *   ?industry=<text> — case-insensitive match on industry field
 *   ?sort=<col>      — sort column (created_at|name)
 *   ?dir=asc|desc    — sort direction
 *   ?page=<n>        — 1-based page number (default 1)
 *   ?limit=<n>       — records per page (default 50, max 100)
 */
export async function listAccountsHandler(req: Request, res: Response): Promise<void> {
  const ownerId = req.query.owner === 'me' ? req.user!.id : undefined;

  const search =
    typeof req.query.search === 'string' && req.query.search.trim().length > 0
      ? req.query.search.trim()
      : undefined;

  const industry =
    typeof req.query.industry === 'string' && req.query.industry.trim().length > 0
      ? req.query.industry.trim()
      : undefined;

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
  const sort = (ACCOUNT_SORT_COLUMNS as readonly string[]).includes(sortRaw)
    ? (sortRaw as (typeof ACCOUNT_SORT_COLUMNS)[number])
    : undefined;
  const dir = req.query.dir === 'desc' ? ('DESC' as const) : ('ASC' as const);

  const result = await listAccounts({
    ownerId,
    search,
    industry,
    sort,
    dir,
    ...paginationParsed.data,
  });
  res.status(200).json(result);
}

/**
 * GET /api/accounts/:id
 * Returns a single account by ID.
 */
export async function getAccountHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const account = await findAccountById(id);

  if (!account) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
    return;
  }

  res.status(200).json({ account });
}

/**
 * PATCH /api/accounts/:id
 * Updates one or more fields of an existing account.
 * Reps may only update accounts they own; admins may update any account.
 */
export async function updateAccountHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateAccountSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const id = String(req.params['id']);
  const existing = await findAccountById(id);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_ERROR);
    return;
  }

  const account = await updateAccount(id, parsed.data);
  res.status(200).json({ account });

  // Fire-and-forget: notify the new owner when the account is reassigned. (MINCRM-162)
  if (account && parsed.data.owner_id !== undefined && parsed.data.owner_id !== existing.owner_id) {
    void (async () => {
      try {
        const newOwner = await findUserById(parsed.data.owner_id!);
        if (newOwner && newOwner.notify_assignments) {
          queueAssignmentNotification(newOwner.id, newOwner.email, newOwner.name, {
            recordType: 'account',
            recordName: account.name,
            recordPath: `/accounts/${account.id}`,
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
 * GET /api/accounts/export
 * Streams all matching accounts as a UTF-8 CSV file.
 *
 * Query params mirror the list endpoint (owner, search, industry) except
 * pagination/sort — all matching rows are exported.
 * Reps automatically get their own accounts; admins may pass ?all=true to export all.
 * (MINCRM-165)
 */
export async function exportAccountsHandler(req: Request, res: Response): Promise<void> {
  const isAdmin = req.user!.role === 'admin';
  const exportAll = req.query.all === 'true';

  const ownerId = !isAdmin || !exportAll ? req.user!.id : undefined;

  const search =
    typeof req.query.search === 'string' && req.query.search.trim().length > 0
      ? req.query.search.trim()
      : undefined;

  const industry =
    typeof req.query.industry === 'string' && req.query.industry.trim().length > 0
      ? req.query.industry.trim()
      : undefined;

  const rows = await exportAccountsForCsv({ ownerId, search, industry });

  const headers = [
    'Name',
    'Industry',
    'Website',
    'Employees',
    'Revenue Range',
    'Owner',
    'Contacts',
    'Deals',
    'Created',
    'Updated',
  ];

  const csvRows = rows.map((r) => ({
    Name: r.name,
    Industry: r.industry,
    Website: r.website,
    Employees: r.employee_range,
    'Revenue Range': r.revenue_range,
    Owner: r.owner_name,
    Contacts: r.contact_count,
    Deals: r.deal_count,
    Created: r.created_at,
    Updated: r.updated_at,
  }));

  const csv = serializeToCsv(headers, csvRows);
  const filename = csvFilename('accounts');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

/**
 * DELETE /api/accounts/:id
 * Deletes an account and unlinks associated contacts. Returns 204 No Content on success.
 * Reps may only delete accounts they own; admins may delete any account.
 */
export async function deleteAccountHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const existing = await findAccountById(id);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_ERROR);
    return;
  }

  await deleteAccount(id);
  res.status(204).send();
}
