/**
 * Activity routes — all endpoints require authentication.
 * Role restriction is not applied here; all authenticated users can manage activities.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createActivityHandler,
  listActivitiesHandler,
  listMyTasksHandler,
  getActivityHandler,
  updateActivityHandler,
  deleteActivityHandler,
} from '../controllers/activityController.js';
import {
  bulkPatchActivitiesHandler,
  bulkDeleteActivitiesHandler,
} from '../controllers/bulkV2Controller.js';

const router = Router();

/**
 * @openapi
 * /api/v1/activities:
 *   get:
 *     tags: [Activities]
 *     operationId: listActivities
 *     summary: List activities
 *     description: >
 *       Returns all activities. Supports filtering by parent record:
 *       `?contact=<uuid>`, `?account=<uuid>`, or `?deal=<uuid>`.
 *       Pass `?owner=me` to scope to the authenticated user.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: owner
 *         schema:
 *           type: string
 *           enum: [me]
 *         description: Pass 'me' to return only the authenticated user's activities
 *       - in: query
 *         name: contact
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by contact ID
 *       - in: query
 *         name: account
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by account ID
 *       - in: query
 *         name: deal
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by deal ID
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [Note, Call, Email, Meeting, Task]
 *         description: Filter by activity type
 *       - in: query
 *         name: start
 *         schema:
 *           type: string
 *           format: date
 *         description: Return only activities updated on or after this date (YYYY-MM-DD)
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date
 *         description: Return only activities updated on or before this date (YYYY-MM-DD)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: 1-based page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 25
 *         description: Records per page
 *     responses:
 *       200:
 *         description: Array of activities
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activities:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Activity'
 *             example:
 *               activities:
 *                 - id: ac1b2c3d-0000-0000-0000-000000000001
 *                   type: Call
 *                   subject: Discovery Call
 *                   notes: Discussed renewal pricing options.
 *                   due_date: '2025-04-01'
 *                   status: open
 *                   contact_id: c1d2e3f4-0000-0000-0000-000000000001
 *                   account_id: a1b2c3d4-0000-0000-0000-000000000001
 *                   deal_id: d1e2f3a4-0000-0000-0000-000000000001
 *                   owner_id: u1b2c3d4-0000-0000-0000-000000000001
 *                   created_at: '2025-03-15T09:00:00.000Z'
 *                   updated_at: '2025-03-15T09:00:00.000Z'
 *       400:
 *         description: Invalid query parameter (e.g., malformed UUID for ?contact=, ?account=, or ?deal=)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: contact must be a valid UUID
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
  '/',
  authenticate,
  requireFeatureEnabled('activities'),
  asyncHandler(listActivitiesHandler),
);

/**
 * @openapi
 * /api/v1/activities/my-tasks:
 *   get:
 *     tags: [Activities]
 *     operationId: listMyTasks
 *     summary: List the authenticated user's tasks (paginated)
 *     description: >
 *       Returns a paginated list of activities of type 'Task' owned by the authenticated user,
 *       sorted by due date ascending. Accepts optional `page` and `limit` query params.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: 1-based page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 25
 *         description: Records per page
 *     responses:
 *       200:
 *         description: Paginated list of tasks for the current user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tasks:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Activity'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *             example:
 *               tasks:
 *                 - id: ac1b2c3d-0000-0000-0000-000000000001
 *                   type: Task
 *                   subject: Send revised proposal to Acme
 *                   status: open
 *                   due_date: '2025-04-01'
 *               total: 1
 *               page: 1
 *               limit: 25
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
  '/my-tasks',
  authenticate,
  requireFeatureEnabled('activities'),
  asyncHandler(listMyTasksHandler),
);

/**
 * @openapi
 * /api/v1/activities:
 *   post:
 *     tags: [Activities]
 *     operationId: createActivity
 *     summary: Create an activity
 *     description: >
 *       Creates a new activity owned by the authenticated user. At least one of
 *       contact_id, account_id, or deal_id must be provided.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateActivityRequest'
 *           example:
 *             type: Call
 *             subject: Discovery Call
 *             notes: Discussed renewal pricing options.
 *             due_date: '2025-04-01'
 *             contact_id: c1d2e3f4-0000-0000-0000-000000000001
 *             deal_id: d1e2f3a4-0000-0000-0000-000000000001
 *     responses:
 *       201:
 *         description: Activity created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activity:
 *                   $ref: '#/components/schemas/Activity'
 *             example:
 *               activity:
 *                 id: ac1b2c3d-0000-0000-0000-000000000001
 *                 type: Call
 *                 subject: Discovery Call
 *                 notes: Discussed renewal pricing options.
 *                 due_date: '2025-04-01'
 *                 status: open
 *                 contact_id: c1d2e3f4-0000-0000-0000-000000000001
 *                 account_id: null
 *                 deal_id: d1e2f3a4-0000-0000-0000-000000000001
 *                 owner_id: u1b2c3d4-0000-0000-0000-000000000001
 *                 created_at: '2025-03-15T09:00:00.000Z'
 *                 updated_at: '2025-03-15T09:00:00.000Z'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: At least one of contact_id, account_id, or deal_id is required
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
router.post(
  '/',
  authenticate,
  requireCapability(Capability.ActivitiesCreate),
  requireFeatureEnabled('activities'),
  asyncHandler(createActivityHandler),
);

/**
 * @openapi
 * /api/v1/activities/bulk:
 *   patch:
 *     tags: [Activities]
 *     operationId: bulkPatchActivities
 *     summary: Bulk patch activities — reassign owner (MINCRM-562)
 *     description: >
 *       Reassigns owner_id on each listed activity individually.
 *       Requires bulk:operations + activities:edit. Non-admin actors can only
 *       act on activities they own. Max 500 IDs per request.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids, patch]
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 maxItems: 500
 *               patch:
 *                 type: object
 *                 required: [owner_id]
 *                 properties:
 *                   owner_id:
 *                     type: string
 *                     format: uuid
 *     responses:
 *       200:
 *         description: Partial or full success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkV2Result'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
// Registered here (before /:id) to prevent Express matching 'bulk' as a UUID param
router.patch(
  '/bulk',
  authenticate,
  requireCapability(Capability.BulkOperations),
  requireCapability(Capability.ActivitiesEdit),
  asyncHandler(bulkPatchActivitiesHandler),
);
/**
 * @openapi
 * /api/v1/activities/bulk:
 *   delete:
 *     tags: [Activities]
 *     operationId: bulkDeleteActivities
 *     summary: Bulk delete activities (MINCRM-562)
 *     description: >
 *       Deletes each listed activity individually.
 *       Requires bulk:operations + activities:delete. Non-admin actors can only
 *       delete activities they own. Max 500 IDs per request.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 maxItems: 500
 *     responses:
 *       200:
 *         description: Partial or full success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkV2Result'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
// Registered here (before /:id) to prevent Express matching 'bulk' as a UUID param
router.delete(
  '/bulk',
  authenticate,
  requireCapability(Capability.BulkOperations),
  requireCapability(Capability.ActivitiesDelete),
  asyncHandler(bulkDeleteActivitiesHandler),
);

/**
 * @openapi
 * /api/v1/activities/{id}:
 *   get:
 *     tags: [Activities]
 *     operationId: getActivity
 *     summary: Get an activity by ID
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Activity ID
 *     responses:
 *       200:
 *         description: Activity found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activity:
 *                   $ref: '#/components/schemas/Activity'
 *             example:
 *               activity:
 *                 id: ac1b2c3d-0000-0000-0000-000000000001
 *                 type: Call
 *                 subject: Discovery Call
 *                 notes: Discussed renewal pricing options.
 *                 due_date: '2025-04-01'
 *                 status: open
 *                 contact_id: c1d2e3f4-0000-0000-0000-000000000001
 *                 account_id: a1b2c3d4-0000-0000-0000-000000000001
 *                 deal_id: d1e2f3a4-0000-0000-0000-000000000001
 *                 owner_id: u1b2c3d4-0000-0000-0000-000000000001
 *                 created_at: '2025-03-15T09:00:00.000Z'
 *                 updated_at: '2025-03-15T09:00:00.000Z'
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
 *       404:
 *         description: Activity not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Activity not found
 */
router.get(
  '/:id',
  authenticate,
  requireFeatureEnabled('activities'),
  asyncHandler(getActivityHandler),
);

/**
 * @openapi
 * /api/v1/activities/{id}:
 *   patch:
 *     tags: [Activities]
 *     operationId: updateActivity
 *     summary: Update an activity
 *     description: >
 *       Updates one or more fields of an existing activity. Parent record IDs
 *       (contact_id, account_id, deal_id) cannot be changed after creation.
 *       Reps may only update activities they own; admins may update any activity.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Activity ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateActivityRequest'
 *           example:
 *             status: complete
 *             notes: Sent revised pricing proposal after the call.
 *     responses:
 *       200:
 *         description: Activity updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activity:
 *                   $ref: '#/components/schemas/Activity'
 *             example:
 *               activity:
 *                 id: ac1b2c3d-0000-0000-0000-000000000001
 *                 type: Call
 *                 subject: Discovery Call
 *                 notes: Sent revised pricing proposal after the call.
 *                 due_date: '2025-04-01'
 *                 status: complete
 *                 contact_id: c1d2e3f4-0000-0000-0000-000000000001
 *                 account_id: a1b2c3d4-0000-0000-0000-000000000001
 *                 deal_id: d1e2f3a4-0000-0000-0000-000000000001
 *                 owner_id: u1b2c3d4-0000-0000-0000-000000000001
 *                 created_at: '2025-03-15T09:00:00.000Z'
 *                 updated_at: '2025-03-16T10:30:00.000Z'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: VALIDATION_ERROR
 *                 message: status must be open or complete
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
 *       403:
 *         description: Rep attempting to update an activity they do not own
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have permission to update this activity
 *       404:
 *         description: Activity not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Activity not found
 */
router.patch(
  '/:id',
  authenticate,
  requireCapability(Capability.ActivitiesEdit),
  requireFeatureEnabled('activities'),
  asyncHandler(updateActivityHandler),
);

/**
 * @openapi
 * /api/v1/activities/{id}:
 *   delete:
 *     tags: [Activities]
 *     operationId: deleteActivity
 *     summary: Delete an activity
 *     description: >
 *       Deletes an activity. Reps may only delete activities they own; admins may
 *       delete any activity.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Activity ID
 *     responses:
 *       204:
 *         description: Activity deleted (no content)
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
 *       403:
 *         description: Rep attempting to delete an activity they do not own
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: FORBIDDEN
 *                 message: You do not have permission to delete this activity
 *       404:
 *         description: Activity not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error:
 *                 code: NOT_FOUND
 *                 message: Activity not found
 */
router.delete(
  '/:id',
  authenticate,
  requireCapability(Capability.ActivitiesDelete),
  requireFeatureEnabled('activities'),
  asyncHandler(deleteActivityHandler),
);

// ── Bulk V2 routes (MINCRM-562) ───────────────────────────────────────────────

export default router;
