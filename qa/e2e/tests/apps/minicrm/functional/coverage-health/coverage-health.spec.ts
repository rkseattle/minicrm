/**
 * Coverage/TIA health endpoint functional test. (MINCRM-637)
 *
 * Verifies GET /api/v1/admin/coverage/health works end to end against a
 * real running server — NOT the underlying health-check logic in detail,
 * which the server-side unit suite already covers
 * (server/src/__tests__/coverageHealthService.test.ts,
 * coverageHealthRouteGating.test.ts). Assertions here are structural
 * (response shape, status code), mirroring coverage-mapping.spec.ts's own
 * scope split between server unit tests and this functional layer.
 *
 * No feature flag to toggle here — unlike coverage-mapping.spec.ts, this
 * route is documented as always-on (no requireFeatureEnabled gate), since
 * it must stay reachable regardless of which coverage subsystem flags are
 * toggled. Nothing in this spec mutates shared state, so it is NOT tagged
 * @serial.
 *
 * Tests:
 *   COVH-01  An authenticated admin gets a 200 or 503 with the expected report shape
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No app-domain strings in framework layer
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

test('@functional COVH-01: an authenticated admin gets a 200 or 503 with the expected coverage health report shape', async ({
  restClient,
}) => {
  const res = await restClient.get<{
    status: string;
    agentRunning: boolean;
    db: string;
    featureFlags: {
      coverage_pipeline_ingestion: boolean;
      coverage_mapping_query: boolean;
      coverage_reporting_query: boolean;
    };
  }>('/api/v1/admin/coverage/health');

  // Asserts [200, 503] and status in ['ok', 'degraded'], not pinned to the
  // healthy pair — the retention cron is live in this E2E environment
  // (server.ts, gated only on NODE_ENV !== 'test') and a prune failure
  // during a run would legitimately degrade this report; pinning to 200/ok
  // would fail this spec for a reason unrelated to the health endpoint's
  // own behavior (found via Greptile branch review). Mirrors
  // coverageHealthRouteGating.test.ts's own [200, 503] assertion.
  expect([200, 503]).toContain(res.status);
  expect(['ok', 'degraded']).toContain(res.body.status);
  expect(res.body.db).toBe('ok');
  expect(typeof res.body.agentRunning).toBe('boolean');
  expect(typeof res.body.featureFlags.coverage_pipeline_ingestion).toBe('boolean');
  expect(typeof res.body.featureFlags.coverage_mapping_query).toBe('boolean');
  expect(typeof res.body.featureFlags.coverage_reporting_query).toBe('boolean');
});
