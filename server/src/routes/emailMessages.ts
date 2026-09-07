/**
 * Email message routes — reading synced mail through the records it names.
 * Route definitions and OpenAPI annotations only; logic lives in the controller.
 */

import { Router } from 'express';

import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

import {
  createLinkHandler,
  deleteLinkHandler,
  listRecordMessagesHandler,
  listUnmatchedMessagesHandler,
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
