/**
 * Coverage/TIA session management functional tests. (MINCRM-609, MINCRM-610,
 * MINCRM-611, MINCRM-612)
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
 *   CVS-02  Guarded route returns 403 FEATURE_DISABLED when the flag is off
 *   CVS-03  Ending an already-ended session returns 409 COVERAGE_SESSION_CONFLICT
 *   CVS-04  Recording a dump attributes it to the session; a duplicate dumpId
 *           is rejected with 409
 *
 * Mutates the coverage_session_management feature flag directly via the REST
 * API (not withFlags(), which only intercepts the browser's client-side
 * flag fetch and would not affect server-side requireFeatureEnabled
 * enforcement for restClient calls) — tagged @serial per the E2E authoring
 * rules for real feature-flag mutations, restored in afterEach, and the file
 * opts into test.describe.serial so two tests toggling the same flag can't
 * interleave under fullyParallel:true.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No app-domain strings in framework layer
 */

import { randomUUID } from 'crypto';
import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { updateFeatureFlag } from '@behaviors/minicrm/feature-flags.behaviors.js';

const SESSION_FLAG_KEY = 'coverage_session_management';
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
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

test.afterEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  // Restore the true default — migration 157 seeds no role_overrides so
  // `enabled` is the sole, real kill-switch (mirrors coverage-instrumentation.spec.ts).
  await updateFeatureFlag(restClient, SESSION_FLAG_KEY, { enabled: false }).catch(() => {});
});

// ---------------------------------------------------------------------------
// CVS-01 — start/end succeed; ended session drops out of the active list
// ---------------------------------------------------------------------------

test('@functional @serial CVS-01: start and end succeed and return well-formed session metadata', async ({
  restClient,
}) => {
  await updateFeatureFlag(restClient, SESSION_FLAG_KEY, { enabled: true });

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
// CVS-02 — flag off blocks the guarded route, even for an admin
// ---------------------------------------------------------------------------

test('@functional @serial CVS-02: guarded route returns 403 FEATURE_DISABLED when the flag is off', async ({
  restClient,
}) => {
  await updateFeatureFlag(restClient, SESSION_FLAG_KEY, { enabled: false });

  try {
    await restClient.post(SESSIONS_ENDPOINT, baseSessionParams('CVS-02 session'));
    // Should not reach here — the request must be rejected while the flag is off.
    expect(true).toBe(false);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    const body = (err as { body?: { error?: { code?: string } } }).body;
    expect(status).toBe(403);
    expect(body?.error?.code).toBe('FEATURE_DISABLED');
  }
});

// ---------------------------------------------------------------------------
// CVS-03 — ending an already-ended session returns 409
// ---------------------------------------------------------------------------

test('@functional @serial CVS-03: ending an already-ended session returns 409 COVERAGE_SESSION_CONFLICT', async ({
  restClient,
}) => {
  await updateFeatureFlag(restClient, SESSION_FLAG_KEY, { enabled: true });

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

test('@functional @serial CVS-04: recording a dump attributes it to the session; a duplicate dumpId is rejected', async ({
  restClient,
}) => {
  await updateFeatureFlag(restClient, SESSION_FLAG_KEY, { enabled: true });

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
