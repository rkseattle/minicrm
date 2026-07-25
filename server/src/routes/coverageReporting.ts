/**
 * Coverage/TIA reporting query routes — all endpoints require
 * authentication, admin role, and the coverage_reporting_query feature
 * flag. (MINCRM-629/630/631)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getCoverageSummaryHandler,
  getCoverageTrendHandler,
  getGapsHandler,
  getIssueCoverageHandler,
  getTiaValueMetricsHandler,
} from '../controllers/coverageReportingController.js';

const router = Router();

const requireCoverageReportingAccess = [
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('coverage_reporting_query'),
] as const;

/**
 * @openapi
 * /api/v1/admin/coverage/reporting/summary:
 *   get:
 *     tags: [Coverage]
 *     operationId: getCoverageSummary
 *     summary: Overall + per-tier coverage percentage for a single build
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: commitSha
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Coverage summary for this build
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: No coverage has ever been ingested for this commit
 */
router.get('/summary', ...requireCoverageReportingAccess, asyncHandler(getCoverageSummaryHandler));

/**
 * @openapi
 * /api/v1/admin/coverage/reporting/trend:
 *   get:
 *     tags: [Coverage]
 *     operationId: getCoverageTrend
 *     summary: Coverage summaries for the most recent builds, most recent first
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: limit
 *         in: query
 *         required: false
 *         description: Max builds to return (default 30, max 500)
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Coverage summaries, most recent build first
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/trend', ...requireCoverageReportingAccess, asyncHandler(getCoverageTrendHandler));

/**
 * @openapi
 * /api/v1/admin/coverage/reporting/gaps:
 *   get:
 *     tags: [Coverage]
 *     operationId: getCoverageGaps
 *     summary: Dead zones, never-taken branches, and changed-but-untested units
 *     description: >
 *       changedUntestedUnits is null unless baseSha is supplied — computing
 *       it requires diffing baseSha..commitSha, meaningfully more expensive
 *       than the dead-zone/never-taken-branch lists.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: commitSha
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: baseSha
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         required: false
 *         description: Max units per list (default 1000, max 5000)
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Gap analysis for this build/range
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/gaps', ...requireCoverageReportingAccess, asyncHandler(getGapsHandler));

/**
 * @openapi
 * /api/v1/admin/coverage/reporting/issues/{issueKey}/coverage:
 *   get:
 *     tags: [Coverage]
 *     operationId: getIssueCoverage
 *     summary: Coverage rollup for a single MiniCRM issue key, scoped to one build
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: issueKey
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: commitSha
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Coverage rollup for this issue key at this build
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/issues/:issueKey/coverage',
  ...requireCoverageReportingAccess,
  asyncHandler(getIssueCoverageHandler),
);

/**
 * @openapi
 * /api/v1/admin/coverage/reporting/tia-metrics:
 *   get:
 *     tags: [Coverage]
 *     operationId: getTiaValueMetrics
 *     summary: TIA selection value metrics over a commit range
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: fromSha
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: toSha
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: TIA value metrics over this build range
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/tia-metrics',
  ...requireCoverageReportingAccess,
  asyncHandler(getTiaValueMetricsHandler),
);

export default router;
