/**
 * Coverage/TIA control API functional tests.
 *
 * Verifies the instrumentation and control API work end to end against a
 * real running server — NOT coverage completeness or code/test mapping,
 * which is out of scope for this phase (see docs/dev/coverage.md). Assertions
 * are structural (response shape, status codes) rather than content-specific
 * (e.g. "route X was covered").
 *
 * Tests:
 *   COV-01  Reset/dump succeed and return well-formed dump metadata when the
 *           routes are registered (structural — content of the dump is not
 *           asserted)
 *   COV-03  Browser-origin dump ingestion round-trips through GET /dumps/:dumpId
 *
 * this router's routes are now registered only when
 * COVERAGE_INSTRUMENTATION='true' at process boot (no longer gated by a
 * coverage_instrumentation feature_flags row) — the CI/local E2E server has
 * this set (see docker-compose.dev.yml / ci.yml's e2e-serial job). COV-02
 * (the old "flag off returns 403" test) is removed — there is no runtime
 * flag left to toggle off within a single test run, since the gate is now
 * a boot-time env var; see coverageRouteGating.test.ts (server-side) for
 * the genuine "routes absent when the env var is unset" regression check.
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

// ---------------------------------------------------------------------------
// COV-01 — reset/dump succeed with well-formed metadata
// ---------------------------------------------------------------------------

test('@functional COV-01: reset and dump succeed and return well-formed dump metadata', async ({
  restClient,
}) => {
  // RestClient throws on any 4xx/5xx status rather than returning it, so both
  // outcomes below are handled via try/catch, not response.status inspection.
  // 204/201 when the backend agent is running (COVERAGE_INSTRUMENTATION=true
  // on the server under test); 409 COVERAGE_NOT_ENABLED when it isn't. Both
  // are valid, well-defined outcomes for this environment — what matters
  // here is that the request reaches the handler at all (never 404).
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
// COV-03 — browser-origin dump ingestion round-trips through GET /dumps/:dumpId
// ---------------------------------------------------------------------------

test('@functional COV-03: browser-origin dump ingestion round-trips through GET /dumps/:dumpId', async ({
  restClient,
}) => {
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
