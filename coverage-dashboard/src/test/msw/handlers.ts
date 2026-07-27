/**
 * MSW request handlers for the coverage-dashboard test suite.
 * Path-only patterns (no hostname) match any origin — required for
 * msw/node, where axios uses the Node adapter and URLs are not resolved
 * against window.location.
 */

import { http, HttpResponse } from 'msw';
import type { AuthUser } from '@/api/auth.js';
import type {
  CoverageSummary,
  DeadZoneUnit,
  ChangedUntestedUnit,
} from '@shared/schemas/coverageReportingSchema.js';
import type {
  CoverageMappingResult,
  UnitKeySearchResult,
  TestIdSearchResult,
} from '@shared/schemas/coverageMappingSchema.js';

export const MOCK_ADMIN_USER: AuthUser = {
  id: 'user-admin-1',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  status: 'active',
};

export const MOCK_COVERAGE_SUMMARY: CoverageSummary = {
  commitSha: 'abc123',
  overallUnitCount: 100,
  overallCoveredUnitCount: 80,
  overallCoveragePercent: 80,
  apiUnitCount: 60,
  apiCoveredUnitCount: 50,
  apiCoveragePercent: 83.33,
  frontendUnitCount: 40,
  frontendCoveredUnitCount: 30,
  frontendCoveragePercent: 75,
  automatedCoveredUnitCount: 70,
  manualCoveredUnitCount: 10,
  lastUpdatedAt: '2026-01-01T00:00:00.000Z',
};

export const MOCK_DEAD_ZONE_UNIT: DeadZoneUnit = {
  filePath: 'src/services/widgetService.ts',
  unitKey: 'unusedFunction#deadbeef00000000',
  branchId: null,
  granularity: 'function',
  resolved: true,
};

export const MOCK_NEVER_TAKEN_BRANCH: DeadZoneUnit = {
  filePath: 'src/services/widgetService.ts',
  unitKey: 'branchyFunction#abcdef0000000000',
  branchId: '0:1',
  granularity: 'branch',
  resolved: true,
};

export const MOCK_CHANGED_UNTESTED_UNIT: ChangedUntestedUnit = {
  filePath: 'src/services/dealService.ts',
  unitKey: 'createDeal#1234567800000000',
  changeKind: 'in-line',
};

export const MOCK_UNIT_KEY_SEARCH_RESULT: UnitKeySearchResult = {
  unitKey: 'handleSubmit#abc123',
  filePath: 'src/pages/DealsPage.tsx',
};

export const MOCK_TEST_ID_SEARCH_RESULT: TestIdSearchResult = {
  testId: 'spec:deals.spec.ts::creates a deal',
  testName: 'creates a deal',
};

export const MOCK_MAPPING_RESULT: CoverageMappingResult = {
  commitSha: 'abc123',
  unitKey: 'render#abc123',
  branchId: null,
  filePath: 'src/services/dealService.ts',
  testId: 'spec:deals.spec.ts::creates a deal',
  testName: 'creates a deal',
  testFile: 'tests/apps/minicrm/functional/deals/deal-creation.spec.ts',
  hitCount: 3,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  confidenceScore: 0.95,
  lastReconciledAt: '2026-01-01T00:00:00.000Z',
};

export const handlers = [
  http.get('*/api/v1/auth/me', () => HttpResponse.json({ user: MOCK_ADMIN_USER })),
  http.post('*/api/v1/auth/login', () =>
    HttpResponse.json({ user: MOCK_ADMIN_USER, mustChangePassword: false }),
  ),
  http.post('*/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })),
  http.get('*/api/v1/admin/coverage/reporting/summary', () =>
    HttpResponse.json({ summary: MOCK_COVERAGE_SUMMARY }),
  ),
  http.get('*/api/v1/admin/coverage/reporting/trend', () =>
    HttpResponse.json({ results: [MOCK_COVERAGE_SUMMARY] }),
  ),
  http.get('*/api/v1/admin/coverage/reporting/gaps', () =>
    HttpResponse.json({ deadZoneUnits: [], neverTakenBranches: [], changedUntestedUnits: null }),
  ),
  http.get('*/api/v1/admin/coverage/reporting/issues/:issueKey/coverage', () =>
    HttpResponse.json({
      coverage: { issueKey: 'MINCRM-1', sessionCount: 0, coveredUnitCount: 0, testIds: [] },
    }),
  ),
  http.get('*/api/v1/admin/coverage/reporting/tia-metrics', () =>
    HttpResponse.json({
      metrics: {
        fromSha: 'a',
        toSha: 'b',
        totalBuilds: 0,
        averageApiCoveragePercent: 0,
        averageFrontendCoveragePercent: 0,
      },
    }),
  ),
  http.get('*/api/v1/admin/coverage/mapping/tests-for-unit', () =>
    HttpResponse.json({ results: [] }),
  ),
  http.get('*/api/v1/admin/coverage/mapping/units-for-test', () =>
    HttpResponse.json({ results: [] }),
  ),
  http.get('*/api/v1/admin/coverage/mapping/unit-keys/search', () =>
    HttpResponse.json({ results: [] }),
  ),
  http.get('*/api/v1/admin/coverage/mapping/test-ids/search', () =>
    HttpResponse.json({ results: [] }),
  ),
  http.get('*/api/v1/admin/coverage/reporting/issue-keys', () =>
    HttpResponse.json({ issueKeys: [] }),
  ),
];
