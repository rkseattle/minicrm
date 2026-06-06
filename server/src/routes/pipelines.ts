/**
 * Pipelines routes (MINCRM-397).
 * GET is authenticated (any role); write operations are admin-only.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import {
  listPipelinesHandler,
  createPipelineHandler,
  updatePipelineHandler,
  deletePipelineHandler,
} from '../controllers/pipelineController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/pipelines:
 *   get:
 *     tags: [Pipelines]
 *     operationId: listPipelines
 *     summary: List all pipelines (MINCRM-397)
 *     description: Returns all pipelines ordered by default-first, then name.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of pipelines
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pipelines:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PipelineResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/', authenticate, asyncHandler(listPipelinesHandler));

/**
 * @openapi
 * /api/v1/pipelines:
 *   post:
 *     tags: [Pipelines]
 *     operationId: createPipeline
 *     summary: Create a new pipeline (admin only, MINCRM-397)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *     responses:
 *       201:
 *         description: Pipeline created
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         description: Pipeline name already in use
 */
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('multiple_pipelines'),
  asyncHandler(createPipelineHandler),
);

/**
 * @openapi
 * /api/v1/pipelines/{id}:
 *   patch:
 *     tags: [Pipelines]
 *     operationId: updatePipeline
 *     summary: Rename a pipeline (admin only, MINCRM-397)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: Pipeline updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Pipeline name already in use
 */
router.patch(
  '/:id',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('multiple_pipelines'),
  asyncHandler(updatePipelineHandler),
);

/**
 * @openapi
 * /api/v1/pipelines/{id}:
 *   delete:
 *     tags: [Pipelines]
 *     operationId: deletePipeline
 *     summary: Delete a non-default pipeline (admin only, MINCRM-397)
 *     description: >
 *       Blocked if this is the default pipeline (403) or if it has deals (409).
 *       Deleting a pipeline also removes its associated stages (CASCADE).
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Pipeline deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Pipeline has deals — must be empty before deletion
 */
router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('multiple_pipelines'),
  asyncHandler(deletePipelineHandler),
);

export default router;
