/**
 * Email message controller — request/response shaping for the synced-mail endpoints.
 * No business logic here; all DB access goes through emailMessageService.
 */

import type { Request, Response } from 'express';

import {
  recordMessagesParamsSchema,
  type EmailLinkRecordType,
} from '@minicrm/shared/schemas/emailMessageSchema.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';

import {
  findLinkedRecordOwner,
  listMessagesForRecord,
  listUnmatchedMessages,
} from '../services/emailMessageService.js';
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
