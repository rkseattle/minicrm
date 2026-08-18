/**
 * Coverage/TIA mapping query API client. Consumed here to drill down from a
 * test to its covered code and back.
 * Thin typed wrapper over GET /admin/coverage/mapping/*.
 */

import apiClient from './axiosInstance.js';
import type {
  CoverageMappingResult,
  UnitKeySearchResult,
  TestIdSearchResult,
} from '@shared/schemas/coverageMappingSchema.js';

export const COVERAGE_TESTS_FOR_UNIT_QUERY_KEY = ['coverage', 'tests-for-unit'] as const;
export const COVERAGE_UNITS_FOR_TEST_QUERY_KEY = ['coverage', 'units-for-test'] as const;
export const COVERAGE_UNIT_KEYS_SEARCH_QUERY_KEY = ['coverage', 'unit-keys-search'] as const;
export const COVERAGE_TEST_IDS_SEARCH_QUERY_KEY = ['coverage', 'test-ids-search'] as const;

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

export async function searchUnitKeys(params: {
  commitSha: string;
  search: string;
}): Promise<UnitKeySearchResult[]> {
  const { data } = await apiClient.get<{ results: UnitKeySearchResult[] }>(
    '/admin/coverage/mapping/unit-keys/search',
    { params },
  );
  return data.results;
}

export async function searchTestIds(params: {
  commitSha: string;
  search: string;
}): Promise<TestIdSearchResult[]> {
  const { data } = await apiClient.get<{ results: TestIdSearchResult[] }>(
    '/admin/coverage/mapping/test-ids/search',
    { params },
  );
  return data.results;
}
