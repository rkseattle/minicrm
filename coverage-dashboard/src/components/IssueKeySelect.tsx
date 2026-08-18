/**
 * Dropdown of every issue key with a recorded coverage session for a given
 * commit. Unlike unit keys/test IDs, this needs no
 * typeahead: the set of issue keys touched by one build is small (bounded
 * by manual-testing sessions checked in against it), so listing all of
 * them is cheap and a plain dropdown is the right UI — see
 * listIssueKeysForCommit's own docblock (coverageReportingService.ts).
 */

import { useQuery } from '@tanstack/react-query';
import { COVERAGE_ISSUE_KEYS_QUERY_KEY, fetchIssueKeys } from '@/api/coverageReporting.js';

interface IssueKeySelectProps {
  id: string;
  label: string;
  testId: string;
  commitSha: string;
  onSelect: (issueKey: string) => void;
}

export default function IssueKeySelect({
  id,
  label,
  testId,
  commitSha,
  onSelect,
}: IssueKeySelectProps) {
  const issueKeysQuery = useQuery({
    queryKey: [...COVERAGE_ISSUE_KEYS_QUERY_KEY, commitSha],
    queryFn: () => fetchIssueKeys(commitSha),
    enabled: commitSha.length > 0,
    retry: false,
  });

  if (commitSha.length === 0) {
    return null;
  }

  if (issueKeysQuery.isLoading) {
    return (
      <p className="text-xs text-gray-500" data-testid={`${testId}-loading`}>
        Loading issue keys…
      </p>
    );
  }

  if (!issueKeysQuery.data || issueKeysQuery.data.length === 0) {
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
          const issueKey = e.target.value;
          if (!issueKey) return;
          onSelect(issueKey);
        }}
        className="w-56 rounded-md border border-gray-300 px-3 py-2 text-sm"
        data-testid={testId}
      >
        <option value="">Pick an issue…</option>
        {issueKeysQuery.data.map((issueKey) => (
          <option key={issueKey} value={issueKey}>
            {issueKey}
          </option>
        ))}
      </select>
    </div>
  );
}
