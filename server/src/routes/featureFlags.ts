/**
 * Feature flag routes — all endpoints require authentication and admin role.
 * (MINCRM-463, MINCRM-490, MINCRM-491, MINCRM-492)
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
  listUserOverridesHandler,
  upsertUserOverrideHandler,
  deleteUserOverrideHandler,
  listFlagGroupsHandler,
  createFlagGroupHandler,
  updateFlagGroupHandler,
  deleteFlagGroupHandler,
  listGroupBetaUsersHandler,
  enrollGroupBetaUserHandler,
  removeGroupBetaUserHandler,
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

// ── Flag groups (MINCRM-491) ───────────────────────────────────────────────────
// NOTE: Group routes must be registered before /:key to prevent Express from
// matching the literal string 'groups' as a flag key.

/**
 * @openapi
 * /api/v1/admin/feature-flags/groups:
 *   get:
 *     tags: [FeatureFlags]
 *     operationId: listFlagGroups
 *     summary: List all flag groups
 *     description: Returns all flag groups with member_count and beta_user_count. Admin only.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of flag groups
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/groups', authenticate, requireRole('admin'), asyncHandler(listFlagGroupsHandler));

/**
 * @openapi
 * /api/v1/admin/feature-flags/groups:
 *   post:
 *     tags: [FeatureFlags]
 *     operationId: createFlagGroup
 *     summary: Create a flag group
 *     description: >
 *       Creates a new flag group. Groups act as a gate layer above flags — disabling a group
 *       blocks all member flags for all users not in the group's beta list. Admin only.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [group_key, label]
 *             properties:
 *               group_key:
 *                 type: string
 *                 maxLength: 100
 *                 pattern: '^[a-z0-9_-]+$'
 *               label:
 *                 type: string
 *                 maxLength: 100
 *               description:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       201:
 *         description: Group created
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         description: Group key already exists
 */
router.post('/groups', authenticate, requireRole('admin'), asyncHandler(createFlagGroupHandler));

/**
 * @openapi
 * /api/v1/admin/feature-flags/groups/{key}:
 *   patch:
 *     tags: [FeatureFlags]
 *     operationId: updateFlagGroup
 *     summary: Update a flag group
 *     description: >
 *       Updates a flag group's enabled state, enable_at schedule, label, or description.
 *       Admin only.
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
 *             properties:
 *               enabled:
 *                 type: boolean
 *               label:
 *                 type: string
 *               description:
 *                 type: string
 *               enable_at:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Group updated
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch(
  '/groups/:key',
  authenticate,
  requireRole('admin'),
  asyncHandler(updateFlagGroupHandler),
);

/**
 * @openapi
 * /api/v1/admin/feature-flags/groups/{key}:
 *   delete:
 *     tags: [FeatureFlags]
 *     operationId: deleteFlagGroup
 *     summary: Delete a flag group
 *     description: >
 *       Deletes a flag group, atomically unassigning all member flags (setting their group_key
 *       to null) in the same transaction before removing the group. Admin only. (MINCRM-567)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Group deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  '/groups/:key',
  authenticate,
  requireRole('admin'),
  asyncHandler(deleteFlagGroupHandler),
);

/**
 * @openapi
 * /api/v1/admin/feature-flags/groups/{key}/beta-users:
 *   get:
 *     tags: [FeatureFlags]
 *     operationId: listGroupBetaUsers
 *     summary: List beta users for a flag group
 *     description: >
 *       Returns all users enrolled in the beta for this group.
 *       Group beta users bypass the group gate even when the group is disabled. Admin only.
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
 *         description: List of enrolled group beta users
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/groups/:key/beta-users',
  authenticate,
  requireRole('admin'),
  asyncHandler(listGroupBetaUsersHandler),
);

/**
 * @openapi
 * /api/v1/admin/feature-flags/groups/{key}/beta-users:
 *   post:
 *     tags: [FeatureFlags]
 *     operationId: enrollGroupBetaUser
 *     summary: Enroll a user in a group's beta
 *     description: >
 *       Enrolls a user in the group's beta list. This user bypasses the group gate
 *       and proceeds to flag-level evaluation even when the group is disabled. Admin only.
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
 *         description: User enrolled in group beta
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: User already enrolled in group beta
 */
router.post(
  '/groups/:key/beta-users',
  authenticate,
  requireRole('admin'),
  asyncHandler(enrollGroupBetaUserHandler),
);

/**
 * @openapi
 * /api/v1/admin/feature-flags/groups/{key}/beta-users/{userId}:
 *   delete:
 *     tags: [FeatureFlags]
 *     operationId: removeGroupBetaUser
 *     summary: Remove a user from a group's beta
 *     description: Removes the user's enrollment from the group's beta list. Admin only.
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
  '/groups/:key/beta-users/:userId',
  authenticate,
  requireRole('admin'),
  asyncHandler(removeGroupBetaUserHandler),
);

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

// ── Per-user overrides (MINCRM-492) ────────────────────────────────────────────

/**
 * @openapi
 * /api/v1/admin/feature-flags/{key}/overrides:
 *   get:
 *     tags: [FeatureFlags]
 *     operationId: listUserOverrides
 *     summary: List per-user overrides for a flag
 *     description: >
 *       Returns all per-user forced overrides (force_enabled and force_disabled) for
 *       the given flag, including user details, direction, reason, and date added.
 *       These overrides are evaluated before all other targeting rules. Admin only.
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
 *         description: List of per-user overrides
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/:key/overrides',
  authenticate,
  requireRole('admin'),
  asyncHandler(listUserOverridesHandler),
);

/**
 * @openapi
 * /api/v1/admin/feature-flags/{key}/overrides/{userId}:
 *   put:
 *     tags: [FeatureFlags]
 *     operationId: upsertUserOverride
 *     summary: Upsert a per-user override for a flag
 *     description: >
 *       Forces a flag on (force_enabled) or off (force_disabled) for a specific user,
 *       unconditionally overriding all other targeting rules including group gates,
 *       beta enrollment, and rollout bucketing. If an override already exists for this
 *       user+flag combination, it is replaced (upsert). Admin only.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [override]
 *             properties:
 *               override:
 *                 type: string
 *                 enum: [force_enabled, force_disabled]
 *               reason:
 *                 type: string
 *                 maxLength: 1000
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Override upserted
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.put(
  '/:key/overrides/:userId',
  authenticate,
  requireRole('admin'),
  asyncHandler(upsertUserOverrideHandler),
);

/**
 * @openapi
 * /api/v1/admin/feature-flags/{key}/overrides/{userId}:
 *   delete:
 *     tags: [FeatureFlags]
 *     operationId: deleteUserOverride
 *     summary: Remove a per-user override for a flag
 *     description: >
 *       Removes the forced override for the given user. After removal, the user's
 *       flag resolution returns to normal evaluation (beta → rollout → org-wide). Admin only.
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
 *         description: Override removed
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  '/:key/overrides/:userId',
  authenticate,
  requireRole('admin'),
  asyncHandler(deleteUserOverrideHandler),
);

export default router;
