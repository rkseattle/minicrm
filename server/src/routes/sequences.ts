/**
 * Sequence routes — sales sequences and enrollment endpoints.
 *
 * Gated by capability, so a custom role's sequences:* grants are honoured. Of the built-in
 * roles, admin and manager hold create and edit; only admin holds delete.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
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
  requireCapability(Capability.SequencesView),
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
 *     description: Requires the sequences:create capability.
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
  requireCapability(Capability.SequencesCreate),
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
  requireCapability(Capability.SequencesView),
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
 *     description: Requires the sequences:edit capability.
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
  requireCapability(Capability.SequencesEdit),
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
 *     description: Requires the sequences:delete capability. Fails with 409 if active enrollments exist.
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
  requireCapability(Capability.SequencesDelete),
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
  requireCapability(Capability.SequencesView),
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
 *     description: Requires the sequences:edit capability.
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
  requireCapability(Capability.SequencesEdit),
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
 *     description: Requires the sequences:edit capability.
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
  requireCapability(Capability.SequencesEdit),
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
 *     description: Requires the sequences:edit capability.
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
  requireCapability(Capability.SequencesEdit),
  requireFeatureEnabled('sequencing'),
  asyncHandler(deleteStepHandler),
);

export default router;
