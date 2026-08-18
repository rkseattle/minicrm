/**
 * Dropdown of recent builds (commit SHA + date + overall coverage %),
 * backed by the trend endpoint's own data — every page with a commit-SHA
 * field also needs this, since a bare free-text input requires a caller to
 * already know a real SHA off the top of their head.
 *
 * Deliberately NOT the only way to pick a commit SHA: an older build past
 * the trend window's 30-build cap has no entry here, so the free-text
 * input this always accompanies stays the fallback for that case.
 */

import { useQuery } from '@tanstack/react-query';
import { COVERAGE_TREND_QUERY_KEY, fetchCoverageTrend } from '@/api/coverageReporting.js';

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

interface RecentBuildSelectProps {
  id: string;
  label: string;
  testId: string;
  onSelect: (commitSha: string) => void;
}

export default function RecentBuildSelect({ id, label, testId, onSelect }: RecentBuildSelectProps) {
  const trendQuery = useQuery({
    queryKey: COVERAGE_TREND_QUERY_KEY,
    queryFn: () => fetchCoverageTrend(30),
  });

  if (!trendQuery.data || trendQuery.data.length === 0) {
    return null;
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      <select
        id={id}
        value=""
        onChange={(e) => {
          const sha = e.target.value;
          if (!sha) return;
          onSelect(sha);
        }}
        className="w-72 rounded-md border border-gray-300 px-3 py-2 text-sm"
        data-testid={testId}
      >
        <option value="">Pick a recent build…</option>
        {trendQuery.data.map((build) => (
          <option key={build.commitSha} value={build.commitSha}>
            {build.commitSha.slice(0, 8)} — {new Date(build.lastUpdatedAt).toLocaleDateString()} —{' '}
            {formatPercent(build.overallCoveragePercent)}
          </option>
        ))}
      </select>
    </div>
  );
}
