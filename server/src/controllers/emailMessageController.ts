/**
 * Email message controller — request/response shaping for the synced-mail endpoints.
 * No business logic here; all DB access goes through emailMessageService.
 */

import type { Request, Response } from 'express';

import {
  createEmailMessageLinkSchema,
  IDEMPOTENCY_KEY_HEADER,
  idempotencyKeySchema,
  recordMessagesParamsSchema,
  EMAIL_LINK_EDIT_CAPABILITY,
  sendEmailSchema,
  threadPrivacySchema,
  type ThreadPrivacyResponse,
  capabilitiesToSendFrom,
  type EmailLinkRecordType,
  type SendErrorCode,
  type SendRequestErrorCode,
} from '@minicrm/shared/schemas/emailMessageSchema.js';
import type { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';

import {
  createManualLink,
  deleteMessageLink,
  findLinkedRecordOwner,
  findMessageForUser,
  findLinkForUser,
  listMessagesForRecord,
  listUnmatchedMessages,
  setThreadPrivacy,
} from '../services/emailMessageService.js';
import {
  EMAIL_ACCOUNT_NOT_FOUND,
  EMAIL_MESSAGE_NOT_FOUND,
  IDEMPOTENCY_KEY_REUSED,
  PROVIDER_SEND_UNSUPPORTED,
  RATE_LIMITED,
  RECONNECT_REQUIRED,
  replaySend,
  requestHashOf,
  SEND_ALREADY_SENT,
  SEND_FAILED,
  SEND_IN_PROGRESS,
  SEND_NOT_CONFIRMED,
  SEND_UNCONFIRMED,
  sendEmail,
  SENT_NOT_RECORDED,
  TEMPLATE_NOT_FOUND,
} from '../services/emailSendService.js';
import { SEND_AUTH_EXPIRED } from '../services/mail/sendOutcome.js';
import { userCapabilities } from '../services/roleService.js';
import { canAccessOwnedRecord } from '../services/visibilityService.js';
import { errorBody } from '../utils/errorBody.js';
import { uuidParams } from '../utils/uuidParams.js';
import { respondValidationError } from '../utils/validationError.js';

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
    respondValidationError(res, parsed.error);
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
    respondValidationError(res, parsed.error);
    return;
  }

  const { page, limit } = parsed.data;
  res.status(200).json(await listUnmatchedMessages(req.user!.id, req.user!.role, page, limit));
}

/**
 * GET /api/v1/email-messages/:id
 * Returns one of the caller's own messages with its bodies. The HTML is unsanitized; the
 * client renders it only through sanitizeEmailHtml.
 */
export async function getMessageHandler(req: Request, res: Response): Promise<void> {
  const [messageId] = uuidParams(req, res, ['id'], 'Message id must be a UUID') ?? [];
  if (!messageId) return;

  // Safe: authenticate runs first on this router and always sets req.user.
  const message = await findMessageForUser(messageId, req.user!.id);
  if (!message) {
    res.status(404).json(errorBody('NOT_FOUND', 'No such message'));
    return;
  }
  res.status(200).json({ message });
}

/**
 * PATCH /api/v1/email-messages/:id/thread-privacy
 * Marks or unmarks the whole thread a message belongs to as private, in the caller's own
 * mailbox. Another user's message answers 404, so a message id never confirms it exists.
 */
export async function setThreadPrivacyHandler(req: Request, res: Response): Promise<void> {
  const [messageId] = uuidParams(req, res, ['id'], 'Message id must be a UUID') ?? [];
  if (!messageId) return;
  const parsed = threadPrivacySchema.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }

  // Safe: authenticate runs first on this router and always sets req.user.
  const user = req.user!;
  const result = await setThreadPrivacy(messageId, user.id, parsed.data.is_private, {
    id: user.id,
    name: user.name,
  });
  if (!result) {
    res.status(404).json(errorBody('NOT_FOUND', 'No such message'));
    return;
  }
  const body: ThreadPrivacyResponse = { is_private: result.isPrivate, updated: result.updated };
  res.status(200).json(body);
}

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
  if (!held.has(EMAIL_LINK_EDIT_CAPABILITY[recordType])) return false;
  return canReadLinkedRecord(recordType, ownerId, user);
}

/**
 * POST /api/v1/email-messages/:id/links
 * Files one of the caller's own messages against a record.
 */
export async function createLinkHandler(req: Request, res: Response): Promise<void> {
  const [messageId] = uuidParams(req, res, ['id'], 'Message id must be a UUID') ?? [];
  if (!messageId) return;

  const parsed = createEmailMessageLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
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

  // Safe: authenticate runs first on this router and always sets req.user.
  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    const link = await createManualLink(messageId, record_type, record_id, req.user!.id, actor);
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
  const [messageId, linkId] =
    uuidParams(req, res, ['id', 'linkId'], 'Message id and link id must be UUIDs') ?? [];
  if (!messageId || !linkId) return;

  // Safe: authenticate runs first on this router and always sets req.user.
  const existing = await findLinkForUser(messageId, linkId, req.user!.id);
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
  const removed = await deleteMessageLink(messageId, linkId, req.user!.id, actor);
  if (!removed) {
    res.status(404).json(errorBody('NOT_FOUND', 'No such link'));
    return;
  }

  res.status(204).send();
}

// The two refusals of a send's key, answered before the body is read.
const IDEMPOTENCY_KEY_REQUIRED = 'IDEMPOTENCY_KEY_REQUIRED' satisfies SendRequestErrorCode;
const IDEMPOTENCY_KEY_INVALID = 'IDEMPOTENCY_KEY_INVALID' satisfies SendRequestErrorCode;

/**
 * The status each send refusal answers with.
 *
 * A provider's own failure is 502: the request was valid and our server healthy, and a 5xx
 * keeps a client from treating it as a fault in what the user typed. A mailbox that needs
 * reconnecting is 409, never 401, which the client reads as the user's own session ending.
 *
 * Keyed by every service code, so a code added to the shared table needs a status here.
 */
const SEND_ERROR_STATUS: Readonly<Record<Exclude<SendErrorCode, SendRequestErrorCode>, number>> = {
  [EMAIL_ACCOUNT_NOT_FOUND]: 404,
  [EMAIL_MESSAGE_NOT_FOUND]: 404,
  [TEMPLATE_NOT_FOUND]: 404,
  [PROVIDER_SEND_UNSUPPORTED]: 409,
  [SEND_AUTH_EXPIRED]: 409,
  [RECONNECT_REQUIRED]: 409,
  [RATE_LIMITED]: 429,
  [SEND_FAILED]: 502,
  [SEND_NOT_CONFIRMED]: 502,
  [SENT_NOT_RECORDED]: 500,
  [SEND_IN_PROGRESS]: 409,
  [SEND_ALREADY_SENT]: 409,
  [SEND_UNCONFIRMED]: 409,
  [IDEMPOTENCY_KEY_REUSED]: 422,
};

/** Maps a send error to its response, or rethrows anything that is not one. */
function respondToSendError(err: unknown, res: Response): void {
  // Safe: a thrown value of any shape, narrowed by the typeof below.
  const code = (err as { code?: unknown } | null)?.code;
  const status =
    typeof code === 'string' && Object.hasOwn(SEND_ERROR_STATUS, code)
      ? // Safe: the hasOwn check proves code is one of the table's keys.
        SEND_ERROR_STATUS[code as keyof typeof SEND_ERROR_STATUS]
      : undefined;
  if (typeof code !== 'string' || status === undefined) throw err;
  // Safe: a thrown value of any shape, narrowed by the typeof below.
  const retryAfter = (err as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof retryAfter === 'number') res.set('Retry-After', String(retryAfter));
  // Safe: every code in SEND_ERROR_STATUS is thrown by sendError, which builds an Error.
  res.status(status).json(errorBody(code, (err as Error).message));
}

/**
 * POST /api/v1/email-messages/send
 * Sends through one of the caller's own mailboxes and records the message.
 */
export async function sendEmailHandler(req: Request, res: Response): Promise<void> {
  const rawKey = req.get(IDEMPOTENCY_KEY_HEADER);
  if (rawKey === undefined) {
    res
      .status(400)
      .json(errorBody(IDEMPOTENCY_KEY_REQUIRED, `Send needs an ${IDEMPOTENCY_KEY_HEADER} header.`));
    return;
  }
  const key = idempotencyKeySchema.safeParse(rawKey);
  if (!key.success) {
    res
      .status(400)
      .json(errorBody(IDEMPOTENCY_KEY_INVALID, `${IDEMPOTENCY_KEY_HEADER} must be a UUID.`));
    return;
  }
  const parsed = sendEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  const input = parsed.data;
  const idempotency = { key: key.data, requestHash: requestHashOf(input) };

  // First: a repeat answers as the first send did, even after its record is gone.
  try {
    // Safe: authenticate runs first on this router and always sets req.user.
    const replayed = await replaySend(req.user!.id, idempotency);
    if (replayed) {
      res.status(201).json(replayed);
      return;
    }
  } catch (err) {
    respondToSendError(err, res);
    return;
  }

  // Sending from a record files the message against it, so the caller needs the same
  // write access that filing mail by hand does.
  if (input.record_type !== undefined && input.record_id !== undefined) {
    const ownerId = await findLinkedRecordOwner(input.record_type, input.record_id);
    if (ownerId === null) {
      res.status(404).json(errorBody('NOT_FOUND', 'No such record'));
      return;
    }
    // One rule for client and server: the capabilities the composer checks before it opens.
    const held: ReadonlySet<Capability> =
      res.locals.capabilities ?? (await userCapabilities(req.user!.id));
    const allowed =
      capabilitiesToSendFrom(input.record_type).every((capability) => held.has(capability)) &&
      (await canReadLinkedRecord(input.record_type, ownerId, {
        id: req.user!.id,
        role: req.user!.role,
      }));
    if (!allowed) {
      res.status(403).json(errorBody('FORBIDDEN', 'You may not send mail from this record.'));
      return;
    }
  }

  try {
    const sent = await sendEmail(
      input,
      req.user!.id,
      { id: req.user!.id, name: req.user!.name },
      idempotency,
    );
    res.status(201).json(sent);
  } catch (err) {
    respondToSendError(err, res);
  }
}
