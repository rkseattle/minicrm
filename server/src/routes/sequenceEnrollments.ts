/**
 * Sequence enrollment routes — unenroll and get-by-id.
 * Enroll and list-by-contact are on the contacts router.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { requireCapability } from '../middleware/requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { unenrollContactHandler, getEnrollmentHandler } from '../controllers/sequenceController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/sequence-enrollments/{id}:
 *   get:
 *     tags: [Sequences]
 *     operationId: getSequenceEnrollment
 *     summary: Get an enrollment by ID
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Enrollment found
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/:id',
  authenticate,
  requireCapability(Capability.SequencesEnroll),
  requireFeatureEnabled('sequencing'),
  asyncHandler(getEnrollmentHandler),
);

/**
 * @openapi
 * /api/v1/sequence-enrollments/{id}:
 *   delete:
 *     tags: [Sequences]
 *     operationId: unenrollContact
 *     summary: Unenroll a contact from a sequence
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Enrollment updated to unenrolled
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  '/:id',
  authenticate,
  requireCapability(Capability.SequencesEnroll),
  requireFeatureEnabled('sequencing'),
  asyncHandler(unenrollContactHandler),
);

export default router;
