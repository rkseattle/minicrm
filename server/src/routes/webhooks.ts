/**
 * Webhook routes — all endpoints require authentication and admin role. (MINCRM-279)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createWebhookSubscriptionHandler,
  listWebhookSubscriptionsHandler,
  getWebhookSubscriptionHandler,
  updateWebhookSubscriptionHandler,
  deleteWebhookSubscriptionHandler,
  listWebhookDeliveryLogsHandler,
} from '../controllers/webhookController.js';

const router = Router();

/**
 * @openapi
 * /api/admin/webhooks:
 *   get:
 *     tags: [Webhooks]
 *     operationId: listWebhookSubscriptions
 *     summary: List all webhook subscriptions
 *     description: Returns all webhook subscriptions. Admin only.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of webhook subscriptions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 subscriptions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/WebhookSubscription'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/', authenticate, requireRole('admin'), asyncHandler(listWebhookSubscriptionsHandler));

/**
 * @openapi
 * /api/admin/webhooks:
 *   post:
 *     tags: [Webhooks]
 *     operationId: createWebhookSubscription
 *     summary: Create a webhook subscription
 *     description: >
 *       Creates a new webhook subscription. Returns the subscription and the one-time
 *       plaintext signing secret — it cannot be retrieved after this response. Admin only.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateWebhookSubscriptionRequest'
 *     responses:
 *       201:
 *         description: Webhook subscription created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 subscription:
 *                   $ref: '#/components/schemas/WebhookSubscription'
 *                 plaintextSecret:
 *                   type: string
 *                   description: Signing secret shown once — store it securely
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/', authenticate, requireRole('admin'), asyncHandler(createWebhookSubscriptionHandler));

/**
 * @openapi
 * /api/admin/webhooks/{id}:
 *   get:
 *     tags: [Webhooks]
 *     operationId: getWebhookSubscription
 *     summary: Get a webhook subscription by ID
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Webhook subscription found
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:id', authenticate, requireRole('admin'), asyncHandler(getWebhookSubscriptionHandler));

/**
 * @openapi
 * /api/admin/webhooks/{id}:
 *   patch:
 *     tags: [Webhooks]
 *     operationId: updateWebhookSubscription
 *     summary: Update a webhook subscription
 *     description: Updates url, events, or status (active/disabled). Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Webhook subscription updated
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch('/:id', authenticate, requireRole('admin'), asyncHandler(updateWebhookSubscriptionHandler));

/**
 * @openapi
 * /api/admin/webhooks/{id}:
 *   delete:
 *     tags: [Webhooks]
 *     operationId: deleteWebhookSubscription
 *     summary: Delete a webhook subscription
 *     description: Deletes the subscription and its delivery logs. Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Webhook subscription deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete('/:id', authenticate, requireRole('admin'), asyncHandler(deleteWebhookSubscriptionHandler));

/**
 * @openapi
 * /api/admin/webhooks/{id}/logs:
 *   get:
 *     tags: [Webhooks]
 *     operationId: listWebhookDeliveryLogs
 *     summary: List delivery logs for a webhook subscription
 *     description: Returns paginated delivery logs for the subscription. Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Paginated delivery logs
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:id/logs', authenticate, requireRole('admin'), asyncHandler(listWebhookDeliveryLogsHandler));

export default router;
