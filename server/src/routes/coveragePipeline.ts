/**
 * Coverage/TIA pipeline routes — internal-only tooling, gated entirely by the
 * COVERAGE_PIPELINE_INGESTION env var at boot, not a product feature_flags row.
 * (MINCRM-614, MINCRM-637, MINCRM-685)
 *
 * MINCRM-685: this router used to also require the coverage_pipeline_ingestion
 * feature_flags row (requireFeatureEnabled) alongside authenticate/
 * coverageAccessGate — see routes/coverage.ts's own docblock for the full
 * rationale (same fix, same shape, applied to this router by the story that
 * finished what MINCRM-663 started). The route below is now registered ONLY
 * when COVERAGE_PIPELINE_INGESTION is 'true' at process boot; an admin with no
 * special env context gets a plain 404, not a 403 — there is nothing here to
 * discover through the product UI at all. authenticate/coverageAccessGate
 * remain: an internal-only env var is not a substitute for auth, only for the
 * product-facing flag.
 *
 * Unlike coverageReporting.ts/coverageMapping.ts, this router does NOT opt into
 * COVERAGE_DASHBOARD_NO_AUTH — it ingests real coverage data rather than
 * serving read-only reports, and stays fully authenticated regardless.
 */

import { Router } from 'express';
import { registerRoutesIfEnabled } from './coverageBootGate.js';
import { authenticate } from '../middleware/auth.js';
import { coverageAccessGate } from '../middleware/coverageAccessGate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ingestCoverageDumpHandler } from '../controllers/coveragePipelineController.js';

const router = Router();

/** Registers every coverage pipeline route — only called when COVERAGE_PIPELINE_INGESTION is 'true' at boot. */
function registerCoveragePipelineRoutes(): void {
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
  router.post('/ingest', authenticate, coverageAccessGate, asyncHandler(ingestCoverageDumpHandler));
}

registerRoutesIfEnabled('COVERAGE_PIPELINE_INGESTION', registerCoveragePipelineRoutes);

export default router;
