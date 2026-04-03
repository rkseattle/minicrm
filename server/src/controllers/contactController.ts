/**
 * Contact controller — request/response shaping for contact endpoints.
 * No business logic here; all DB access goes through contactService.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { createContactSchema, updateContactSchema } from '@minicrm/shared/schemas/contactSchema.js';
import {
  createContact,
  findContactByEmail,
  findContactById,
  listContacts,
  updateContact,
  deleteContact,
  CONTACT_SORT_COLUMNS,
} from '../services/contactService.js';
import { listContactDeals } from '../services/dealService.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';

const FORBIDDEN_ERROR = { error: { code: 'FORBIDDEN', message: 'Forbidden' } };

/**
 * POST /api/contacts
 * Creates a new contact owned by the authenticated user.
 *
 * If a contact with the same email already exists, returns 409 with the
 * duplicate contact's id, first_name, and last_name unless the request
 * includes ?force=true, which bypasses the duplicate check.
 */
export async function createContactHandler(req: Request, res: Response): Promise<void> {
  const parsed = createContactSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const force = req.query.force === 'true';

  if (!force) {
    // Note: there is a narrow TOCTOU window — two concurrent requests with the
    // same email can both pass this check and both insert. The consequence is a
    // silent duplicate rather than a missed warning, which is acceptable for alpha
    // scope. A unique index + ON CONFLICT would close the gap if needed later.
    const duplicate = await findContactByEmail(parsed.data.email);
    if (duplicate) {
      res.status(409).json({
        error: { code: 'DUPLICATE_EMAIL', message: 'A contact with this email already exists' },
        duplicate: {
          id: duplicate.id,
          first_name: duplicate.first_name,
          last_name: duplicate.last_name,
          email: duplicate.email,
        },
      });
      return;
    }
  }

  const contact = await createContact({
    ...parsed.data,
    account_id: parsed.data.account_id ?? null,
    owner_id: req.user!.id,
  });
  res.status(201).json({ contact });
}

/**
 * GET /api/contacts
 * Lists contacts with optional filters and pagination:
 *   ?owner=me          — scope to the authenticated user's contacts
 *   ?account=<uuid>    — scope to a specific account UUID
 *   ?search=<text>     — case-insensitive substring match on name/email
 *   ?accountSearch=<text> — case-insensitive substring match on linked account name
 *   ?sort=<col>        — sort column (created_at|first_name|last_name|email)
 *   ?dir=asc|desc      — sort direction
 *   ?page=<n>          — 1-based page number (default 1)
 *   ?limit=<n>         — records per page (default 50, max 100)
 */
export async function listContactsHandler(req: Request, res: Response): Promise<void> {
  const ownerId = req.query.owner === 'me' ? req.user!.id : undefined;

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

  const search =
    typeof req.query.search === 'string' && req.query.search.trim().length > 0
      ? req.query.search.trim()
      : undefined;

  const accountSearch =
    typeof req.query.accountSearch === 'string' && req.query.accountSearch.trim().length > 0
      ? req.query.accountSearch.trim()
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
  const sort = (CONTACT_SORT_COLUMNS as readonly string[]).includes(sortRaw)
    ? (sortRaw as (typeof CONTACT_SORT_COLUMNS)[number])
    : undefined;
  const dir = req.query.dir === 'desc' ? ('DESC' as const) : ('ASC' as const);

  const result = await listContacts({
    ownerId,
    accountId,
    search,
    accountSearch,
    sort,
    dir,
    ...paginationParsed.data,
  });
  res.status(200).json(result);
}

/**
 * GET /api/contacts/:id
 * Returns a single contact by ID.
 */
export async function getContactHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const contact = await findContactById(id);

  if (!contact) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  res.status(200).json({ contact });
}

/**
 * PATCH /api/contacts/:id
 * Updates one or more fields of an existing contact.
 * Reps may only update contacts they own; admins may update any contact.
 */
export async function updateContactHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateContactSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const id = String(req.params['id']);
  const existing = await findContactById(id);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_ERROR);
    return;
  }

  const contact = await updateContact(id, parsed.data);
  res.status(200).json({ contact });
}

/**
 * GET /api/contacts/:id/deals
 * Returns all deals linked to a contact via the deal_contacts join table.
 */
export async function listContactDealsHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const contact = await findContactById(id);

  if (!contact) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  const deals = await listContactDeals(id);
  res.status(200).json({ deals });
}

/**
 * DELETE /api/contacts/:id
 * Deletes a contact. Returns 204 No Content on success.
 * Reps may only delete contacts they own; admins may delete any contact.
 */
export async function deleteContactHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const existing = await findContactById(id);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_ERROR);
    return;
  }

  await deleteContact(id);
  res.status(204).send();
}
