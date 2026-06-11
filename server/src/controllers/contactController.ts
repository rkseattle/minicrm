/**
 * Contact controller — request/response shaping for contact endpoints.
 * No business logic here; all DB access goes through contactService.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { hasCapability, Capability } from '../utils/userUtils.js';
import { createContactSchema, updateContactSchema } from '@minicrm/shared/schemas/contactSchema.js';
import {
  createContact,
  findContactByEmail,
  findContactById,
  listContacts,
  updateContact,
  deleteContact,
  exportContactsForCsv,
  mergeContacts,
  CONTACT_SORT_COLUMNS,
  listContactAddresses,
  addContactAddress,
  updateContactAddress,
  removeContactAddress,
  setDefaultContactAddress,
} from '../services/contactService.js';
import { listContactDeals } from '../services/dealService.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import { findUserById } from '../services/userService.js';
import { queueAssignmentNotification } from '../services/notificationService.js';
import { serializeToCsv, csvFilename } from '../utils/csvUtils.js';
import { sendContactEmail } from '../services/emailService.js';
import { createActivity } from '../services/activityService.js';
import { listDefinitions, getValuesForRecord } from '../services/customFieldService.js';
import logger from '../logger.js';

const FORBIDDEN_OWNERSHIP_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message:
      'You can only edit or delete records you own. Contact an admin to make changes to records owned by others.',
  },
};

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

  let contact;
  try {
    contact = await createContact(
      {
        ...parsed.data,
        account_id: parsed.data.account_id ?? null,
        owner_id: req.user!.id,
      },
      { id: req.user!.id, name: req.user!.name },
    );
  } catch (err) {
    // DB unique constraint fired (TOCTOU race or force=true on an existing email). (MINCRM-247)
    if ((err as { code?: string }).code === 'DUPLICATE_EMAIL') {
      res.status(409).json({
        error: { code: 'DUPLICATE_EMAIL', message: 'A contact with this email already exists' },
      });
      return;
    }
    throw err;
  }
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

  // Tag filter (MINCRM-186): ?tags=uuid,uuid — comma-separated tag IDs (any-match)
  const tagIds =
    typeof req.query.tags === 'string' && req.query.tags.trim().length > 0
      ? req.query.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

  const result = await listContacts({
    ownerId,
    accountId,
    search,
    accountSearch,
    sort,
    dir,
    tagIds,
    ...paginationParsed.data,
    requestingUser: { id: req.user!.id, role: req.user!.role },
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

  if (existing.owner_id !== req.user!.id && !hasCapability(req.user!.role, Capability.editOthers)) {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  let contact;
  try {
    contact = await updateContact(
      id,
      parsed.data,
      { id: req.user!.id, name: req.user!.name },
      existing,
      { id: req.user!.id, role: req.user!.role },
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'OPTIMISTIC_LOCK_CONFLICT') {
      // Include current server state so the client can render a three-way merge without a second round-trip (MINCRM-351)
      const current = await findContactById(id);
      res.status(409).json({ error: { code, message: (err as Error).message, current } });
      return;
    }
    if (code === 'REASSIGNMENT_NOT_PERMITTED') {
      res.status(403).json({ error: { code, message: (err as Error).message } });
      return;
    }
    throw err;
  }
  res.status(200).json({ contact });

  // Fire-and-forget: notify the new owner when the contact is reassigned. (MINCRM-162)
  if (contact && parsed.data.owner_id !== undefined && parsed.data.owner_id !== existing.owner_id) {
    void (async () => {
      try {
        const newOwner = await findUserById(parsed.data.owner_id!);
        if (newOwner && newOwner.notify_assignments) {
          queueAssignmentNotification(newOwner.id, newOwner.email, newOwner.name, {
            recordType: 'contact',
            recordName: `${contact.first_name} ${contact.last_name}`,
            recordPath: `/contacts/${contact.id}`,
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
 * GET /api/contacts/export
 * Streams all matching contacts as a UTF-8 CSV file.
 *
 * Query params mirror the list endpoint (owner, search, accountSearch, account)
 * except pagination/sort — all matching rows are exported.
 * Reps automatically get their own contacts; admins may omit ?owner to get all.
 * Pass ?all=true to bypass the rep-scoped default and export all visible records
 * (admins only; reps always export their own).
 * (MINCRM-164)
 */
export async function exportContactsHandler(req: Request, res: Response): Promise<void> {
  const canReadAll = hasCapability(req.user!.role, Capability.orgWideRead);
  const exportAll = req.query.all === 'true';

  // Non-admin/viewer roles always get their own contacts; org-wide readers get all unless scoped
  const ownerId = !canReadAll || !exportAll ? req.user!.id : undefined;

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

  const rows = await exportContactsForCsv({ ownerId, accountId, search, accountSearch });

  // Custom field columns — fetch definitions and values in application code (MINCRM-276)
  const customDefs = await listDefinitions('contact');
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
    'First Name',
    'Last Name',
    'Email',
    'Phone',
    'Title',
    'Department',
    'Address Line 1',
    'Address Line 2',
    'City',
    'State/Region',
    'Postal Code',
    'Country',
    'LinkedIn URL',
    'Twitter/X URL',
    'Account',
    'Owner',
    'Created',
    'Updated',
    ...customDefs.map((d) => d.name),
  ];

  const csvRows = rows.map((r) => {
    const base: Record<string, string | number | Date | null | undefined> = {
      'First Name': r.first_name,
      'Last Name': r.last_name,
      Email: r.email,
      Phone: r.phone,
      Title: r.title,
      Department: r.department,
      'Address Line 1': r.address_line1,
      'Address Line 2': r.address_line2,
      City: r.city,
      'State/Region': r.state_region,
      'Postal Code': r.postal_code,
      Country: r.country,
      'LinkedIn URL': r.linkedin_url,
      'Twitter/X URL': r.twitter_x_url,
      Account: r.account_name,
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
  const filename = csvFilename('contacts');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
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

  if (existing.owner_id !== req.user!.id && !hasCapability(req.user!.role, Capability.editOthers)) {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  await deleteContact(
    id,
    { id: req.user!.id, name: req.user!.name },
    `${existing.first_name} ${existing.last_name}`,
  );
  res.status(204).send();
}

/**
 * POST /api/contacts/:id/merge
 * Merges the contact identified by :id (the winner) with a specified loser contact.
 * Only admins and the winner's owner may perform a merge.
 * Body: { loserId: string, fieldChoices: Record<field, 'winner'|'loser'> }
 * (MINCRM-187)
 */
export async function mergeContactHandler(req: Request, res: Response): Promise<void> {
  const winnerId = String(req.params['id']);

  const winner = await findContactById(winnerId);
  if (!winner) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  if (winner.owner_id !== req.user!.id && !hasCapability(req.user!.role, Capability.editOthers)) {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  const { loserId, fieldChoices } = req.body as {
    loserId?: string;
    fieldChoices?: Record<string, string>;
  };

  if (!loserId || typeof loserId !== 'string') {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'loserId is required' },
    });
    return;
  }

  const loser = await findContactById(loserId);
  if (!loser) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Loser contact not found' } });
    return;
  }

  if (winnerId === loserId) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Cannot merge a contact with itself' },
    });
    return;
  }

  const merged = await mergeContacts(
    {
      winnerId,
      loserId,
      fieldChoices: (fieldChoices ?? {}) as Parameters<typeof mergeContacts>[0]['fieldChoices'],
    },
    { id: req.user!.id, name: req.user!.name },
  );
  res.status(200).json({ contact: merged });
}

// ── Contact Address Handlers ───────────────────────────────────────────────────

/** Zod schema for creating or updating a contact address */
const contactAddressSchema = z.object({
  label: z.string().trim().max(50).optional(),
  address_line1: z.string().trim().max(255).optional(),
  address_line2: z.string().trim().max(255).optional(),
  city: z.string().trim().max(100).optional(),
  state_region: z.string().trim().max(100).optional(),
  postal_code: z.string().trim().max(20).optional(),
  country: z.string().trim().max(100).optional(),
  is_default: z.boolean().optional(),
});

/**
 * GET /api/contacts/:id/addresses
 * Returns all addresses for the given contact.
 */
export async function listContactAddressesHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const contact = await findContactById(id);
  if (!contact) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }
  const addresses = await listContactAddresses(id);
  res.status(200).json({ addresses });
}

/**
 * POST /api/contacts/:id/addresses
 * Adds a new address to the given contact.
 */
export async function addContactAddressHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const parsed = contactAddressSchema.safeParse(req.body);
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

  const address = await addContactAddress(id, parsed.data);
  res.status(201).json({ address });
}

/**
 * PATCH /api/contacts/:id/addresses/:addressId
 * Updates a contact address.
 */
export async function updateContactAddressHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const addressId = String(req.params['addressId']);
  const parsed = contactAddressSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid input',
      },
    });
    return;
  }

  const address = await updateContactAddress(addressId, id, parsed.data);
  if (!address) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Address not found' } });
    return;
  }
  res.status(200).json({ address });
}

/**
 * DELETE /api/contacts/:id/addresses/:addressId
 * Removes a contact address.
 */
export async function deleteContactAddressHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const addressId = String(req.params['addressId']);
  const deleted = await removeContactAddress(addressId, id);
  if (!deleted) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Address not found' } });
    return;
  }
  res.status(204).send();
}

/**
 * POST /api/contacts/:id/addresses/:addressId/set-default
 * Sets the given address as the default for this contact.
 */
export async function setDefaultContactAddressHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const addressId = String(req.params['addressId']);
  const address = await setDefaultContactAddress(addressId, id);
  if (!address) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Address not found' } });
    return;
  }
  res.status(200).json({ address });
}

/** Zod schema for the send-email request body (MINCRM-275) */
const sendContactEmailSchema = z.object({
  subject: z
    .string({ required_error: 'Subject is required' })
    .min(1, 'Subject is required')
    .max(255, 'Subject must be 255 characters or fewer')
    .trim(),
  body: z.string({ required_error: 'Body is required' }).min(1, 'Body is required').trim(),
  deal_id: z.string().uuid('deal_id must be a valid UUID').optional(),
});

/**
 * POST /api/contacts/:id/send-email
 * Sends a composed email to the contact and logs an Email activity. (MINCRM-275)
 */
export async function sendContactEmailHandler(req: Request, res: Response): Promise<void> {
  const contactId = String(req.params['id']);

  const contact = await findContactById(contactId);
  if (!contact) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  if (!contact.email) {
    res.status(400).json({
      error: { code: 'NO_EMAIL', message: 'This contact does not have an email address' },
    });
    return;
  }

  const parsed = sendContactEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const { subject, body, deal_id } = parsed.data;
  const actor = req.user!;

  const sendResult = await sendContactEmail(contact.email, subject, body, actor.name);

  let activityId: string | null = null;
  try {
    const activity = await createActivity({
      type: 'Email',
      direction: 'Outbound',
      subject,
      notes: body,
      contact_id: contactId,
      deal_id: deal_id ?? undefined,
      owner_id: actor.id,
    });
    activityId = activity.id;
  } catch (err) {
    logger.error({ err, contactId }, 'sendContactEmailHandler: failed to log Email activity');
  }

  res.status(200).json({ delivered: sendResult.delivered, activityId });
}
