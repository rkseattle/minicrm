/**
 * Dashboard routes — all endpoints require authentication.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getDashboardSummaryHandler } from '../controllers/dashboardController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/dashboard/summary:
 *   get:
 *     tags: [Dashboard]
 *     operationId: getDashboardSummary
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
 *             example:
 *               pipeline:
 *                 Prospecting:
 *                   count: 3
 *                   total_value: 45000
 *                 Qualification:
 *                   count: 2
 *                   total_value: 28500
 *                 Proposal:
 *                   count: 1
 *                   total_value: 12500
 *                 Negotiation:
 *                   count: 0
 *                   total_value: 0
 *                 Closed Won:
 *                   count: 5
 *                   total_value: 87000
 *                 Closed Lost:
 *                   count: 1
 *                   total_value: 10000
 *               tasks:
 *                 open_count: 4
 *                 overdue_count: 1
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: UNAUTHORIZED
 *                 message: Authentication required
 */
router.get(
  '/summary',
  authenticate,
  requireCapability(Capability.DashboardsView),
  asyncHandler(getDashboardSummaryHandler),
);

export default router;
