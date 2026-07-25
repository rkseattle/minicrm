/**
 * Coverage/TIA mapping query API client. (MINCRM-621, consumed here for
 * MINCRM-631's "drill-down from a test to its covered code and back" AC)
 * Thin typed wrapper over GET /admin/coverage/mapping/*.
 */

import apiClient from './axiosInstance.js';
import type { CoverageMappingResult } from '@shared/schemas/coverageMappingSchema.js';

export const COVERAGE_TESTS_FOR_UNIT_QUERY_KEY = ['coverage', 'tests-for-unit'] as const;
export const COVERAGE_UNITS_FOR_TEST_QUERY_KEY = ['coverage', 'units-for-test'] as const;

export async function fetchTestsForUnit(params: {
  commitSha: string;
  unitKey: string;
  branchId?: string;
}): Promise<CoverageMappingResult[]> {
  const { data } = await apiClient.get<{ results: CoverageMappingResult[] }>(
    '/admin/coverage/mapping/tests-for-unit',
    { params },
  );
  return data.results;
}

export async function fetchUnitsForTest(params: {
  commitSha: string;
  testId: string;
}): Promise<CoverageMappingResult[]> {
  const { data } = await apiClient.get<{ results: CoverageMappingResult[] }>(
    '/admin/coverage/mapping/units-for-test',
    { params },
  );
  return data.results;
}
