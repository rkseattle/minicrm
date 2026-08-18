/**
 * Overall + per-tier coverage, per-build view, trend over time,
 * filter by test type (automated E2E vs manual).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  COVERAGE_SUMMARY_QUERY_KEY,
  COVERAGE_TREND_QUERY_KEY,
  fetchCoverageSummary,
  fetchCoverageTrend,
} from '@/api/coverageReporting.js';
import StatTile from '@/components/StatTile.js';
import CoverageTrendChart from '@/components/CoverageTrendChart.js';
import RecentBuildSelect from '@/components/RecentBuildSelect.js';

type TestTypeFilter = 'all' | 'automated' | 'manual';

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export default function OverviewPage() {
  const [commitSha, setCommitSha] = useState('');
  const [submittedCommitSha, setSubmittedCommitSha] = useState('');
  const [testTypeFilter, setTestTypeFilter] = useState<TestTypeFilter>('all');

  const summaryQuery = useQuery({
    queryKey: [...COVERAGE_SUMMARY_QUERY_KEY, submittedCommitSha],
    queryFn: () => fetchCoverageSummary(submittedCommitSha),
    enabled: submittedCommitSha.length > 0,
    retry: false,
  });

  const trendQuery = useQuery({
    queryKey: COVERAGE_TREND_QUERY_KEY,
    queryFn: () => fetchCoverageTrend(30),
  });

  const summary = summaryQuery.data;
  const coveredUnitCountForFilter =
    testTypeFilter === 'automated'
      ? summary?.automatedCoveredUnitCount
      : testTypeFilter === 'manual'
        ? summary?.manualCoveredUnitCount
        : summary?.overallCoveredUnitCount;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Coverage Overview</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedCommitSha(commitSha.trim());
        }}
        className="mb-6 flex items-end gap-3"
        data-testid="commit-sha-form"
      >
        <RecentBuildSelect
          id="recentBuildSha"
          label="Recent builds"
          testId="recent-build-select"
          onSelect={(sha) => {
            setCommitSha(sha);
            setSubmittedCommitSha(sha);
          }}
        />

        <div>
          <label htmlFor="commitSha" className="mb-1 block text-sm font-medium text-gray-700">
            Build commit SHA
          </label>
          <input
            id="commitSha"
            value={commitSha}
            onChange={(e) => setCommitSha(e.target.value)}
            placeholder="e.g. a1b2c3d..."
            className="w-72 rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="commit-sha-input"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
          data-testid="commit-sha-submit-button"
        >
          Look up build
        </button>

        <div className="ml-4">
          <label htmlFor="testTypeFilter" className="mb-1 block text-sm font-medium text-gray-700">
            Test type
          </label>
          <select
            id="testTypeFilter"
            value={testTypeFilter}
            onChange={(e) => setTestTypeFilter(e.target.value as TestTypeFilter)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="test-type-filter-select"
          >
            <option value="all">All</option>
            <option value="automated">Automated E2E</option>
            <option value="manual">Manual</option>
          </select>
        </div>
      </form>

      {summaryQuery.isLoading && submittedCommitSha && (
        <p className="text-sm text-gray-500" data-testid="summary-loading">
          Loading build summary…
        </p>
      )}

      {summaryQuery.isError && (
        <p className="text-sm text-red-600" data-testid="summary-error">
          {(summaryQuery.error as { response?: { status?: number } })?.response?.status === 404
            ? 'No coverage has been ingested for this commit yet.'
            : 'Could not load the build summary.'}
        </p>
      )}

      {!submittedCommitSha && (
        <p className="text-sm text-gray-500" data-testid="summary-empty">
          Enter a build commit SHA to see its coverage summary.
        </p>
      )}

      {summary && (
        <div
          className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4"
          data-testid="summary-stat-tiles"
        >
          <StatTile
            label="Overall coverage"
            value={formatPercent(summary.overallCoveragePercent)}
            sublabel={`${summary.overallCoveredUnitCount} / ${summary.overallUnitCount} units`}
            testId="stat-tile-overall"
          />
          <StatTile
            label="API coverage"
            value={formatPercent(summary.apiCoveragePercent)}
            sublabel={`${summary.apiCoveredUnitCount} / ${summary.apiUnitCount} units`}
            testId="stat-tile-api"
          />
          <StatTile
            label="Frontend coverage"
            value={formatPercent(summary.frontendCoveragePercent)}
            sublabel={`${summary.frontendCoveredUnitCount} / ${summary.frontendUnitCount} units`}
            testId="stat-tile-frontend"
          />
          <StatTile
            label={
              testTypeFilter === 'all'
                ? 'Covered units'
                : testTypeFilter === 'automated'
                  ? 'Covered by automated E2E'
                  : 'Covered by manual testing'
            }
            value={String(coveredUnitCountForFilter ?? 0)}
            testId="stat-tile-test-type"
          />
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold text-gray-900">Trend (last 30 builds)</h2>
      {trendQuery.isLoading && <p className="text-sm text-gray-500">Loading trend…</p>}
      {trendQuery.data && <CoverageTrendChart summaries={trendQuery.data} />}
    </div>
  );
}
