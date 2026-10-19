/**
 * Email template routes. Read-only, and gated as sending is: a template is picked only to
 * send through a connected mailbox.
 */

import { Router } from 'express';

import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

import { listEmailTemplatesHandler } from '../controllers/emailTemplateController.js';
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
 * /api/v1/email-templates:
 *   get:
 *     tags: [Email Templates]
 *     operationId: listEmailTemplates
 *     summary: List the enabled email templates a sender can pick
 *     description: >
 *       Returns enabled templates by name, with their subject, body and merge tags, so a
 *       compose form can preview one. Templates are rendered against a record only when a
 *       message is sent from it. Disabled templates and authorship are never included.
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
 *         description: A page of templates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       name: { type: string }
 *                       category: { type: string }
 *                       subject: { type: string }
 *                       body: { type: string }
 *                       merge_tags:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             key: { type: string }
 *                             label: { type: string }
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 limit: { type: integer }
 *       400:
 *         description: Invalid pagination parameters
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Email sync is disabled, or the caller cannot manage mailboxes
 */
router.get('/', asyncHandler(listEmailTemplatesHandler));

export default router;
