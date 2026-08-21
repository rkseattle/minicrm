/**
 * Notification feed routes.
 * All endpoints require authentication only — no feature flag, since this is
 * generic infrastructure any feature may write to.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getNotificationFeedHandler,
  markNotificationReadHandler,
  markAllNotificationsReadHandler,
} from '../controllers/notificationFeedController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/notifications:
 *   get:
 *     tags: [Notifications]
 *     operationId: getNotificationFeed
 *     summary: Get the authenticated user's notification feed
 *     description: Returns the most recent notifications for the authenticated user, plus the unread count.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Notification feed
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/', authenticate, asyncHandler(getNotificationFeedHandler));

/**
 * @openapi
 * /api/v1/notifications/{id}/read:
 *   post:
 *     operationId: markNotificationRead
 *     summary: Mark a single notification as read
 *     tags: [Notifications]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Notification not found
 */
router.post('/:id/read', authenticate, asyncHandler(markNotificationReadHandler));

/**
 * @openapi
 * /api/v1/notifications/read-all:
 *   post:
 *     operationId: markAllNotificationsRead
 *     summary: Mark all of the authenticated user's notifications as read
 *     tags: [Notifications]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post('/read-all', authenticate, asyncHandler(markAllNotificationsReadHandler));

export default router;
