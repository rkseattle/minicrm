/**
 * Feature flag routes — all endpoints require authentication and admin role. (MINCRM-463)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listFeatureFlagsHandler,
  updateFeatureFlagHandler,
  getMyFeatureFlagsHandler,
} from '../controllers/featureFlagController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/feature-flags/me:
 *   get:
 *     tags: [FeatureFlags]
 *     operationId: getMyFeatureFlags
 *     summary: Get resolved feature flags for the current user
 *     description: >
 *       Returns a map of all feature flag keys to their resolved enabled state
 *       for the calling user's role (accounting for role overrides). Available
 *       to all authenticated users.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Resolved feature flag map
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 flags:
 *                   type: object
 *                   additionalProperties:
 *                     type: boolean
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/me', authenticate, asyncHandler(getMyFeatureFlagsHandler));

/**
 * @openapi
 * /api/v1/admin/feature-flags:
 *   get:
 *     tags: [FeatureFlags]
 *     operationId: listFeatureFlags
 *     summary: List all feature flags
 *     description: >
 *       Returns all feature flags with their current state, role overrides,
 *       last-changed metadata, and active user counts (last 30 days). Admin only.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of feature flags
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 flags:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/FeatureFlag'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/', authenticate, requireRole('admin'), asyncHandler(listFeatureFlagsHandler));

/**
 * @openapi
 * /api/v1/admin/feature-flags/{key}:
 *   patch:
 *     tags: [FeatureFlags]
 *     operationId: updateFeatureFlag
 *     summary: Update a feature flag
 *     description: >
 *       Updates the enabled state and/or per-role overrides for a feature flag.
 *       Flags cannot be created or deleted via the API — only toggled. Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Feature flag key, e.g. 'notes', 'reporting'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled]
 *             properties:
 *               enabled:
 *                 type: boolean
 *               role_overrides:
 *                 type: object
 *                 nullable: true
 *                 properties:
 *                   admin:
 *                     type: boolean
 *                   rep:
 *                     type: boolean
 *     responses:
 *       200:
 *         description: Feature flag updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 flag:
 *                   $ref: '#/components/schemas/FeatureFlag'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch('/:key', authenticate, requireRole('admin'), asyncHandler(updateFeatureFlagHandler));

export default router;
