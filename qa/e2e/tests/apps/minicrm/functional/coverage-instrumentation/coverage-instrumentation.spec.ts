/**
 * Coverage/TIA control API functional tests. (MINCRM-604, MINCRM-605, MINCRM-606)
 *
 * Verifies the instrumentation and control API work end to end against a
 * real running server — NOT coverage completeness or code/test mapping,
 * which is out of scope for this phase (see docs/dev/coverage.md). Assertions
 * are structural (response shape, status codes) rather than content-specific
 * (e.g. "route X was covered").
 *
 * Tests:
 *   COV-01  Reset/dump succeed and return well-formed dump metadata when the
 *           flag is on (structural — content of the dump is not asserted)
 *   COV-02  Guarded route returns 403 FEATURE_DISABLED when the flag is off
 *   COV-03  Browser-origin dump ingestion round-trips through GET /dumps/:dumpId
 *
 * Mutates the coverage_instrumentation feature flag directly via the REST
 * API (not withFlags(), which only intercepts the browser's client-side
 * flag fetch and would not affect server-side requireFeatureEnabled
 * enforcement for restClient calls) — tagged @serial per the E2E authoring
 * rules for real feature-flag mutations, restored in afterEach. Every test
 * in this file mutates the SAME flag key, so the file also opts into
 * test.describe.serial — with fullyParallel:true, two tests toggling the
 * same shared flag concurrently can interleave (one test's "off" landing
 * after another's "on"), producing a flag state neither test intended.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No app-domain strings in framework layer
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { updateFeatureFlag } from '@behaviors/minicrm/feature-flags.behaviors.js';

const COVERAGE_FLAG_KEY = 'coverage_instrumentation';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

test.afterEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  // Restore the true default — see migration 156, which intentionally seeds
  // no role_overrides so `enabled` is the sole, real kill-switch.
  await updateFeatureFlag(restClient, COVERAGE_FLAG_KEY, { enabled: false }).catch(() => {});
});

// ---------------------------------------------------------------------------
// COV-01 — reset/dump succeed with well-formed metadata when the flag is on
// ---------------------------------------------------------------------------

test('@functional @serial COV-01: reset and dump succeed and return well-formed dump metadata', async ({
  restClient,
}) => {
  await updateFeatureFlag(restClient, COVERAGE_FLAG_KEY, { enabled: true });

  // RestClient throws on any 4xx/5xx status rather than returning it, so both
  // outcomes below are handled via try/catch, not response.status inspection.
  // 204/201 when the backend agent is running (COVERAGE_INSTRUMENTATION=true
  // on the server under test); 409 COVERAGE_NOT_ENABLED when it isn't. Both
  // are valid, well-defined outcomes for this environment — what matters
  // here is that the flag gate itself let the request through (never 403).
  try {
    await restClient.post('/api/v1/admin/coverage/reset', {});
  } catch (err: unknown) {
    expect((err as { status?: number }).status).toBe(409);
  }

  try {
    const dumpRes = await restClient.post<{ dump: Record<string, unknown> }>(
      '/api/v1/admin/coverage/dump',
      { label: 'coverage-instrumentation-spec' },
    );
    expect(dumpRes.status).toBe(201);
    const dump = dumpRes.body.dump;
    expect(dump['dumpId']).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(dump['agent']).toBe('node-v8');
    expect(dump['format']).toBe('v8-script-coverage');
    expect(dump['commitSha']).toBeTruthy();
  } catch (err: unknown) {
    expect((err as { status?: number }).status).toBe(409);
  }
});

// ---------------------------------------------------------------------------
// COV-02 — flag off blocks the guarded route, even for an admin
// ---------------------------------------------------------------------------

test('@functional @serial COV-02: guarded route returns 403 FEATURE_DISABLED when the flag is off', async ({
  restClient,
}) => {
  await updateFeatureFlag(restClient, COVERAGE_FLAG_KEY, { enabled: false });

  try {
    await restClient.post('/api/v1/admin/coverage/reset', {});
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
// COV-03 — browser-origin dump ingestion round-trips through GET /dumps/:dumpId
// ---------------------------------------------------------------------------

test('@functional @serial COV-03: browser-origin dump ingestion round-trips through GET /dumps/:dumpId', async ({
  restClient,
}) => {
  await updateFeatureFlag(restClient, COVERAGE_FLAG_KEY, { enabled: true });

  const createRes = await restClient.post<{ dump: Record<string, unknown> }>(
    '/api/v1/admin/coverage/dump',
    {
      label: 'coverage-instrumentation-spec-browser',
      source: 'browser',
      payload: { 'src/App.tsx': { path: 'src/App.tsx', s: { '0': 1 } } },
    },
  );
  expect(createRes.status).toBe(201);
  expect(createRes.body.dump['agent']).toBe('browser-istanbul');
  expect(createRes.body.dump['format']).toBe('istanbul');

  const dumpId = createRes.body.dump['dumpId'];
  const getRes = await restClient.get<{ dump: Record<string, unknown> }>(
    `/api/v1/admin/coverage/dumps/${dumpId}`,
  );
  expect(getRes.status).toBe(200);
  expect(getRes.body.dump['dumpId']).toBe(dumpId);
});
