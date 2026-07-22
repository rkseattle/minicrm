/**
 * Coverage/TIA pipeline routes — all endpoints require authentication,
 * admin role, and the coverage_pipeline_ingestion feature flag. (MINCRM-614)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ingestCoverageDumpHandler } from '../controllers/coveragePipelineController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/admin/coverage/pipeline/ingest:
 *   post:
 *     tags: [Coverage]
 *     operationId: ingestCoverageDump
 *     summary: Normalize and symbolicate a raw coverage dump into the coverage model
 *     description: >
 *       Reads an already-persisted raw coverage dump by ID, symbolicates it
 *       back to real source (file/function/branch), and merges the result
 *       into the version-anchored coverage_units storage model. Idempotent —
 *       re-ingesting a known dumpId is a no-op. Admin only.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dumpId]
 *             properties:
 *               dumpId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Dump ingested and merged into coverage_units for the first time
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   $ref: '#/components/schemas/IngestCoverageDumpResult'
 *       200:
 *         description: No-op — this dumpId was already ingested by an earlier call (see result.alreadyIngested)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   $ref: '#/components/schemas/IngestCoverageDumpResult'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post(
  '/ingest',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('coverage_pipeline_ingestion'),
  asyncHandler(ingestCoverageDumpHandler),
);

export default router;
