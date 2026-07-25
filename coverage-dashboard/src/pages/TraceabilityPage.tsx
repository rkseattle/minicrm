/**
 * MINCRM-631: per-issue traceability + TIA value metrics — map coverage to
 * MiniCRM issue keys, report TIA selection value metrics over a commit
 * range, and drill down from a test to its covered code (and back).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  COVERAGE_ISSUE_QUERY_KEY,
  COVERAGE_TIA_METRICS_QUERY_KEY,
  fetchIssueCoverage,
  fetchTiaValueMetrics,
} from '@/api/coverageReporting.js';
import {
  COVERAGE_UNITS_FOR_TEST_QUERY_KEY,
  COVERAGE_TESTS_FOR_UNIT_QUERY_KEY,
  fetchUnitsForTest,
  fetchTestsForUnit,
} from '@/api/coverageMapping.js';
import StatTile from '@/components/StatTile.js';

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function IssueCoverageSection() {
  const [issueKey, setIssueKey] = useState('');
  const [commitSha, setCommitSha] = useState('');
  const [submitted, setSubmitted] = useState<{ issueKey: string; commitSha: string } | null>(null);

  const issueQuery = useQuery({
    queryKey: [...COVERAGE_ISSUE_QUERY_KEY, submitted?.issueKey, submitted?.commitSha],
    queryFn: () => fetchIssueCoverage(submitted!.issueKey, submitted!.commitSha),
    enabled: submitted !== null,
    retry: false,
  });

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold text-gray-900">Per-Issue Coverage</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted({ issueKey: issueKey.trim(), commitSha: commitSha.trim() });
        }}
        className="mb-4 flex items-end gap-3"
        data-testid="issue-coverage-form"
      >
        <div>
          <label htmlFor="issueKey" className="mb-1 block text-sm font-medium text-gray-700">
            Issue key
          </label>
          <input
            id="issueKey"
            value={issueKey}
            onChange={(e) => setIssueKey(e.target.value)}
            placeholder="e.g. MINCRM-123"
            className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="issue-key-input"
          />
        </div>
        <div>
          <label htmlFor="issueCommitSha" className="mb-1 block text-sm font-medium text-gray-700">
            Build commit SHA
          </label>
          <input
            id="issueCommitSha"
            value={commitSha}
            onChange={(e) => setCommitSha(e.target.value)}
            placeholder="e.g. a1b2c3d..."
            className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="issue-commit-sha-input"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
          data-testid="issue-coverage-submit-button"
        >
          Look up coverage
        </button>
      </form>

      {issueQuery.isLoading && (
        <p className="text-sm text-gray-500" data-testid="issue-coverage-loading">
          Loading issue coverage…
        </p>
      )}
      {issueQuery.isError && (
        <p className="text-sm text-red-600" data-testid="issue-coverage-error">
          Could not load coverage for this issue.
        </p>
      )}
      {!submitted && (
        <p className="text-sm text-gray-500" data-testid="issue-coverage-empty">
          Enter an issue key and build commit SHA to see its coverage rollup.
        </p>
      )}

      {issueQuery.data && (
        <div
          className="grid grid-cols-2 gap-4 sm:grid-cols-3"
          data-testid="issue-coverage-stat-tiles"
        >
          <StatTile
            label="Sessions"
            value={String(issueQuery.data.sessionCount)}
            testId="stat-tile-issue-sessions"
          />
          <StatTile
            label="Covered units"
            value={String(issueQuery.data.coveredUnitCount)}
            testId="stat-tile-issue-covered-units"
          />
          <StatTile
            label="Tests"
            value={String(issueQuery.data.testIds.length)}
            sublabel={issueQuery.data.testIds.slice(0, 3).join(', ')}
            testId="stat-tile-issue-tests"
          />
        </div>
      )}
    </section>
  );
}

function TiaValueMetricsSection() {
  const [fromSha, setFromSha] = useState('');
  const [toSha, setToSha] = useState('');
  const [submitted, setSubmitted] = useState<{ fromSha: string; toSha: string } | null>(null);

  const metricsQuery = useQuery({
    queryKey: [...COVERAGE_TIA_METRICS_QUERY_KEY, submitted?.fromSha, submitted?.toSha],
    queryFn: () => fetchTiaValueMetrics(submitted!.fromSha, submitted!.toSha),
    enabled: submitted !== null,
    retry: false,
  });

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold text-gray-900">TIA Value Metrics</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted({ fromSha: fromSha.trim(), toSha: toSha.trim() });
        }}
        className="mb-4 flex items-end gap-3"
        data-testid="tia-metrics-form"
      >
        <div>
          <label htmlFor="fromSha" className="mb-1 block text-sm font-medium text-gray-700">
            From SHA
          </label>
          <input
            id="fromSha"
            value={fromSha}
            onChange={(e) => setFromSha(e.target.value)}
            className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="tia-from-sha-input"
          />
        </div>
        <div>
          <label htmlFor="toSha" className="mb-1 block text-sm font-medium text-gray-700">
            To SHA
          </label>
          <input
            id="toSha"
            value={toSha}
            onChange={(e) => setToSha(e.target.value)}
            className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="tia-to-sha-input"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
          data-testid="tia-metrics-submit-button"
        >
          Compute metrics
        </button>
      </form>

      {metricsQuery.isLoading && (
        <p className="text-sm text-gray-500" data-testid="tia-metrics-loading">
          Loading TIA value metrics…
        </p>
      )}
      {metricsQuery.isError && (
        <p className="text-sm text-red-600" data-testid="tia-metrics-error">
          Could not load TIA value metrics for this range.
        </p>
      )}
      {!submitted && (
        <p className="text-sm text-gray-500" data-testid="tia-metrics-empty">
          Enter a from/to commit SHA range to see TIA value metrics.
        </p>
      )}

      {metricsQuery.data && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="tia-metrics-stat-tiles">
          <StatTile
            label="Builds in range"
            value={String(metricsQuery.data.totalBuilds)}
            testId="stat-tile-tia-total-builds"
          />
          <StatTile
            label="Avg API coverage"
            value={formatPercent(metricsQuery.data.averageApiCoveragePercent)}
            testId="stat-tile-tia-avg-api"
          />
          <StatTile
            label="Avg frontend coverage"
            value={formatPercent(metricsQuery.data.averageFrontendCoveragePercent)}
            testId="stat-tile-tia-avg-frontend"
          />
        </div>
      )}
    </section>
  );
}

type DrillDownDirection = 'unit-to-tests' | 'test-to-units';

function DrillDownSection() {
  const [direction, setDirection] = useState<DrillDownDirection>('unit-to-tests');
  const [commitSha, setCommitSha] = useState('');
  const [unitKey, setUnitKey] = useState('');
  const [testId, setTestId] = useState('');
  const [submitted, setSubmitted] = useState<{
    direction: DrillDownDirection;
    commitSha: string;
    unitKey: string;
    testId: string;
  } | null>(null);

  const unitsForTestQuery = useQuery({
    queryKey: [...COVERAGE_UNITS_FOR_TEST_QUERY_KEY, submitted?.commitSha, submitted?.testId],
    queryFn: () =>
      fetchUnitsForTest({ commitSha: submitted!.commitSha, testId: submitted!.testId }),
    enabled: submitted !== null && submitted.direction === 'test-to-units',
    retry: false,
  });

  const testsForUnitQuery = useQuery({
    queryKey: [...COVERAGE_TESTS_FOR_UNIT_QUERY_KEY, submitted?.commitSha, submitted?.unitKey],
    queryFn: () =>
      fetchTestsForUnit({ commitSha: submitted!.commitSha, unitKey: submitted!.unitKey }),
    enabled: submitted !== null && submitted.direction === 'unit-to-tests',
    retry: false,
  });

  const activeQuery = direction === 'unit-to-tests' ? testsForUnitQuery : unitsForTestQuery;

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-gray-900">Test ↔ Code Drill-Down</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted({
            direction,
            commitSha: commitSha.trim(),
            unitKey: unitKey.trim(),
            testId: testId.trim(),
          });
        }}
        className="mb-4 flex items-end gap-3"
        data-testid="drilldown-form"
      >
        <div>
          <label
            htmlFor="drilldownDirection"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Direction
          </label>
          <select
            id="drilldownDirection"
            value={direction}
            onChange={(e) => setDirection(e.target.value as DrillDownDirection)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="drilldown-direction-select"
          >
            <option value="unit-to-tests">Code unit → tests</option>
            <option value="test-to-units">Test → code units</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="drilldownCommitSha"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Build commit SHA
          </label>
          <input
            id="drilldownCommitSha"
            value={commitSha}
            onChange={(e) => setCommitSha(e.target.value)}
            className="w-56 rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="drilldown-commit-sha-input"
          />
        </div>
        {direction === 'unit-to-tests' ? (
          <div>
            <label
              htmlFor="drilldownUnitKey"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Unit key
            </label>
            <input
              id="drilldownUnitKey"
              value={unitKey}
              onChange={(e) => setUnitKey(e.target.value)}
              placeholder="e.g. render#abc123"
              className="w-56 rounded-md border border-gray-300 px-3 py-2 text-sm"
              data-testid="drilldown-unit-key-input"
            />
          </div>
        ) : (
          <div>
            <label
              htmlFor="drilldownTestId"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Test ID
            </label>
            <input
              id="drilldownTestId"
              value={testId}
              onChange={(e) => setTestId(e.target.value)}
              placeholder="e.g. spec:deals.spec.ts::test"
              className="w-56 rounded-md border border-gray-300 px-3 py-2 text-sm"
              data-testid="drilldown-test-id-input"
            />
          </div>
        )}
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
          data-testid="drilldown-submit-button"
        >
          Look up
        </button>
      </form>

      {activeQuery.isLoading && (
        <p className="text-sm text-gray-500" data-testid="drilldown-loading">
          Loading…
        </p>
      )}
      {activeQuery.isError && (
        <p className="text-sm text-red-600" data-testid="drilldown-error">
          Could not load drill-down results.
        </p>
      )}
      {!submitted && (
        <p className="text-sm text-gray-500" data-testid="drilldown-empty">
          Choose a direction and enter the required fields to drill down.
        </p>
      )}

      {activeQuery.data && (
        <>
          {activeQuery.data.length === 0 ? (
            <p className="text-sm text-gray-500" data-testid="drilldown-results-empty">
              No results found.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table
                className="min-w-full divide-y divide-gray-200 text-sm"
                data-testid="drilldown-table"
              >
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-gray-500">
                    <th className="px-4 py-2">File</th>
                    <th className="px-4 py-2">Unit key</th>
                    <th className="px-4 py-2">Test</th>
                    <th className="px-4 py-2">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activeQuery.data.map((result, index) => (
                    <tr key={index} data-testid={`drilldown-row-${index}`}>
                      <td className="px-4 py-2 font-mono text-xs">{result.filePath}</td>
                      <td className="px-4 py-2 font-mono text-xs">{result.unitKey}</td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {result.testName ?? result.testId}
                      </td>
                      <td className="px-4 py-2">
                        {result.confidenceScore !== null
                          ? `${(result.confidenceScore * 100).toFixed(0)}%`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function TraceabilityPage() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Traceability &amp; TIA Value</h1>
      <IssueCoverageSection />
      <TiaValueMetricsSection />
      <DrillDownSection />
    </div>
  );
}
