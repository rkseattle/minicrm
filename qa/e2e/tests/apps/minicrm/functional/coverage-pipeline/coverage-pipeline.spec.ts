/**
 * Coverage/TIA pipeline ingestion functional tests. (MINCRM-614, MINCRM-615, MINCRM-616)
 *
 * Verifies the ingestion endpoint works end to end against a real running
 * server — NOT symbolication accuracy or storage-model correctness in
 * detail, which the server-side unit/integration suite already covers
 * (server/src/__tests__/coverage{Ingestion,Symbolication,Model}Service.test.ts).
 * Assertions here are structural (response shape, status codes, the
 * idempotent-no-op contract), mirroring coverage-instrumentation.spec.ts's
 * own scope split between server unit tests and this functional layer.
 *
 * Tests:
 *   COVP-01  Ingesting a browser-origin dump returns 201 with a well-formed
 *            result the first time, then 200 alreadyIngested=true on retry
 *   COVP-03  Ingesting an unknown dumpId returns 404 COVERAGE_DUMP_NOT_FOUND
 *
 * Mutates no feature flag (MINCRM-685). This spec used to toggle
 * coverage_pipeline_ingestion over the REST API and assert a
 * 403 FEATURE_DISABLED path in COVP-02. That row is gone: the router now
 * gates its entire route registration on the COVERAGE_PIPELINE_INGESTION env
 * var at process boot, exactly as POST /admin/coverage/dump has gated on
 * COVERAGE_INSTRUMENTATION since MINCRM-663. A boot-time env var cannot be
 * flipped mid-run by an E2E spec, so COVP-02's intent moved to
 * server/src/__tests__/coverageRouteGating.test.ts, which re-imports the app
 * module with the var unset and asserts a 404 — routes absent rather than
 * registered-and-refusing.
 *
 * CI sets both env vars 'true' for every job that runs this spec, so nothing
 * here needs to arrange access at all.
 *
 * test.describe.serial and the @serial tags are retained, but NOT because the
 * remaining tests depend on each other — COVP-03 posts a hardcoded unknown
 * dumpId and shares no state with COVP-01. They are retained because COVP-01
 * writes coverage_units rows in the shared coverage database, which
 * coverage-mapping.spec.ts also reads and writes; see this file's entry in
 * qa/e2e/apps/minicrm/resource-registry.ts, which now declares that contention
 * directly instead of the feature-flag rows it used to.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No app-domain strings in framework layer
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

// ---------------------------------------------------------------------------
// COVP-01 — ingest succeeds, then a retry reports the idempotent no-op
// ---------------------------------------------------------------------------

test('@functional @serial COVP-01: ingesting a browser-origin dump succeeds, then retry is idempotent', async ({
  restClient,
}) => {
  const dumpRes = await restClient.post<{ dump: Record<string, unknown> }>(
    '/api/v1/admin/coverage/dump',
    {
      label: 'coverage-pipeline-spec',
      source: 'browser',
      payload: {
        'src/App.tsx': {
          path: 'src/App.tsx',
          statementMap: {},
          fnMap: {
            '0': {
              name: 'App',
              decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
              loc: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
              line: 1,
            },
          },
          branchMap: {},
          s: {},
          f: { '0': 1 },
          b: {},
        },
      },
    },
  );
  expect(dumpRes.status).toBe(201);
  const dumpId = dumpRes.body.dump['dumpId'];

  const firstIngest = await restClient.post<{ result: Record<string, unknown> }>(
    '/api/v1/admin/coverage/pipeline/ingest',
    { dumpId },
  );
  expect(firstIngest.status).toBe(201);
  expect(firstIngest.body.result['alreadyIngested']).toBe(false);
  expect(firstIngest.body.result['unitCount']).toBeGreaterThan(0);

  const secondIngest = await restClient.post<{ result: Record<string, unknown> }>(
    '/api/v1/admin/coverage/pipeline/ingest',
    { dumpId },
  );
  expect(secondIngest.status).toBe(200);
  expect(secondIngest.body.result['alreadyIngested']).toBe(true);
});

// COVP-02 removed (MINCRM-685): it asserted 403 FEATURE_DISABLED with the
// coverage_pipeline_ingestion row toggled off. The row no longer exists and the
// gate is now COVERAGE_PIPELINE_INGESTION at process boot, which no E2E spec can
// flip. The equivalent assertion — 404, routes never registered — lives in
// server/src/__tests__/coverageRouteGating.test.ts.

// ---------------------------------------------------------------------------
// COVP-03 — unknown dumpId returns 404 COVERAGE_DUMP_NOT_FOUND
// ---------------------------------------------------------------------------

test('@functional @serial COVP-03: ingesting an unknown dumpId returns 404 COVERAGE_DUMP_NOT_FOUND', async ({
  restClient,
}) => {
  try {
    await restClient.post('/api/v1/admin/coverage/pipeline/ingest', {
      dumpId: '00000000-0000-0000-0000-000000000000',
    });
    expect(true).toBe(false);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    const body = (err as { body?: { error?: { code?: string } } }).body;
    expect(status).toBe(404);
    expect(body?.error?.code).toBe('COVERAGE_DUMP_NOT_FOUND');
  }
});
