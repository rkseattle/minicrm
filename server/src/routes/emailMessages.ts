/**
 * Email message routes — reading synced mail through the records it names.
 * Route definitions and OpenAPI annotations only; logic lives in the controller.
 */

import { Router } from 'express';

import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

import {
  createLinkHandler,
  deleteLinkHandler,
  getMessageHandler,
  listRecordMessagesHandler,
  listUnmatchedMessagesHandler,
  sendEmailHandler,
  setThreadPrivacyHandler,
} from '../controllers/emailMessageController.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/requireRole.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';

const router = Router();

router.use(authenticate);
router.use(requireFeatureEnabled('email_sync'));
router.use(requireCapability(Capability.ConnectedAccountsManage));

/**
 * @openapi
 * /api/v1/email-messages/unmatched:
 *   get:
 *     tags: [Email Messages]
 *     operationId: listUnmatchedEmailMessages
 *     summary: List your synced mail that no record claims
 *     description: >
 *       Returns the caller's own synced messages that carry no link, grouped into threads
 *       and paged by thread. Another user's mail is never included, whatever records the
 *       caller can see.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *     responses:
 *       200:
 *         description: A page of threads
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailThreadPage'
 *       400:
 *         description: Invalid pagination parameters
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Email sync is disabled, or the caller cannot manage mailboxes
 */
router.get('/unmatched', asyncHandler(listUnmatchedMessagesHandler));

/**
 * @openapi
 * /api/v1/email-messages/{id}:
 *   get:
 *     tags: [Email Messages]
 *     operationId: getEmailMessage
 *     summary: Read one of your synced messages with its bodies
 *     description: >
 *       Returns one message from the caller's own mailboxes with its plain-text and HTML
 *       bodies. The HTML is stored exactly as the sender wrote it and is returned
 *       unsanitized; a client must sanitize it before rendering. A message in any other
 *       mailbox answers 404, whatever records the caller can see.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The message
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { $ref: '#/components/schemas/EmailMessageDetail' }
 *       400:
 *         description: The id is not a UUID
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Email sync is disabled, or the caller cannot manage mailboxes
 *       404:
 *         description: No such message in the caller's mailboxes
 */
router.get('/:id', asyncHandler(getMessageHandler));

/**
 * @openapi
 * /api/v1/email-messages:
 *   get:
 *     tags: [Email Messages]
 *     operationId: listRecordEmailMessages
 *     summary: List your synced mail linked to one record
 *     description: >
 *       Returns the caller's own synced messages linked to the given record, grouped into
 *       threads and paged by thread. Reading requires both the mailbox that synced the mail
 *       and visibility of the record it is filed against, so one user never sees another's
 *       correspondence with a shared contact.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: record_type
 *         required: true
 *         schema: { type: string, enum: [contact, lead, account, deal] }
 *       - in: query
 *         name: record_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *     responses:
 *       200:
 *         description: A page of threads
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailThreadPage'
 *       400:
 *         description: Invalid record type, record id, or pagination parameters
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: The caller has no visibility into that record
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/', asyncHandler(listRecordMessagesHandler));

/**
 * @openapi
 * /api/v1/email-messages/send:
 *   post:
 *     tags: [Email Messages]
 *     operationId: sendEmailMessage
 *     summary: Send mail through one of your connected mailboxes
 *     description: >
 *       Sends a composed message, or a template rendered against a record, through a Gmail
 *       or Microsoft mailbox the caller connected, then stores it, links it to the records
 *       its addresses name, and audits it. Naming a record also files an Email activity
 *       there (not for leads), which requires activities:create. A reply or forward names a
 *       stored message in the same mailbox and joins its conversation; a forward quotes the
 *       original. Successful sends are limited per user per hour. Every request carries an
 *       Idempotency-Key, one per compose: a repeat under the same key never sends again, and
 *       answers as the first request did.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         description: A UUID the client generates once per compose and reuses on every retry of it.
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [connected_account_id, to]
 *             properties:
 *               connected_account_id: { type: string, format: uuid }
 *               to: { type: array, items: { type: string, format: email } }
 *               cc: { type: array, items: { type: string, format: email } }
 *               subject: { type: string, maxLength: 255 }
 *               body_html: { type: string, maxLength: 100000, description: Required unless template_id is given }
 *               template_id: { type: string, format: uuid }
 *               record_type: { type: string, enum: [contact, lead, account, deal] }
 *               record_id: { type: string, format: uuid }
 *               in_reply_to_message_id: { type: string, format: uuid }
 *               forward_of_message_id: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Sent and stored, or a repeat of a send that was
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { $ref: '#/components/schemas/EmailMessage' }
 *                 unresolved_merge_tags: { type: array, items: { type: string } }
 *       400:
 *         description: Invalid body, or a missing or malformed Idempotency-Key (IDEMPOTENCY_KEY_REQUIRED, IDEMPOTENCY_KEY_INVALID)
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Email sync is disabled, the caller cannot manage mailboxes, or may not write to the record or log activities
 *       404:
 *         description: No such mailbox, record, template, or message in this mailbox
 *       409:
 *         description: The mailbox cannot send, or must be reconnected (PROVIDER_SEND_UNSUPPORTED, PROVIDER_AUTH_EXPIRED, RECONNECT_REQUIRED); or a repeat of a send still in flight (SEND_IN_PROGRESS), sent but not yet filed (SEND_ALREADY_SENT), or of unknown outcome (SEND_UNCONFIRMED)
 *       422:
 *         description: IDEMPOTENCY_KEY_REUSED — the key was already used for a different message
 *       429:
 *         description: RATE_LIMITED — the caller's hourly limit, or the provider's
 *         headers:
 *           Retry-After:
 *             description: Seconds until the caller's hourly limit admits another send. Absent when the provider throttled.
 *             schema: { type: integer, minimum: 1 }
 *       500:
 *         description: SENT_NOT_RECORDED — sent, but not stored; do not resend
 *       502:
 *         description: SEND_FAILED — the provider refused the send; or SEND_NOT_CONFIRMED — it did not say whether the send went, so check Sent before sending again
 */
router.post('/send', asyncHandler(sendEmailHandler));

/**
 * @openapi
 * /api/v1/email-messages/{id}/links:
 *   post:
 *     tags: [Email Messages]
 *     operationId: createEmailMessageLink
 *     summary: File one of your messages against a record
 *     description: >
 *       Links a message in one of the caller's own mailboxes to a contact, lead, account or
 *       deal. Requires the record's own edit capability where one exists, on top of mailbox
 *       management — filing mail against a record is a CRM write. The link is recorded as
 *       manual and audited against the mailbox.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [record_type, record_id]
 *             properties:
 *               record_type: { type: string, enum: [contact, lead, account, deal] }
 *               record_id: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: The link that was created
 *       400:
 *         description: Invalid message id, record type, or record id
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: The caller may not file mail against that record
 *       404:
 *         description: No such message in the caller's mailboxes, or no such record
 *       409:
 *         description: That record is already linked to the message
 */
router.post('/:id/links', asyncHandler(createLinkHandler));

/**
 * @openapi
 * /api/v1/email-messages/{id}/thread-privacy:
 *   patch:
 *     tags: [Email Messages]
 *     operationId: setEmailThreadPrivacy
 *     summary: Mark a thread in one of your mailboxes private, or visible again
 *     description: >
 *       Sets is_private on every message in the thread the given message belongs to, within
 *       the caller's own mailbox. A private thread is readable only by its mailbox's owner,
 *       administrators included, and mail arriving later in it inherits the setting. Other
 *       users' copies of the same conversation, in their own mailboxes, are unaffected.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [is_private]
 *             additionalProperties: false
 *             properties:
 *               is_private: { type: boolean }
 *     responses:
 *       200:
 *         description: The thread's new setting, and how many messages changed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [is_private, updated]
 *               properties:
 *                 is_private: { type: boolean }
 *                 updated: { type: integer }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch('/:id/thread-privacy', asyncHandler(setThreadPrivacyHandler));

/**
 * @openapi
 * /api/v1/email-messages/{id}/links/{linkId}:
 *   delete:
 *     tags: [Email Messages]
 *     operationId: deleteEmailMessageLink
 *     summary: Remove a link from one of your messages
 *     description: >
 *       Removes a link, automatic or manual, from a message in one of the caller's own
 *       mailboxes. A removed automatic link does not come back: the removal is recorded, so
 *       neither a later change to the record's relationships nor a re-sync re-files it.
 *       Filing it again by hand clears that and restores normal automatic behavior.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: linkId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: The link was removed
 *       400:
 *         description: Invalid message id or link id
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete('/:id/links/:linkId', asyncHandler(deleteLinkHandler));

export default router;
