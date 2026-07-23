/**
 * Coverage/TIA mapping query functional tests. (MINCRM-618, MINCRM-621)
 *
 * Verifies the mapping query endpoints work end to end against a real
 * running server — NOT the underlying query correctness in detail, which
 * the server-side unit/integration suite already covers
 * (server/src/__tests__/coverageMapping{Service,Controller}.test.ts).
 * Assertions here are structural (response shape, status codes, that
 * confidence/freshness is attached), mirroring coverage-pipeline.spec.ts's
 * own scope split between server unit tests and this functional layer.
 *
 * Tests:
 *   COVM-01  A dump ingested with session/test attribution is queryable
 *            both directions (unit -> tests, test -> units), with
 *            confidence attached
 *   COVM-02  Guarded route returns 403 FEATURE_DISABLED when the
 *            coverage_mapping_query flag is off
 *   COVM-03  Querying a unit no test covers returns an empty results array
 *
 * Mutates the coverage_instrumentation, coverage_session_management,
 * coverage_pipeline_ingestion, and coverage_mapping_query feature flags
 * directly via the REST API (not withFlags(), which only intercepts the
 * browser's client-side flag fetch and would not affect server-side
 * requireFeatureEnabled enforcement for restClient calls) — tagged @serial
 * per the E2E authoring rules for real feature-flag mutations, restored in
 * afterEach. Every test in this file mutates the SAME flag keys, so the
 * file also opts into test.describe.serial.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No app-domain strings in framework layer
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { updateFeatureFlag } from '@behaviors/minicrm/feature-flags.behaviors.js';
import {
  startCoverageSession,
  recordCoverageSessionDump,
  CORRELATION_ID_HEADER,
  resolveSessionBuildSha,
  resolveSessionEnvironment,
} from '@framework/coverageAgent/coverage-session-control-client.js';
import {
  findTestsForUnit,
  findUnitsForTest,
} from '@framework/coverageAgent/coverage-mapping-client.js';

const INSTRUMENTATION_FLAG_KEY = 'coverage_instrumentation';
const SESSION_MANAGEMENT_FLAG_KEY = 'coverage_session_management';
const PIPELINE_FLAG_KEY = 'coverage_pipeline_ingestion';
const MAPPING_FLAG_KEY = 'coverage_mapping_query';
const ALL_FLAG_KEYS = [
  INSTRUMENTATION_FLAG_KEY,
  SESSION_MANAGEMENT_FLAG_KEY,
  PIPELINE_FLAG_KEY,
  MAPPING_FLAG_KEY,
] as const;

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

test.afterEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  // Restore the true defaults — every flag here is seeded disabled with no
  // role_overrides, so `enabled` is the sole kill-switch.
  await Promise.all(
    ALL_FLAG_KEYS.map((flagKey) =>
      updateFeatureFlag(restClient, flagKey, { enabled: false }).catch(() => {}),
    ),
  );
});

// ---------------------------------------------------------------------------
// COVM-01 — full round trip: dump -> session attribution -> ingest -> query
// ---------------------------------------------------------------------------

test('@functional @serial COVM-01: an ingested dump with test attribution is queryable both directions, with confidence attached', async ({
  restClient,
}) => {
  await Promise.all(
    ALL_FLAG_KEYS.map((flagKey) => updateFeatureFlag(restClient, flagKey, { enabled: true })),
  );

  const session = await startCoverageSession(restClient, {
    label: 'coverage-mapping-spec',
    source: 'automated-e2e',
    buildSha: resolveSessionBuildSha(),
    environment: resolveSessionEnvironment(),
  });

  const dumpRes = await restClient.post<{ dump: Record<string, unknown> }>(
    '/api/v1/admin/coverage/dump',
    {
      label: 'coverage-mapping-spec',
      source: 'browser',
      payload: {
        'src/MappingSpecWidget.tsx': {
          path: 'src/MappingSpecWidget.tsx',
          statementMap: {},
          fnMap: {
            '0': {
              name: 'MappingSpecWidget',
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
    { headers: { [CORRELATION_ID_HEADER]: session.correlationId } },
  );
  expect(dumpRes.status).toBe(201);
  const dumpId = dumpRes.body.dump['dumpId'] as string;
  const commitSha = dumpRes.body.dump['commitSha'] as string;

  await recordCoverageSessionDump(restClient, session.id, {
    dumpId,
    correlationId: session.correlationId,
    testId: 'spec:coverage-mapping.spec.ts::COVM-01',
    testName: 'COVM-01 mapping round trip',
  });

  const ingestRes = await restClient.post<{ result: Record<string, unknown> }>(
    '/api/v1/admin/coverage/pipeline/ingest',
    { dumpId },
  );
  expect(ingestRes.status).toBe(201);

  const testId = 'spec:coverage-mapping.spec.ts::COVM-01';

  // test -> units first, to discover the REAL unitKey ingestion actually
  // produced (a frontend dump with no real source file on disk resolves via
  // coverageSymbolicationService.ts's legacy name@line fallback key, not
  // MINCRM-619's structural key — asserting a hardcoded guess here would be
  // testing this spec's own assumption, not the query API). This direction
  // alone is an unambiguous, non-degradable assertion: testId scoping is
  // exact, so a non-empty result here proves the full dump -> session ->
  // ingest -> query round trip actually worked.
  const unitsForTest = await findUnitsForTest(restClient, { commitSha, testId });
  expect(unitsForTest.length).toBeGreaterThan(0);
  expect(unitsForTest[0].testId).toBe(testId);
  expect(
    typeof unitsForTest[0].confidenceScore === 'number' || unitsForTest[0].confidenceScore === null,
  ).toBe(true);

  // Now verify the OTHER direction (unit -> tests) using the real unitKey
  // just discovered — a genuine round-trip check of both query directions,
  // not a fallback that would silently pass even if this direction were broken.
  const testsForUnit = await findTestsForUnit(restClient, {
    commitSha,
    unitKey: unitsForTest[0].unitKey,
    branchId: unitsForTest[0].branchId ?? undefined,
  });
  expect(testsForUnit.length).toBeGreaterThan(0);
  expect(testsForUnit.map((result) => result.testId)).toContain(testId);
});

// ---------------------------------------------------------------------------
// COVM-02 — flag off blocks the guarded route, even for an admin
// ---------------------------------------------------------------------------

test('@functional @serial COVM-02: guarded route returns 403 FEATURE_DISABLED when the mapping flag is off', async ({
  restClient,
}) => {
  await updateFeatureFlag(restClient, MAPPING_FLAG_KEY, { enabled: false });

  try {
    await findTestsForUnit(restClient, { commitSha: 'anything', unitKey: 'anything#1' });
    expect(true).toBe(false);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    const body = (err as { body?: { error?: { code?: string } } }).body;
    expect(status).toBe(403);
    expect(body?.error?.code).toBe('FEATURE_DISABLED');
  }
});

// ---------------------------------------------------------------------------
// COVM-03 — a unit no test covers returns an empty results array, not an error
// ---------------------------------------------------------------------------

test('@functional @serial COVM-03: querying a unit no test covers returns an empty results array', async ({
  restClient,
}) => {
  await updateFeatureFlag(restClient, MAPPING_FLAG_KEY, { enabled: true });

  const results = await findTestsForUnit(restClient, {
    commitSha: 'coverage-mapping-spec-nonexistent-commit',
    unitKey: 'nonexistent#000',
  });

  expect(results).toEqual([]);
});
