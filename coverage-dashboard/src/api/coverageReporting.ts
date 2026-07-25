/**
 * Coverage/TIA reporting query API client. (MINCRM-629/630/631)
 * Thin typed wrapper over GET /admin/coverage/reporting/* — the only
 * reporting data source this app is allowed to use (MINCRM-628's "reads
 * from the mapping/coverage store via its query API only" AC).
 */

import apiClient from './axiosInstance.js';
import type {
  CoverageSummary,
  DeadZoneUnit,
  ChangedUntestedUnit,
  IssueCoverage,
  TiaValueMetrics,
} from '@shared/schemas/coverageReportingSchema.js';

export const COVERAGE_SUMMARY_QUERY_KEY = ['coverage', 'summary'] as const;
export const COVERAGE_TREND_QUERY_KEY = ['coverage', 'trend'] as const;
export const COVERAGE_GAPS_QUERY_KEY = ['coverage', 'gaps'] as const;
export const COVERAGE_ISSUE_QUERY_KEY = ['coverage', 'issue'] as const;
export const COVERAGE_TIA_METRICS_QUERY_KEY = ['coverage', 'tia-metrics'] as const;

export async function fetchCoverageSummary(commitSha: string): Promise<CoverageSummary> {
  const { data } = await apiClient.get<{ summary: CoverageSummary }>(
    '/admin/coverage/reporting/summary',
    { params: { commitSha } },
  );
  return data.summary;
}

export async function fetchCoverageTrend(limit = 30): Promise<CoverageSummary[]> {
  const { data } = await apiClient.get<{ results: CoverageSummary[] }>(
    '/admin/coverage/reporting/trend',
    { params: { limit } },
  );
  return data.results;
}

export interface CoverageGaps {
  deadZoneUnits: DeadZoneUnit[];
  neverTakenBranches: DeadZoneUnit[];
  changedUntestedUnits: ChangedUntestedUnit[] | null;
}

export async function fetchCoverageGaps(params: {
  commitSha: string;
  baseSha?: string;
  limit?: number;
}): Promise<CoverageGaps> {
  const { data } = await apiClient.get<CoverageGaps>('/admin/coverage/reporting/gaps', {
    params,
  });
  return data;
}

export async function fetchIssueCoverage(
  issueKey: string,
  commitSha: string,
): Promise<IssueCoverage> {
  const { data } = await apiClient.get<{ coverage: IssueCoverage }>(
    `/admin/coverage/reporting/issues/${encodeURIComponent(issueKey)}/coverage`,
    { params: { commitSha } },
  );
  return data.coverage;
}

export async function fetchTiaValueMetrics(
  fromSha: string,
  toSha: string,
): Promise<TiaValueMetrics> {
  const { data } = await apiClient.get<{ metrics: TiaValueMetrics }>(
    '/admin/coverage/reporting/tia-metrics',
    { params: { fromSha, toSha } },
  );
  return data.metrics;
}
