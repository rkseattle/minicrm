/**
 * Manual-testing coverage session recorder. (MINCRM-609..612, MINCRM-663)
 * Moved here from minicrm-client's CoverageSessionRecorderPage.tsx, which is
 * deleted entirely — internal CI/dev tooling has no business being
 * reachable through the product's own admin UI. Behavior is unchanged: an
 * admin checks in (names the session, optionally ties it to a MiniCRM issue
 * key), records while exercising the CRM app in a separate tab (the
 * correlation-ID header is injected on THIS tab's own requests, which is a
 * no-op unless something in this app itself is being coverage-measured —
 * see pullBrowserCoverage's own comment), and checks out to trigger a dump
 * and end the session.
 *
 * Dump attribution is automatic server-side (see
 * attributeDumpToSessionIfCorrelated in coverageController.ts): every
 * request carrying x-coverage-correlation-id while recording is attributed
 * to the active session that correlation ID belongs to without a separate
 * client-side call — calling the record-dump endpoint explicitly here as
 * well would just 409 on the dump ID the auto-attribution path already
 * claimed.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/axiosInstance.js';
import {
  startCoverageSession,
  endCoverageSession,
  listActiveCoverageSessions,
  COVERAGE_SESSIONS_QUERY_KEY,
} from '@/api/coverageSessions.js';
import { CORRELATION_ID_HEADER } from '@shared/schemas/coverageSessionSchema.js';
import type { CoverageSession } from '@shared/schemas/coverageSessionSchema.js';

const COVERAGE_DUMP_ENDPOINT = '/admin/coverage/dump';

interface CoverageDumpResponse {
  dump: { dumpId: string };
}

/**
 * Reads window.__coverage__ from this same tab. Present only when THIS app's
 * own served bundle was built with browser coverage instrumentation — this
 * dashboard is not itself an instrumented subject of the coverage system it
 * reports on (see vite.config.ts's own docblock), so in practice this is
 * almost always undefined here; the recorder is retained for parity with
 * the CRM client's manual-testing workflow (an admin recording coverage
 * while exercising the CRM in a separate browser tab that DOES carry the
 * correlation header via its own requests, not this dashboard's).
 */
function pullBrowserCoverage(): Record<string, unknown> | undefined {
  const globalWithCoverage = window as unknown as { __coverage__?: Record<string, unknown> };
  return globalWithCoverage.__coverage__;
}

export default function SessionRecorderPage() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [issueKey, setIssueKey] = useState('');
  const [recordingSession, setRecordingSession] = useState<CoverageSession | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (recordingSession) {
        delete apiClient.defaults.headers.common[CORRELATION_ID_HEADER];
      }
    };
  }, [recordingSession]);

  const {
    data: activeSessionsResponse,
    isLoading,
    isError,
  } = useQuery({
    queryKey: COVERAGE_SESSIONS_QUERY_KEY,
    queryFn: () => listActiveCoverageSessions(),
  });
  const activeSessions = activeSessionsResponse?.data ?? [];

  const checkInMutation = useMutation({
    mutationFn: () =>
      startCoverageSession({
        label: label.trim(),
        source: 'manual',
        buildSha: import.meta.env['VITE_BUILD_SHA'] ?? 'unknown',
        environment: import.meta.env.MODE,
        issueKey: issueKey.trim() || undefined,
      }),
    onSuccess: (session) => {
      apiClient.defaults.headers.common[CORRELATION_ID_HEADER] = session.correlationId;
      setRecordingSession(session);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: COVERAGE_SESSIONS_QUERY_KEY });
    },
    onError: () => setActionError('Could not start the session — please try again.'),
  });

  const checkOutMutation = useMutation({
    mutationFn: async (session: CoverageSession) => {
      const coverageMap = pullBrowserCoverage();
      if (coverageMap && Object.keys(coverageMap).length > 0) {
        await apiClient
          .post<CoverageDumpResponse>(COVERAGE_DUMP_ENDPOINT, {
            label: session.label,
            source: 'browser',
            payload: coverageMap,
          })
          .catch(() => undefined);
      }
      return endCoverageSession(session.id, session.version);
    },
    onSuccess: () => {
      delete apiClient.defaults.headers.common[CORRELATION_ID_HEADER];
      setRecordingSession(null);
      setLabel('');
      setIssueKey('');
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: COVERAGE_SESSIONS_QUERY_KEY });
    },
    onError: () => setActionError('Could not end the session — please try again.'),
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1
        className="mb-2 text-2xl font-semibold text-gray-900"
        data-testid="coverage-session-recorder-heading"
      >
        Manual Testing Session Recorder
      </h1>
      <p className="mb-6 text-sm text-gray-600">
        Check in before exploratory testing, check out when done to record what you covered.
      </p>

      {actionError && (
        <p
          role="alert"
          className="mb-4 text-sm text-red-600"
          data-testid="coverage-session-recorder-action-error"
        >
          {actionError}
        </p>
      )}

      {!recordingSession && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
          <div className="mb-4">
            <label
              htmlFor="coverage-session-label"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Session label
            </label>
            <input
              id="coverage-session-label"
              type="text"
              data-testid="coverage-session-label-input"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="mb-4">
            <label
              htmlFor="coverage-session-issue-key"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Issue key (optional)
            </label>
            <input
              id="coverage-session-issue-key"
              type="text"
              data-testid="coverage-session-issue-key-input"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
              value={issueKey}
              onChange={(e) => setIssueKey(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={label.trim().length === 0 || checkInMutation.isPending}
            onClick={() => checkInMutation.mutate()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="coverage-session-check-in-button"
          >
            {checkInMutation.isPending ? 'Checking in…' : 'Check in'}
          </button>
        </div>
      )}

      {recordingSession && (
        <div
          className="mb-6 rounded-lg border border-indigo-200 bg-white p-6"
          data-testid="coverage-session-recording-panel"
        >
          <p className="mb-1 text-sm font-medium text-indigo-700">
            Recording: {recordingSession.label}
          </p>
          <p className="mb-4 text-xs text-gray-500">
            Since {new Date(recordingSession.startedAt).toLocaleString()}
          </p>
          <button
            type="button"
            disabled={checkOutMutation.isPending}
            onClick={() => checkOutMutation.mutate(recordingSession)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
            data-testid="coverage-session-check-out-button"
          >
            {checkOutMutation.isPending ? 'Checking out…' : 'Check out'}
          </button>
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold text-gray-900">Active sessions</h2>

      {isLoading && (
        <div className="space-y-2" aria-hidden="true">
          <div className="h-4 w-48 animate-pulse rounded bg-gray-100" />
          <div className="h-16 w-full animate-pulse rounded bg-gray-100" />
        </div>
      )}

      {isError && (
        <p
          role="alert"
          className="text-sm text-red-600"
          data-testid="coverage-session-recorder-load-error"
        >
          Could not load active sessions.
        </p>
      )}

      {!isLoading && !isError && activeSessions.length === 0 && (
        <p className="text-sm text-gray-500" data-testid="coverage-session-recorder-empty">
          No active sessions.
        </p>
      )}

      {!isLoading && !isError && activeSessions.length > 0 && (
        <ul
          className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white"
          data-testid="coverage-session-list"
        >
          {activeSessions.map((session) => (
            <li
              key={session.id}
              className="flex items-center justify-between gap-2 px-4 py-3"
              data-testid={`coverage-session-${session.id}`}
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{session.label}</p>
                <p className="text-xs text-gray-500">
                  {session.source} · {new Date(session.startedAt).toLocaleString()}
                  {session.issueKey ? ` · ${session.issueKey}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
