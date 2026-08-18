/**
 * Coverage/TIA mapping query routes — internal-only tooling, gated entirely
 * by the COVERAGE_MAPPING_QUERY env var at boot, not a product feature_flags
 * row.
 *
 * this router used to also require the coverage_mapping_query
 * feature_flags row, via buildCoverageAccessGate's flag step — see
 * routes/coverage.ts's own docblock for the full rationale (same fix, same
 * shape, applied here by the story that finished what started).
 * The routes below are now registered ONLY when COVERAGE_MAPPING_QUERY is
 * 'true' at process boot; an admin with no special env context gets a plain
 * 404, not a 403 — there is nothing here to discover through the product UI
 * at all.
 *
 * That also retires the narrowing FOR THIS ROUTER. Under
 * COVERAGE_DASHBOARD_NO_AUTH the org-wide flag check was the last gate on an
 * unauthenticated request; the boot-time env var replaces it. That is a real
 * tradeoff, not a pure win: an unset var is a harder gate (the route was never
 * registered, so nothing reaches any middleware, where the flag was a mutable
 * row an admin could flip from the product UI), but it is no longer flippable
 * on a running server — disabling an over-exposed router now needs a restart,
 * where the org-wide flag took effect immediately. Acceptable because these
 * are internal CI/dev surfaces whose exposure is a deploy-time decision, and
 * because isDashboardNoAuthEnabled additionally requires
 * NODE_ENV !== 'production', so that combination cannot exist in a real
 * deployment. requireFeatureEnabledOrgWide itself is untouched and still
 * covered by its own unit tests.
 *
 * COVERAGE_DASHBOARD_NO_AUTH: drops authenticate +
 * coverageAccessGate for this router too, same shape as
 * coverageReporting.ts/coverageSessions.ts — the coverage-dashboard app's
 * Traceability tab calls tests-for-unit/units-for-test directly for its
 * drill-down section, and the unit-key/test-ID typeahead endpoints below
 * exist specifically to back that same tab. See isDashboardNoAuthEnabled's
 * own docblock (coverageAccessGate.ts) for why this is opted into
 * per-router rather than baked into coverageAccessGate itself.
 */

import { Router } from 'express';
import { registerRoutesIfEnabled } from '../coverageAgent/coverageBootGate.js';
import { buildCoverageAccessGate } from '../middleware/coverageAccessGate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  findTestsForUnitHandler,
  findUnitsForTestHandler,
  searchUnitKeysHandler,
  searchTestIdsHandler,
} from '../controllers/coverageMappingController.js';

const router = Router();

// No feature-flag argument: see buildCoverageAccessGate's docblock. This
// router is gated wholesale by COVERAGE_MAPPING_QUERY at boot.
const requireCoverageMappingAccess = [buildCoverageAccessGate()] as const;

/** Registers every coverage mapping route — only called when COVERAGE_MAPPING_QUERY is 'true' at boot. */
function registerCoverageMappingRoutes(): void {
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

  /**
   * @openapi
   * /api/v1/admin/coverage/mapping/unit-keys/search:
   *   get:
   *     tags: [Coverage]
   *     operationId: searchUnitKeys
   *     summary: Typeahead search over unit keys for a given commit
   *     description: >
   *       Backs the coverage-dashboard app's drill-down unit-key picker. Always
   *       requires both commitSha and a non-empty search term — a plain "list
   *       every unit key" endpoint is not viable at real scale.
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - name: commitSha
   *         in: query
   *         required: true
   *         schema:
   *           type: string
   *       - name: search
   *         in: query
   *         required: true
   *         schema:
   *           type: string
   *       - name: limit
   *         in: query
   *         required: false
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 50
   *           default: 20
   *     responses:
   *       200:
   *         description: Up to `limit` unit keys matching the search term at this commit
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 results:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       unitKey:
   *                         type: string
   *                       filePath:
   *                         type: string
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   */
  router.get(
    '/unit-keys/search',
    ...requireCoverageMappingAccess,
    asyncHandler(searchUnitKeysHandler),
  );

  /**
   * @openapi
   * /api/v1/admin/coverage/mapping/test-ids/search:
   *   get:
   *     tags: [Coverage]
   *     operationId: searchTestIds
   *     summary: Typeahead search over test IDs/names for a given commit
   *     description: >
   *       Backs the coverage-dashboard app's drill-down test-ID picker. Always
   *       requires both commitSha and a non-empty search term, matching
   *       against test_id OR test_name — a plain "list every test ID" endpoint
   *       is not viable at real scale.
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - name: commitSha
   *         in: query
   *         required: true
   *         schema:
   *           type: string
   *       - name: search
   *         in: query
   *         required: true
   *         schema:
   *           type: string
   *       - name: limit
   *         in: query
   *         required: false
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 50
   *           default: 20
   *     responses:
   *       200:
   *         description: Up to `limit` tests matching the search term at this commit
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 results:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       testId:
   *                         type: string
   *                       testName:
   *                         type: string
   *                         nullable: true
   *       400:
   *         $ref: '#/components/responses/ValidationError'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   */
  router.get(
    '/test-ids/search',
    ...requireCoverageMappingAccess,
    asyncHandler(searchTestIdsHandler),
  );
}

registerRoutesIfEnabled('COVERAGE_MAPPING_QUERY', registerCoverageMappingRoutes);

export default router;
