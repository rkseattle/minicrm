/**
 * MINCRM-630: gap analysis — dead zones (never-exercised code), changed-but-
 * untested code for a base..head range, never-taken branches distinguished
 * from function-level dead zones, exportable gap list.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { COVERAGE_GAPS_QUERY_KEY, fetchCoverageGaps } from '@/api/coverageReporting.js';
import { exportRowsAsCsv, exportRowsAsJson } from '@/utils/exportGaps.js';

type GapTab = 'dead-zones' | 'never-taken-branches' | 'changed-untested';

export default function GapsPage() {
  const [commitSha, setCommitSha] = useState('');
  const [baseSha, setBaseSha] = useState('');
  const [submitted, setSubmitted] = useState<{ commitSha: string; baseSha: string } | null>(null);
  const [activeTab, setActiveTab] = useState<GapTab>('dead-zones');

  const gapsQuery = useQuery({
    queryKey: [...COVERAGE_GAPS_QUERY_KEY, submitted?.commitSha, submitted?.baseSha],
    queryFn: () =>
      fetchCoverageGaps({
        commitSha: submitted!.commitSha,
        baseSha: submitted!.baseSha.length > 0 ? submitted!.baseSha : undefined,
      }),
    enabled: submitted !== null,
    retry: false,
  });

  const gaps = gapsQuery.data;

  const activeRows =
    activeTab === 'dead-zones'
      ? (gaps?.deadZoneUnits ?? [])
      : activeTab === 'never-taken-branches'
        ? (gaps?.neverTakenBranches ?? [])
        : (gaps?.changedUntestedUnits ?? []);

  function handleExport(format: 'csv' | 'json'): void {
    const filename = `coverage-gaps-${activeTab}-${submitted?.commitSha ?? 'unknown'}.${format}`;
    if (format === 'csv') {
      // Cast is safe: activeRows is always one of two flat, JSON-serializable
      // row shapes (DeadZoneUnit or ChangedUntestedUnit) — exportRowsAsCsv
      // only needs Object.keys()/String() over each row's own fields.
      exportRowsAsCsv(activeRows as unknown as Record<string, unknown>[], filename);
    } else {
      exportRowsAsJson(activeRows, filename);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Gap Analysis</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted({ commitSha: commitSha.trim(), baseSha: baseSha.trim() });
        }}
        className="mb-6 flex items-end gap-3"
        data-testid="gaps-form"
      >
        <div>
          <label htmlFor="gapsCommitSha" className="mb-1 block text-sm font-medium text-gray-700">
            Build commit SHA
          </label>
          <input
            id="gapsCommitSha"
            value={commitSha}
            onChange={(e) => setCommitSha(e.target.value)}
            placeholder="e.g. a1b2c3d..."
            className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="gaps-commit-sha-input"
          />
        </div>
        <div>
          <label htmlFor="gapsBaseSha" className="mb-1 block text-sm font-medium text-gray-700">
            Base SHA (optional, for changed-but-untested)
          </label>
          <input
            id="gapsBaseSha"
            value={baseSha}
            onChange={(e) => setBaseSha(e.target.value)}
            placeholder="e.g. base commit..."
            className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="gaps-base-sha-input"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
          data-testid="gaps-submit-button"
        >
          Find gaps
        </button>
      </form>

      {gapsQuery.isLoading && (
        <p className="text-sm text-gray-500" data-testid="gaps-loading">
          Loading gap analysis…
        </p>
      )}

      {gapsQuery.isError && (
        <p className="text-sm text-red-600" data-testid="gaps-error">
          Could not load gap analysis for this build.
        </p>
      )}

      {!submitted && (
        <p className="text-sm text-gray-500" data-testid="gaps-empty">
          Enter a build commit SHA to see its gap analysis.
        </p>
      )}

      {gaps && (
        <>
          <div className="mb-4 flex items-center justify-between border-b border-gray-200">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('dead-zones')}
                className={`rounded-t-md px-3 py-2 text-sm font-medium ${
                  activeTab === 'dead-zones'
                    ? 'border-b-2 border-indigo-600 text-indigo-700'
                    : 'text-gray-600'
                }`}
                data-testid="gaps-tab-dead-zones"
              >
                Dead zones ({gaps.deadZoneUnits.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('never-taken-branches')}
                className={`rounded-t-md px-3 py-2 text-sm font-medium ${
                  activeTab === 'never-taken-branches'
                    ? 'border-b-2 border-indigo-600 text-indigo-700'
                    : 'text-gray-600'
                }`}
                data-testid="gaps-tab-never-taken-branches"
              >
                Never-taken branches ({gaps.neverTakenBranches.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('changed-untested')}
                disabled={gaps.changedUntestedUnits === null}
                className={`rounded-t-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                  activeTab === 'changed-untested'
                    ? 'border-b-2 border-indigo-600 text-indigo-700'
                    : 'text-gray-600'
                }`}
                data-testid="gaps-tab-changed-untested"
              >
                Changed but untested
                {gaps.changedUntestedUnits !== null ? ` (${gaps.changedUntestedUnits.length})` : ''}
              </button>
            </div>
            <div className="flex gap-2 pb-2">
              <button
                type="button"
                onClick={() => handleExport('csv')}
                disabled={activeRows.length === 0}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-40"
                data-testid="gaps-export-csv-button"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => handleExport('json')}
                disabled={activeRows.length === 0}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-40"
                data-testid="gaps-export-json-button"
              >
                Export JSON
              </button>
            </div>
          </div>

          {activeTab === 'changed-untested' && gaps.changedUntestedUnits === null ? (
            <p className="text-sm text-gray-500" data-testid="gaps-changed-untested-unavailable">
              Enter a base SHA above to see changed-but-untested code for this range.
            </p>
          ) : activeRows.length === 0 ? (
            <p className="text-sm text-gray-500" data-testid="gaps-tab-empty">
              No gaps found in this category.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table
                className="min-w-full divide-y divide-gray-200 text-sm"
                data-testid="gaps-table"
              >
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-gray-500">
                    <th className="px-4 py-2">File</th>
                    <th className="px-4 py-2">Unit key</th>
                    {activeTab === 'changed-untested' ? (
                      <th className="px-4 py-2">Change kind</th>
                    ) : (
                      <>
                        <th className="px-4 py-2">Branch</th>
                        <th className="px-4 py-2">Granularity</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activeRows.map((row, index) => (
                    // unitKey/filePath pairs aren't guaranteed unique across
                    // identical structural units in different branches, so
                    // index is the only stable key available here.
                    <tr key={index} data-testid={`gaps-row-${index}`}>
                      <td className="px-4 py-2 font-mono text-xs">{row.filePath}</td>
                      <td className="px-4 py-2 font-mono text-xs">{row.unitKey}</td>
                      {'changeKind' in row ? (
                        <td className="px-4 py-2">{row.changeKind}</td>
                      ) : (
                        <>
                          <td className="px-4 py-2 font-mono text-xs">{row.branchId ?? '—'}</td>
                          <td className="px-4 py-2">{row.granularity}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
