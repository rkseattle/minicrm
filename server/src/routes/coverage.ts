/**
 * Coverage/TIA control API routes — all endpoints require authentication,
 * admin role, and the coverage_instrumentation feature flag. (MINCRM-606)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  resetCoverageHandler,
  snapshotCoverageHandler,
  dumpCoverageHandler,
  getCoverageDumpHandler,
} from '../controllers/coverageController.js';

const router = Router();

/**
 * @openapi
 * /api/v1/admin/coverage/reset:
 *   post:
 *     tags: [Coverage]
 *     operationId: resetCoverage
 *     summary: Reset the backend coverage agent's counters
 *     description: >
 *       Clears accumulated coverage counters on the backend V8 coverage agent.
 *       Requires COVERAGE_INSTRUMENTATION to have been enabled at server boot. Admin only.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       204:
 *         description: Coverage counters reset
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         description: Coverage instrumentation is not running on this server
 */
router.post(
  '/reset',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('coverage_instrumentation'),
  asyncHandler(resetCoverageHandler),
);

/**
 * @openapi
 * /api/v1/admin/coverage/snapshot:
 *   post:
 *     tags: [Coverage]
 *     operationId: snapshotCoverage
 *     summary: Read current backend coverage counters
 *     description: >
 *       Reads current backend counters without persisting an artifact to disk.
 *       NOTE: V8's takePreciseCoverage() resets counters as a side effect of
 *       reading them — this is not a non-destructive read. Admin only.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label:
 *                 type: string
 *     responses:
 *       200:
 *         description: Coverage dump metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 dump:
 *                   $ref: '#/components/schemas/CoverageDump'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         description: Coverage instrumentation is not running on this server
 */
router.post(
  '/snapshot',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('coverage_instrumentation'),
  asyncHandler(snapshotCoverageHandler),
);

/**
 * @openapi
 * /api/v1/admin/coverage/dump:
 *   post:
 *     tags: [Coverage]
 *     operationId: dumpCoverage
 *     summary: Persist a tagged coverage dump
 *     description: >
 *       With no `source`/`payload`, persists a dump from the backend V8 coverage
 *       agent. With `{ source: 'browser', payload, label }`, ingests an
 *       already-collected frontend Istanbul coverage payload without touching
 *       the agent. Admin only.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [label]
 *             properties:
 *               label:
 *                 type: string
 *               source:
 *                 type: string
 *                 enum: [node, browser]
 *               payload:
 *                 type: object
 *                 description: Required when source is "browser" — the raw window.__coverage__ payload
 *     responses:
 *       201:
 *         description: Coverage dump persisted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 dump:
 *                   $ref: '#/components/schemas/CoverageDump'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         description: Coverage instrumentation is not running on this server
 */
router.post(
  '/dump',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('coverage_instrumentation'),
  asyncHandler(dumpCoverageHandler),
);

/**
 * @openapi
 * /api/v1/admin/coverage/dumps/{dumpId}:
 *   get:
 *     tags: [Coverage]
 *     operationId: getCoverageDump
 *     summary: Look up metadata for a previously produced coverage dump
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: dumpId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Coverage dump found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 dump:
 *                   $ref: '#/components/schemas/CoverageDump'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/dumps/:dumpId',
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('coverage_instrumentation'),
  asyncHandler(getCoverageDumpHandler),
);

export default router;
