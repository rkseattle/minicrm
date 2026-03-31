/**
 * Activity routes — all endpoints require authentication.
 * Role restriction is not applied here; all authenticated users can manage activities.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createActivityHandler,
  listActivitiesHandler,
  listMyTasksHandler,
  getActivityHandler,
  updateActivityHandler,
  deleteActivityHandler,
} from '../controllers/activityController.js';

const router = Router();

/**
 * @openapi
 * /api/activities:
 *   get:
 *     tags: [Activities]
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
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/', authenticate, asyncHandler(listActivitiesHandler));

/**
 * @openapi
 * /api/activities/my-tasks:
 *   get:
 *     tags: [Activities]
 *     summary: List the authenticated user's open tasks
 *     description: >
 *       Returns all open activities of type 'Task' owned by the authenticated user,
 *       sorted by due date ascending. Overdue tasks are highlighted by comparing
 *       due_date to the current date client-side.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of open tasks for the current user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tasks:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Activity'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/my-tasks', authenticate, asyncHandler(listMyTasksHandler));

/**
 * @openapi
 * /api/activities:
 *   post:
 *     tags: [Activities]
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
 *       400:
 *         description: Validation error
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
router.post('/', authenticate, asyncHandler(createActivityHandler));

/**
 * @openapi
 * /api/activities/{id}:
 *   get:
 *     tags: [Activities]
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
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Activity not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id', authenticate, asyncHandler(getActivityHandler));

/**
 * @openapi
 * /api/activities/{id}:
 *   patch:
 *     tags: [Activities]
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
 *       400:
 *         description: Validation error
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
 *       403:
 *         description: Rep attempting to update an activity they do not own
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Activity not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/:id', authenticate, asyncHandler(updateActivityHandler));

/**
 * @openapi
 * /api/activities/{id}:
 *   delete:
 *     tags: [Activities]
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
 *       403:
 *         description: Rep attempting to delete an activity they do not own
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Activity not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete('/:id', authenticate, asyncHandler(deleteActivityHandler));

export default router;
