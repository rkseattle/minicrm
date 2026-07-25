/**
 * Reference client for the coverage mapping query endpoints. Thin wrapper
 * around RestClient — mirrors coverage-pipeline-client.ts's own role as the
 * canonical, tested example referenced from docs/dev/coverage.md's
 * "reference client" section.
 *
 * Requires an authenticated RestClient (admin session) and the
 * coverage_mapping_query feature flag enabled, since both endpoints are
 * admin-only and flag-gated.
 */

import type { RestClient } from '../clients/rest-client.js';

const TESTS_FOR_UNIT_ENDPOINT = '/api/v1/admin/coverage/mapping/tests-for-unit';
const UNITS_FOR_TEST_ENDPOINT = '/api/v1/admin/coverage/mapping/units-for-test';

/** A single mapping result — see shared/schemas/coverageMappingSchema.ts's own coverageMappingResultSchema (the source of truth this mirrors). */
export interface CoverageMappingResult {
  commitSha: string;
  unitKey: string;
  branchId: string | null;
  filePath: string;
  testId: string;
  testName: string | null;
  testFile: string | null;
  hitCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  confidenceScore: number | null;
  lastReconciledAt: string | null;
}

/** Finds every test known to cover a given code unit, at a given commit. */
export async function findTestsForUnit(
  restClient: RestClient,
  params: { commitSha: string; unitKey: string; branchId?: string },
): Promise<CoverageMappingResult[]> {
  const query = new URLSearchParams({ commitSha: params.commitSha, unitKey: params.unitKey });
  if (params.branchId) {
    query.set('branchId', params.branchId);
  }
  const response = await restClient.get<{ results: CoverageMappingResult[] }>(
    `${TESTS_FOR_UNIT_ENDPOINT}?${query.toString()}`,
  );
  return response.body.results;
}

/** Finds every code unit a given test is known to cover, at a given commit. */
export async function findUnitsForTest(
  restClient: RestClient,
  params: { commitSha: string; testId: string },
): Promise<CoverageMappingResult[]> {
  const query = new URLSearchParams({ commitSha: params.commitSha, testId: params.testId });
  const response = await restClient.get<{ results: CoverageMappingResult[] }>(
    `${UNITS_FOR_TEST_ENDPOINT}?${query.toString()}`,
  );
  return response.body.results;
}
