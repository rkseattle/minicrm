/**
 * Demo data routes.
 * All endpoints require authentication + admin role. (MINCRM-103)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getDemoStatusHandler,
  seedDemoHandler,
  resetDemoHandler,
  removeDemoHandler,
} from '../controllers/demoController.js';

const router = Router();

// All demo routes require admin auth
router.use(authenticate, requireRole('admin'));

/**
 * @openapi
 * /api/admin/demo/status:
 *   get:
 *     tags: [Admin]
 *     operationId: getDemoStatus
 *     summary: Get demo data status (admin only)
 *     description: Returns whether demo data is currently present in the database.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Demo data status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 active:
 *                   type: boolean
 *             example:
 *               active: true
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin role required
 */
router.get('/status', asyncHandler(getDemoStatusHandler));

/**
 * @openapi
 * /api/admin/demo/seed:
 *   post:
 *     tags: [Admin]
 *     operationId: seedDemo
 *     summary: Seed demo data (admin only)
 *     description: Inserts a full set of demo records. Returns 409 if demo data already exists.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Demo data seeded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin role required
 *       409:
 *         description: Demo data already present
 */
router.post('/seed', asyncHandler(seedDemoHandler));

/**
 * @openapi
 * /api/admin/demo/reset:
 *   post:
 *     tags: [Admin]
 *     operationId: resetDemo
 *     summary: Reset demo data (admin only)
 *     description: Removes existing demo data and re-seeds from scratch in a single transaction.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Demo data reset
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin role required
 */
router.post('/reset', asyncHandler(resetDemoHandler));

/**
 * @openapi
 * /api/admin/demo:
 *   delete:
 *     tags: [Admin]
 *     operationId: removeDemo
 *     summary: Remove demo data (admin only)
 *     description: Deletes all demo-flagged records. Returns 409 if no demo data exists.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Demo data removed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Admin role required
 *       409:
 *         description: No demo data present
 */
router.delete('/', asyncHandler(removeDemoHandler));

export default router;
