/**
 * Email message routes — reading synced mail through the records it names.
 * Route definitions and OpenAPI annotations only; logic lives in the controller.
 */

import { Router } from 'express';

import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

import {
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

export default router;
