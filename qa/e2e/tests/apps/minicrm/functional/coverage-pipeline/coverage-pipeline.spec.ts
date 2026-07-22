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
 *   COVP-02  Guarded route returns 403 FEATURE_DISABLED when the
 *            coverage_pipeline_ingestion flag is off
 *   COVP-03  Ingesting an unknown dumpId returns 404 COVERAGE_DUMP_NOT_FOUND
 *
 * Mutates the coverage_instrumentation and coverage_pipeline_ingestion
 * feature flags directly via the REST API (not withFlags(), which only
 * intercepts the browser's client-side flag fetch and would not affect
 * server-side requireFeatureEnabled enforcement for restClient calls) —
 * tagged @serial per the E2E authoring rules for real feature-flag
 * mutations, restored in afterEach. Every test in this file mutates the
 * SAME flag keys, so the file also opts into test.describe.serial.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No app-domain strings in framework layer
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { updateFeatureFlag } from '@behaviors/minicrm/feature-flags.behaviors.js';

const INSTRUMENTATION_FLAG_KEY = 'coverage_instrumentation';
const PIPELINE_FLAG_KEY = 'coverage_pipeline_ingestion';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

test.afterEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  // Restore the true defaults — both flags are seeded disabled (migrations
  // 156/158) with no role_overrides, so `enabled` is the sole kill-switch.
  await updateFeatureFlag(restClient, INSTRUMENTATION_FLAG_KEY, { enabled: false }).catch(() => {});
  await updateFeatureFlag(restClient, PIPELINE_FLAG_KEY, { enabled: false }).catch(() => {});
});

// ---------------------------------------------------------------------------
// COVP-01 — ingest succeeds, then a retry reports the idempotent no-op
// ---------------------------------------------------------------------------

test('@functional @serial COVP-01: ingesting a browser-origin dump succeeds, then retry is idempotent', async ({
  restClient,
}) => {
  await updateFeatureFlag(restClient, INSTRUMENTATION_FLAG_KEY, { enabled: true });
  await updateFeatureFlag(restClient, PIPELINE_FLAG_KEY, { enabled: true });

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

// ---------------------------------------------------------------------------
// COVP-02 — flag off blocks the guarded route, even for an admin
// ---------------------------------------------------------------------------

test('@functional @serial COVP-02: guarded route returns 403 FEATURE_DISABLED when the pipeline flag is off', async ({
  restClient,
}) => {
  await updateFeatureFlag(restClient, PIPELINE_FLAG_KEY, { enabled: false });

  try {
    await restClient.post('/api/v1/admin/coverage/pipeline/ingest', {
      dumpId: '00000000-0000-0000-0000-000000000000',
    });
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
// COVP-03 — unknown dumpId returns 404 COVERAGE_DUMP_NOT_FOUND
// ---------------------------------------------------------------------------

test('@functional @serial COVP-03: ingesting an unknown dumpId returns 404 COVERAGE_DUMP_NOT_FOUND', async ({
  restClient,
}) => {
  await updateFeatureFlag(restClient, PIPELINE_FLAG_KEY, { enabled: true });

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
