/**
 * Coverage/TIA session management functional tests.
 *
 * Verifies the session control API end to end against a real running
 * server — session lifecycle (start/end/list/get), dump attribution, and
 * optimistic-lock conflict handling. NOT coverage completeness or
 * test-to-code mapping, which remain out of scope for this phase (see
 * docs/dev/coverage.md).
 *
 * Tests:
 *   CVS-01  Start/end succeed and return well-formed session metadata; ended
 *           session no longer appears in the active list
 *   CVS-03  Ending an already-ended session returns 409 COVERAGE_SESSION_CONFLICT
 *   CVS-04  Recording a dump attributes it to the session; a duplicate dumpId
 *           is rejected with 409
 *
 * this router's routes are now registered only when
 * COVERAGE_SESSION_MANAGEMENT='true' at process boot (no longer gated by a
 * coverage_session_management feature_flags row) — the CI/local E2E server
 * has this set (see docker-compose.dev.yml / ci.yml's e2e-serial job), so
 * these tests no longer need to toggle a flag before each run. CVS-02 (the
 * old "flag off returns 403" test) is removed — there is no runtime flag
 * left to toggle off within a single test run, since the gate is now a
 * boot-time env var. See docs/dev/coverage.md's own note on this: a genuine
 * "routes absent when the env var is unset" regression check lives in
 * coverageRouteGating.test.ts (server-side, spawns a subprocess with the
 * env var unset) — that property can't be exercised by mutating anything
 * through this already-running E2E server's REST API. The "coverage tooling
 * not reachable through the product UI" regression this story also
 * requires is instead a CRM-client-side check: CVS-05 below, asserting
 * /admin/coverage-sessions no longer exists as a route at all now that
 * CoverageSessionRecorderPage.tsx is deleted from minicrm-client.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No app-domain strings in framework layer
 */

import { randomUUID } from 'crypto';
import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  loginAsAdmin,
  loginViaBrowser,
  navigateToPathAndGetFinalPathname,
} from '@behaviors/minicrm/auth.behaviors.js';
import { createTestAdmin } from '@apps/minicrm/helpers.js';

const SESSIONS_ENDPOINT = '/api/v1/admin/coverage/sessions';

interface SessionBody {
  id: string;
  status: string;
  correlationId: string;
  version: number;
}

function baseSessionParams(label: string) {
  return {
    label,
    source: 'automated-e2e' as const,
    buildSha: 'e2e-spec-sha',
    environment: 'e2e',
  };
}

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

// ---------------------------------------------------------------------------
// CVS-01 — start/end succeed; ended session drops out of the active list
// ---------------------------------------------------------------------------

test('@functional CVS-01: start and end succeed and return well-formed session metadata', async ({
  restClient,
}) => {
  const startRes = await restClient.post<{ session: SessionBody }>(
    SESSIONS_ENDPOINT,
    baseSessionParams('CVS-01 session'),
  );
  expect(startRes.status).toBe(201);
  const session = startRes.body.session;
  expect(session.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(session.correlationId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(session.status).toBe('active');
  expect(session.version).toBe(1);

  const listBeforeEnd = await restClient.get<{ data: SessionBody[] }>(SESSIONS_ENDPOINT);
  expect(listBeforeEnd.body.data.map((s) => s.id)).toContain(session.id);

  const endRes = await restClient.post<{ session: SessionBody }>(
    `${SESSIONS_ENDPOINT}/${session.id}/end`,
    { version: session.version },
  );
  expect(endRes.status).toBe(200);
  expect(endRes.body.session.status).toBe('ended');

  const listAfterEnd = await restClient.get<{ data: SessionBody[] }>(SESSIONS_ENDPOINT);
  expect(listAfterEnd.body.data.map((s) => s.id)).not.toContain(session.id);
});

// ---------------------------------------------------------------------------
// CVS-03 — ending an already-ended session returns 409
// ---------------------------------------------------------------------------

test('@functional CVS-03: ending an already-ended session returns 409 COVERAGE_SESSION_CONFLICT', async ({
  restClient,
}) => {
  const startRes = await restClient.post<{ session: SessionBody }>(
    SESSIONS_ENDPOINT,
    baseSessionParams('CVS-03 session'),
  );
  const session = startRes.body.session;

  const firstEnd = await restClient.post<{ session: SessionBody }>(
    `${SESSIONS_ENDPOINT}/${session.id}/end`,
    { version: session.version },
  );
  expect(firstEnd.status).toBe(200);

  try {
    await restClient.post(`${SESSIONS_ENDPOINT}/${session.id}/end`, {
      version: firstEnd.body.session.version,
    });
    expect(true).toBe(false);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    const body = (err as { body?: { error?: { code?: string } } }).body;
    expect(status).toBe(409);
    expect(body?.error?.code).toBe('COVERAGE_SESSION_CONFLICT');
  }
});

// ---------------------------------------------------------------------------
// CVS-04 — dump attribution round-trips; duplicate dumpId is rejected
// ---------------------------------------------------------------------------

test('@functional CVS-04: recording a dump attributes it to the session; a duplicate dumpId is rejected', async ({
  restClient,
}) => {
  const startRes = await restClient.post<{ session: SessionBody }>(
    SESSIONS_ENDPOINT,
    baseSessionParams('CVS-04 session'),
  );
  const session = startRes.body.session;
  const dumpId = randomUUID();

  const recordRes = await restClient.post<{ sessionDump: { dumpId: string; attempt: number } }>(
    `${SESSIONS_ENDPOINT}/${session.id}/dumps`,
    { dumpId, correlationId: session.correlationId, testId: 'spec.ts:1', attempt: 1 },
  );
  expect(recordRes.status).toBe(201);
  expect(recordRes.body.sessionDump.dumpId).toBe(dumpId);
  expect(recordRes.body.sessionDump.attempt).toBe(1);

  try {
    await restClient.post(`${SESSIONS_ENDPOINT}/${session.id}/dumps`, {
      dumpId,
      correlationId: session.correlationId,
    });
    expect(true).toBe(false);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    const body = (err as { body?: { error?: { code?: string } } }).body;
    expect(status).toBe(409);
    expect(body?.error?.code).toBe('DUMP_ALREADY_RECORDED');
  }
});

// ---------------------------------------------------------------------------
// CVS-05 — the manual-testing session recorder no longer exists in the CRM
// client itself ($2)
// ---------------------------------------------------------------------------

test('@functional CVS-05: /admin/coverage-sessions no longer exists as a route in the CRM client', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  const finalPathname = await navigateToPathAndGetFinalPathname('/admin/coverage-sessions', {
    page,
  });
  // The route was deleted from client/src/App.tsx entirely — the client's
  // own catch-all route redirects any unknown path to the dashboard ("/"),
  // so an admin navigating to this exact URL directly now lands on the
  // dashboard rather than any coverage-session-recorder UI.
  expect(finalPathname).toBe('/');
});
