/**
 * Sequence routes — sales sequences and enrollment endpoints.
 * CRUD on sequences and steps requires admin role.
 * Enrolling/unenrolling and viewing enrollments is available to all authenticated users.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  createSequenceHandler,
  listSequencesHandler,
  getSequenceHandler,
  updateSequenceHandler,
  deleteSequenceHandler,
  listStepsHandler,
  createStepHandler,
  updateStepHandler,
  deleteStepHandler,
} from '../controllers/sequenceController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/sequences:
 *   get:
 *     tags: [Sequences]
 *     operationId: listSequences
 *     summary: List sales sequences
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *     responses:
 *       200:
 *         description: Paginated list of sequences
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  '/',
  authenticate,
  requireFeatureEnabled('sequencing'),
  asyncHandler(listSequencesHandler),
);

/**
 * @openapi
 * /api/v1/sequences:
 *   post:
 *     tags: [Sequences]
 *     operationId: createSequence
 *     summary: Create a sequence
 *     description: Admin only.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       201:
 *         description: Sequence created
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('sequencing'),
  asyncHandler(createSequenceHandler),
);

/**
 * @openapi
 * /api/v1/sequences/{id}:
 *   get:
 *     tags: [Sequences]
 *     operationId: getSequence
 *     summary: Get a sequence by ID
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Sequence found
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/:id',
  authenticate,
  requireFeatureEnabled('sequencing'),
  asyncHandler(getSequenceHandler),
);

/**
 * @openapi
 * /api/v1/sequences/{id}:
 *   patch:
 *     tags: [Sequences]
 *     operationId: updateSequence
 *     summary: Update a sequence
 *     description: Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Sequence updated
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
  '/:id',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('sequencing'),
  asyncHandler(updateSequenceHandler),
);

/**
 * @openapi
 * /api/v1/sequences/{id}:
 *   delete:
 *     tags: [Sequences]
 *     operationId: deleteSequence
 *     summary: Delete a sequence
 *     description: Admin only. Fails with 409 if active enrollments exist.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Sequence deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Sequence has active enrollments
 */
router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('sequencing'),
  asyncHandler(deleteSequenceHandler),
);

/**
 * @openapi
 * /api/v1/sequences/{id}/steps:
 *   get:
 *     tags: [Sequences]
 *     operationId: listSequenceSteps
 *     summary: List steps for a sequence
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Array of steps ordered by sort_order
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/:id/steps',
  authenticate,
  requireFeatureEnabled('sequencing'),
  asyncHandler(listStepsHandler),
);

/**
 * @openapi
 * /api/v1/sequences/{id}/steps:
 *   post:
 *     tags: [Sequences]
 *     operationId: createSequenceStep
 *     summary: Add a step to a sequence
 *     description: Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Step created
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Sort order conflict
 */
router.post(
  '/:id/steps',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('sequencing'),
  asyncHandler(createStepHandler),
);

/**
 * @openapi
 * /api/v1/sequences/{id}/steps/{stepId}:
 *   patch:
 *     tags: [Sequences]
 *     operationId: updateSequenceStep
 *     summary: Update a step
 *     description: Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: stepId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Step updated
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
  '/:id/steps/:stepId',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('sequencing'),
  asyncHandler(updateStepHandler),
);

/**
 * @openapi
 * /api/v1/sequences/{id}/steps/{stepId}:
 *   delete:
 *     tags: [Sequences]
 *     operationId: deleteSequenceStep
 *     summary: Delete a step
 *     description: Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: stepId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Step deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  '/:id/steps/:stepId',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('sequencing'),
  asyncHandler(deleteStepHandler),
);

export default router;
