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
  listBetaUsersHandler,
  enrollBetaUserHandler,
  removeBetaUserHandler,
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
 *               enable_at:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *                 description: >
 *                   ISO 8601 timestamp at which the flag should automatically enable.
 *                   Must be a future date when setting. Pass null to clear the schedule.
 *                   (MINCRM-488)
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

/**
 * @openapi
 * /api/v1/admin/feature-flags/{key}/beta-users:
 *   get:
 *     tags: [FeatureFlags]
 *     operationId: listBetaUsers
 *     summary: List beta-enrolled users for a flag
 *     description: Returns all users enrolled in the beta for the given flag. Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of enrolled users
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/:key/beta-users',
  authenticate,
  requireRole('admin'),
  asyncHandler(listBetaUsersHandler),
);

/**
 * @openapi
 * /api/v1/admin/feature-flags/{key}/beta-users:
 *   post:
 *     tags: [FeatureFlags]
 *     operationId: enrollBetaUser
 *     summary: Enroll a user in the beta for a flag
 *     description: >
 *       Enrolls the specified user in the beta for this flag. The user will see the flag
 *       as enabled even if the org-wide state is disabled. Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: User enrolled
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: User already enrolled
 */
router.post(
  '/:key/beta-users',
  authenticate,
  requireRole('admin'),
  asyncHandler(enrollBetaUserHandler),
);

/**
 * @openapi
 * /api/v1/admin/feature-flags/{key}/beta-users/{userId}:
 *   delete:
 *     tags: [FeatureFlags]
 *     operationId: removeBetaUser
 *     summary: Remove a user from the beta for a flag
 *     description: Removes the user's beta enrollment. Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Enrollment removed
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  '/:key/beta-users/:userId',
  authenticate,
  requireRole('admin'),
  asyncHandler(removeBetaUserHandler),
);

export default router;
