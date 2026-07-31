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
 *   COVM-03  Querying a unit no test covers returns an empty results array
 *
 * Mutates no feature flag (MINCRM-685). This spec used to toggle
 * coverage_pipeline_ingestion and coverage_mapping_query over the REST API and
 * assert a 403 FEATURE_DISABLED path in COVM-02. Those rows are gone: each
 * router now gates its entire route registration on its own env var at process
 * boot (COVERAGE_MAPPING_QUERY / COVERAGE_PIPELINE_INGESTION), exactly as the
 * dump and session-control routes have gated on COVERAGE_INSTRUMENTATION /
 * COVERAGE_SESSION_MANAGEMENT since MINCRM-663. A boot-time env var cannot be
 * flipped mid-run by an E2E spec, so COVM-02's intent moved to
 * server/src/__tests__/coverageRouteGating.test.ts, which re-imports the app
 * module with the var unset and asserts a 404 — routes absent rather than
 * registered-and-refusing.
 *
 * CI sets all four env vars 'true' for every job that runs this spec, so
 * nothing here needs to arrange access at all.
 *
 * test.describe.serial and the @serial tags are retained, but NOT because the
 * remaining tests depend on each other — COVM-03 deliberately queries a commit
 * and unit key that COVM-01 does not create, and asserts an empty array. They
 * are retained because COVM-01 writes coverage_units/coverage_test_links rows
 * in the shared coverage database, which coverage-pipeline.spec.ts also reads
 * and writes; see this file's entry in qa/e2e/apps/minicrm/resource-registry.ts,
 * which now declares that contention directly instead of the feature-flag rows
 * it used to.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No app-domain strings in framework layer
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import {
  startCoverageSession,
  recordCoverageSessionDump,
  resolveSessionBuildSha,
  resolveSessionEnvironment,
} from '@framework/coverageAgent/coverage-session-control-client.js';
import {
  findTestsForUnit,
  findUnitsForTest,
} from '@framework/coverageAgent/coverage-mapping-client.js';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

// ---------------------------------------------------------------------------
// COVM-01 — full round trip: dump -> session attribution -> ingest -> query
// ---------------------------------------------------------------------------

test('@functional @serial COVM-01: an ingested dump with test attribution is queryable both directions, with confidence attached', async ({
  restClient,
}) => {
  const session = await startCoverageSession(restClient, {
    label: 'coverage-mapping-spec',
    source: 'automated-e2e',
    buildSha: resolveSessionBuildSha(),
    environment: resolveSessionEnvironment(),
  });

  // Deliberately NOT sending CORRELATION_ID_HEADER on this call: the
  // dumpCoverageHandler auto-attributes any correlated dump to its session
  // as a side effect (MINCRM-610's "agent partitions by correlation ID"
  // path), but that auto-attribution carries no testId/testName. This spec
  // needs the dump attributed WITH test identity, via the explicit
  // recordCoverageSessionDump call below — sending the header here too would
  // race two attribution attempts for the same dumpId against
  // coverage_session_dumps' UNIQUE(dump_id) constraint and 409.
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
  );
  expect(dumpRes.status).toBe(201);
  const dumpId = dumpRes.body.dump['dumpId'] as string;
  const commitSha = dumpRes.body.dump['commitSha'] as string;

  const testFile = 'tests/apps/minicrm/functional/coverage-mapping/coverage-mapping.spec.ts';
  await recordCoverageSessionDump(restClient, session.id, {
    dumpId,
    correlationId: session.correlationId,
    testId: 'spec:coverage-mapping.spec.ts::COVM-01',
    testName: 'COVM-01 mapping round trip',
    testFile,
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
  // MINCRM-660 groundwork: testFile must survive the full dump -> session ->
  // ingest -> query round trip so a selected testId can be resolved back to
  // the spec file that produced it.
  expect(unitsForTest[0].testFile).toBe(testFile);

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

// COVM-02 removed (MINCRM-685): it asserted 403 FEATURE_DISABLED with the
// coverage_mapping_query row toggled off. The row no longer exists and the gate
// is now COVERAGE_MAPPING_QUERY at process boot, which no E2E spec can flip. The
// equivalent assertion — 404, routes never registered — lives in
// server/src/__tests__/coverageRouteGating.test.ts.

// ---------------------------------------------------------------------------
// COVM-03 — a unit no test covers returns an empty results array, not an error
// ---------------------------------------------------------------------------

test('@functional @serial COVM-03: querying a unit no test covers returns an empty results array', async ({
  restClient,
}) => {
  const results = await findTestsForUnit(restClient, {
    commitSha: 'coverage-mapping-spec-nonexistent-commit',
    unitKey: 'nonexistent#000',
  });

  expect(results).toEqual([]);
});
