/**
 * Coverage/TIA mapping query routes — all endpoints require
 * authentication, admin role, and the coverage_mapping_query feature flag.
 * (MINCRM-621)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  findTestsForUnitHandler,
  findUnitsForTestHandler,
} from '../controllers/coverageMappingController.js';

const router = Router();

const requireCoverageMappingAccess = [
  authenticate,
  requireRole('admin'),
  requireFeatureEnabled('coverage_mapping_query'),
] as const;

/**
 * @openapi
 * /api/v1/admin/coverage/mapping/tests-for-unit:
 *   get:
 *     tags: [Coverage]
 *     operationId: findTestsForUnit
 *     summary: Find every test known to cover a given code unit
 *     description: >
 *       Queries the bidirectional code<->test index for a code unit → tests
 *       lookup, scoped by commit SHA. Each result carries the confidence/
 *       freshness score coverageReconciliationService last computed for the
 *       underlying coverage_units row (null if reconciliation hasn't run, or
 *       the unit was pruned). Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: commitSha
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: unitKey
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: branchId
 *         in: query
 *         required: false
 *         description: Omit to look up a function-granularity unit (no branch).
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Every test known to cover this unit at this commit (empty array if none)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CoverageMappingResult'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/tests-for-unit',
  ...requireCoverageMappingAccess,
  asyncHandler(findTestsForUnitHandler),
);

/**
 * @openapi
 * /api/v1/admin/coverage/mapping/units-for-test:
 *   get:
 *     tags: [Coverage]
 *     operationId: findUnitsForTest
 *     summary: Find every code unit a given test is known to cover
 *     description: >
 *       Queries the bidirectional code<->test index for a test → code units
 *       lookup, scoped by commit SHA. Each result carries the confidence/
 *       freshness score coverageReconciliationService last computed for the
 *       underlying coverage_units row (null if reconciliation hasn't run, or
 *       the unit was pruned). Admin only.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: commitSha
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: testId
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Every code unit this test is known to cover at this commit (empty array if none)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CoverageMappingResult'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  '/units-for-test',
  ...requireCoverageMappingAccess,
  asyncHandler(findUnitsForTestHandler),
);

export default router;
