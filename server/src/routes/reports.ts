/**
 * Report routes — all endpoints require authentication.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getWinLossReportHandler,
  getActivityVolumeReportHandler,
} from '../controllers/reportController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/reports/win-loss:
 *   get:
 *     tags: [Reports]
 *     operationId: getWinLossReport
 *     summary: Get the win/loss report
 *     description: >
 *       Returns closed deal counts, values, win rate, and loss reason breakdown
 *       for a given date range (matched on close_date).
 *       Admins can filter by owner; reps always see only their own deals.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: start
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^\d{4}-\d{2}-\d{2}$'
 *         description: Start date (YYYY-MM-DD), inclusive
 *       - in: query
 *         name: end
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^\d{4}-\d{2}-\d{2}$'
 *         description: End date (YYYY-MM-DD), inclusive
 *       - in: query
 *         name: owner_id
 *         required: false
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by owner UUID (admin only)
 *     responses:
 *       200:
 *         description: Win/loss report
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WinLossReport'
 *             example:
 *               wonCount: 5
 *               wonValue: "87000.00"
 *               lostCount: 2
 *               lostValue: "30000.00"
 *               winRate: 0.714
 *               lossReasonBreakdown:
 *                 - reason: "Price too high"
 *                   count: 1
 *                 - reason: "Lost to competitor"
 *                   count: 1
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/win-loss', authenticate, asyncHandler(getWinLossReportHandler));

/**
 * @openapi
 * /api/v1/reports/activity-volume:
 *   get:
 *     tags: [Reports]
 *     operationId: getActivityVolumeReport
 *     summary: Get the activity volume report
 *     description: >
 *       Returns activity counts broken down by rep and activity type (Note, Call, Email,
 *       Meeting, Task) for a given date range (matched on activities.created_at).
 *       Admins see all reps and can filter by owner_id; reps always see only their own data.
 *       Implements MINCRM-181.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: start
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^\d{4}-\d{2}-\d{2}$'
 *         description: Start date (YYYY-MM-DD), inclusive
 *       - in: query
 *         name: end
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^\d{4}-\d{2}-\d{2}$'
 *         description: End date (YYYY-MM-DD), inclusive
 *       - in: query
 *         name: owner_id
 *         required: false
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by owner UUID (admin only)
 *     responses:
 *       200:
 *         description: Activity volume report
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ActivityVolumeReport'
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/activity-volume', authenticate, asyncHandler(getActivityVolumeReportHandler));

export default router;
