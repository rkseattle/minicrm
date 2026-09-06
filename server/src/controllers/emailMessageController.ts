/**
 * Email message controller — request/response shaping for the synced-mail endpoints.
 * No business logic here; all DB access goes through emailMessageService.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';

import {
  createEmailMessageLinkSchema,
  recordMessagesParamsSchema,
  type EmailLinkRecordType,
} from '@minicrm/shared/schemas/emailMessageSchema.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';

import {
  createManualLink,
  deleteMessageLink,
  findLinkedRecordOwner,
  findLinkForUser,
  listMessagesForRecord,
  listUnmatchedMessages,
} from '../services/emailMessageService.js';
import { userCapabilities } from '../services/roleService.js';
import { canAccessOwnedRecord } from '../services/visibilityService.js';
import { errorBody } from '../utils/errorBody.js';

/**
 * Whether the caller may see the record a message is filed against.
 *
 * Contact, account and deal have configurable visibility policies. Leads have none: reads
 * are open to any authenticated user, and only writes check owner-or-admin. This endpoint
 * is deliberately stricter than that, applying the write rule to a read — correspondence
 * is more sensitive than the lead record it concerns, and a lead's mail should not be
 * wider-open than a contact's under a private policy.
 */
async function canReadLinkedRecord(
  recordType: EmailLinkRecordType,
  ownerId: string,
  user: { id: string; role: string },
): Promise<boolean> {
  if (recordType === 'lead') return ownerId === user.id || user.role === 'admin';
  return canAccessOwnedRecord(recordType, ownerId, user.id, user.role);
}

/**
 * GET /api/v1/email-messages?record_type=&record_id=
 * Returns the caller's own synced mail linked to one record, grouped into threads.
 */
export async function listRecordMessagesHandler(req: Request, res: Response): Promise<void> {
  const parsed = recordMessagesParamsSchema.safeParse({
    record_type: req.query.record_type,
    record_id: req.query.record_id,
    page: req.query.page,
    limit: req.query.limit,
  });
  if (!parsed.success) {
    res
      .status(400)
      .json(errorBody('VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid request'));
    return;
  }

  const { record_type, record_id, page, limit } = parsed.data;

  const ownerId = await findLinkedRecordOwner(record_type, record_id);
  if (ownerId === null) {
    res.status(404).json(errorBody('NOT_FOUND', 'No such record'));
    return;
  }

  const canRead = await canReadLinkedRecord(record_type, ownerId, {
    id: req.user!.id,
    role: req.user!.role,
  });
  if (!canRead) {
    res.status(403).json(errorBody('FORBIDDEN', 'You do not have visibility into this record.'));
    return;
  }

  res
    .status(200)
    .json(await listMessagesForRecord(record_type, record_id, req.user!.id, page, limit));
}

/**
 * GET /api/v1/email-messages/unmatched
 * Returns the caller's synced mail that no record claims yet.
 */
export async function listUnmatchedMessagesHandler(req: Request, res: Response): Promise<void> {
  const parsed = paginationParamsSchema.safeParse({
    page: req.query.page,
    limit: req.query.limit,
  });
  if (!parsed.success) {
    res
      .status(400)
      .json(errorBody('VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid request'));
    return;
  }

  const { page, limit } = parsed.data;
  res.status(200).json(await listUnmatchedMessages(req.user!.id, page, limit));
}

/**
 * The capability that governs editing each record type.
 *
 * Filing mail against a record is a CRM write, so it takes the record's own edit
 * capability on top of the router's mailbox gate — the way bulk contact edits stack
 * BulkOperations with ContactsEdit. Accounts and leads have no capability of their own in
 * the enum and are gated by `contacts:edit` everywhere they are written
 * (`routes/accounts.ts`, `routes/leads.ts`); following that here rather than exempting
 * them is what stops a custom role without `contacts:edit` — which migration 170 still
 * grants `connected_accounts:manage` — from filing mail it cannot file against a contact.
 */
const EDIT_CAPABILITY: Readonly<Record<EmailLinkRecordType, Capability>> = {
  contact: Capability.ContactsEdit,
  deal: Capability.DealsEdit,
  account: Capability.ContactsEdit,
  lead: Capability.ContactsEdit,
};

/**
 * Whether the caller may file mail against this record: capability, then visibility.
 *
 * @param capabilities - The set requireCapability already resolved for this request.
 */
async function canWriteLinkToRecord(
  recordType: EmailLinkRecordType,
  ownerId: string,
  user: { id: string; role: string },
  capabilities: ReadonlySet<Capability> | undefined,
): Promise<boolean> {
  const held = capabilities ?? (await userCapabilities(user.id));
  if (!held.has(EDIT_CAPABILITY[recordType])) return false;
  return canReadLinkedRecord(recordType, ownerId, user);
}

/**
 * POST /api/v1/email-messages/:id/links
 * Files one of the caller's own messages against a record.
 */
export async function createLinkHandler(req: Request, res: Response): Promise<void> {
  const messageId = z.string().uuid().safeParse(req.params['id']);
  if (!messageId.success) {
    res.status(400).json(errorBody('VALIDATION_ERROR', 'Message id must be a UUID'));
    return;
  }

  const parsed = createEmailMessageLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json(errorBody('VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid request'));
    return;
  }

  const { record_type, record_id } = parsed.data;

  const ownerId = await findLinkedRecordOwner(record_type, record_id);
  if (ownerId === null) {
    res.status(404).json(errorBody('NOT_FOUND', 'No such record'));
    return;
  }

  const allowed = await canWriteLinkToRecord(
    record_type,
    ownerId,
    { id: req.user!.id, role: req.user!.role },
    res.locals.capabilities,
  );
  if (!allowed) {
    res.status(403).json(errorBody('FORBIDDEN', 'You may not file mail against this record.'));
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    const link = await createManualLink(
      messageId.data,
      record_type,
      record_id,
      req.user!.id,
      actor,
    );
    res.status(201).json({ link });
  } catch (err) {
    const code = (err as { code?: string }).code;
    // A message outside the caller's mailboxes is reported as absent rather than
    // forbidden: whether it exists is not theirs to learn.
    if (code === 'EMAIL_MESSAGE_NOT_FOUND') {
      res.status(404).json(errorBody('NOT_FOUND', 'No such message'));
      return;
    }
    if (code === '23505') {
      res.status(409).json(errorBody('LINK_EXISTS', 'That record is already linked'));
      return;
    }
    throw err;
  }
}

/**
 * DELETE /api/v1/email-messages/:id/links/:linkId
 * Removes a link from one of the caller's own messages.
 */
export async function deleteLinkHandler(req: Request, res: Response): Promise<void> {
  const messageId = z.string().uuid().safeParse(req.params['id']);
  const linkId = z.string().uuid().safeParse(req.params['linkId']);
  if (!messageId.success || !linkId.success) {
    res.status(400).json(errorBody('VALIDATION_ERROR', 'Message id and link id must be UUIDs'));
    return;
  }

  const existing = await findLinkForUser(messageId.data, linkId.data, req.user!.id);
  if (!existing) {
    res.status(404).json(errorBody('NOT_FOUND', 'No such link'));
    return;
  }

  const ownerId = await findLinkedRecordOwner(existing.record_type, existing.record_id);
  // A link whose record is already gone cannot be gated on that record, and leaving it
  // would be an orphan nothing can remove.
  if (ownerId !== null) {
    const allowed = await canWriteLinkToRecord(
      existing.record_type,
      ownerId,
      { id: req.user!.id, role: req.user!.role },
      res.locals.capabilities,
    );
    if (!allowed) {
      res.status(403).json(errorBody('FORBIDDEN', 'You may not unfile mail from this record.'));
      return;
    }
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const removed = await deleteMessageLink(messageId.data, linkId.data, req.user!.id, actor);
  if (!removed) {
    res.status(404).json(errorBody('NOT_FOUND', 'No such link'));
    return;
  }

  res.status(204).send();
}
