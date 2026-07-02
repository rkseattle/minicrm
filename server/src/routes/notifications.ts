/**
 * Notification feed routes. (MINCRM-469)
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
 *         description: Not authenticated
 */
router.get('/', authenticate, asyncHandler(getNotificationFeedHandler));

/** Marks a single notification as read. */
router.post('/:id/read', authenticate, asyncHandler(markNotificationReadHandler));

/** Marks all of the authenticated user's notifications as read. */
router.post('/read-all', authenticate, asyncHandler(markAllNotificationsReadHandler));

export default router;
