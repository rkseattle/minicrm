/**
 * Coverage/TIA health endpoint functional test.
 *
 * Verifies GET /api/v1/admin/coverage/health works end to end against a
 * real running server — NOT the underlying health-check logic in detail,
 * which the server-side unit suite already covers
 * (server/src/__tests__/coverageHealthService.test.ts,
 * coverageHealthRouteGating.test.ts). Assertions here are structural
 * (response shape, status code), mirroring coverage-mapping.spec.ts's own
 * scope split between server unit tests and this functional layer.
 *
 * Nothing to toggle here: this route registers unconditionally, outside its
 * router's boot gate, so an operator can still ask why coverage is not working
 * in exactly the deployment where everything is switched off. Since
 * the report's `routers` block is what answers that — it reflects the
 * COVERAGE_* env vars each router registers on, replacing a `featureFlags`
 * block whose rows migration 163 deleted. Nothing in this spec mutates shared
 * state, so it is NOT tagged @serial.
 *
 * Tests:
 *   COVH-01  An authenticated admin gets a 200 or 503 with the expected report shape
 *
 * Framework conventions:
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
    routers: {
      pipeline: boolean;
      mapping: boolean;
      reporting: boolean;
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
  // Asserted as exact values, not `typeof === 'boolean'`: a shape-only check
  // passes with all three false, so it would pass even if `routers` were
  // hardcoded and would never notice the block losing touch with reality.
  // docker-compose.test.yml sets all three gates to 'true' for this stack, and
  // the specs in coverage-mapping/ and coverage-pipeline/ only pass because
  // those routers really did register — so `true` here is the one end-to-end
  // proof that this report reflects actual registration rather than a
  // plausible-looking constant. If this fails, either the stack's env block
  // changed or the report stopped reading the same gate the routers do.
  expect(res.body.routers).toEqual({ pipeline: true, mapping: true, reporting: true });
});
