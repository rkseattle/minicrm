/**
 * Dashboard routes — all endpoints require authentication.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getDashboardSummaryHandler } from '../controllers/dashboardController.js';

const router = Router();

/**
 * @openapi
 * /api/dashboard/summary:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get the dashboard summary
 *     description: >
 *       Returns a summary of the pipeline (deal counts and total values per stage)
 *       and the authenticated user's open and overdue task counts.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Dashboard summary
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardSummary'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/summary', authenticate, asyncHandler(getDashboardSummaryHandler));

export default router;
