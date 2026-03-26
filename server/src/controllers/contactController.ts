/**
 * Contact controller — request/response shaping for contact endpoints.
 * No business logic here; all DB access goes through contactService.
 */

import type { Request, Response } from 'express';
import { createContactSchema, updateContactSchema } from '@minicrm/shared/schemas/contactSchema.js';
import {
  createContact,
  findContactById,
  listContacts,
  updateContact,
  deleteContact,
} from '../services/contactService.js';

const FORBIDDEN_ERROR = { error: { code: 'FORBIDDEN', message: 'Forbidden' } };

/**
 * POST /api/contacts
 * Creates a new contact owned by the authenticated user.
 */
export async function createContactHandler(req: Request, res: Response): Promise<void> {
  const parsed = createContactSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const contact = await createContact({ ...parsed.data, owner_id: req.user!.id });
  res.status(201).json({ contact });
}

/**
 * GET /api/contacts
 * Lists contacts. Pass ?owner=me to scope to the authenticated user's contacts.
 */
export async function listContactsHandler(req: Request, res: Response): Promise<void> {
  const ownerId = req.query.owner === 'me' ? req.user!.id : undefined;
  const contacts = await listContacts({ ownerId });
  res.status(200).json({ contacts });
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
