/**
 * CoverageSessionRecorderPage component. (MINCRM-611)
 * Manual-testing coverage session recorder — an admin checks in (names the
 * session, optionally ties it to a MiniCRM issue key), records while
 * exercising the app in this same browser tab (the correlation-ID header is
 * injected for the duration via the shared axios instance), and checks out
 * to trigger a dump and end the session.
 *
 * Dump attribution is automatic server-side (see
 * attributeDumpToSessionIfCorrelated in coverageController.ts): because every
 * request from this tab already carries x-coverage-correlation-id while
 * recording, the dump POST below is attributed to the active session that
 * correlation ID belongs to without a separate client-side call — calling
 * the record-dump endpoint explicitly here as well would just 409 on the
 * dump ID the auto-attribution path already claimed.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import NavBar from '@/components/NavBar.js';
import { Button } from '@/components/ui/Button.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
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

export default function CoverageSessionRecorderPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { enabled: featureEnabled, isLoading: featureFlagLoading } = useFeatureFlag(
    'coverage_session_management',
  );
  const [label, setLabel] = useState('');
  const [issueKey, setIssueKey] = useState('');
  const [recordingSession, setRecordingSession] = useState<CoverageSession | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: activeSessions,
    isLoading,
    isError,
  } = useQuery({
    queryKey: COVERAGE_SESSIONS_QUERY_KEY,
    queryFn: listActiveCoverageSessions,
    enabled: featureEnabled,
  });

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
      // Inject the correlation-ID header on every subsequent request from
      // this browser tab so coverage collected while recording is
      // attributable to this session — cleared on check-out below.
      apiClient.defaults.headers.common[CORRELATION_ID_HEADER] = session.correlationId;
      setRecordingSession(session);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: COVERAGE_SESSIONS_QUERY_KEY });
    },
    onError: () => setActionError(t('coverageSessionRecorder.checkInError')),
  });

  const checkOutMutation = useMutation({
    mutationFn: async (session: CoverageSession) => {
      // Best-effort: coverage_instrumentation may be off even though
      // coverage_session_management (this page's own gate) is on — the two
      // flags are deliberately independent (see migration 157). A failed
      // dump must not prevent ending the session and clearing the header;
      // otherwise a disabled-instrumentation environment would permanently
      // strand every recording session.
      await apiClient
        .post<CoverageDumpResponse>(COVERAGE_DUMP_ENDPOINT, {
          label: session.label,
        })
        .catch(() => undefined);
      return endCoverageSession(session.id, session.version);
    },
    onSuccess: () => {
      setRecordingSession(null);
      setLabel('');
      setIssueKey('');
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: COVERAGE_SESSIONS_QUERY_KEY });
    },
    onError: () => setActionError(t('coverageSessionRecorder.checkOutError')),
    // Always clear the correlation header when checking out settles, success
    // or failure — leaving it set on the shared axios instance would tag
    // every subsequent request from this tab (any page, not just this one)
    // until a full reload, with no UI affordance to notice or clear it.
    onSettled: () => {
      delete apiClient.defaults.headers.common[CORRELATION_ID_HEADER];
    },
  });

  if (featureFlagLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400 text-sm">{t('common.loading')}</div>
        </div>
      </div>
    );
  }

  if (!featureEnabled) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500 text-sm">{t('coverageSessionRecorder.notAvailable')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h1
          className="text-2xl font-bold text-gray-900 mb-2"
          data-testid="coverage-session-recorder-heading"
        >
          {t('coverageSessionRecorder.heading')}
        </h1>
        <p className="text-sm text-gray-600 mb-6">{t('coverageSessionRecorder.description')}</p>

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
          <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
            <div className="mb-4">
              <label
                htmlFor="coverage-session-label"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('coverageSessionRecorder.labelInputLabel')}
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
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('coverageSessionRecorder.issueKeyInputLabel')}
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
            <Button
              type="button"
              disabled={label.trim().length === 0 || checkInMutation.isPending}
              onClick={() => checkInMutation.mutate()}
              data-testid="coverage-session-check-in-button"
            >
              {checkInMutation.isPending
                ? t('common.saving')
                : t('coverageSessionRecorder.checkInButton')}
            </Button>
          </div>
        )}

        {recordingSession && (
          <div
            className="bg-white border border-primary-200 rounded-lg p-6 mb-6"
            data-testid="coverage-session-recording-panel"
          >
            <p className="text-sm font-medium text-primary-700 mb-1">
              {t('coverageSessionRecorder.recordingLabel', { label: recordingSession.label })}
            </p>
            <p className="text-xs text-gray-500 mb-4">
              {t('coverageSessionRecorder.recordingSince', {
                date: new Date(recordingSession.startedAt).toLocaleString(),
              })}
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={checkOutMutation.isPending}
              onClick={() => checkOutMutation.mutate(recordingSession)}
              data-testid="coverage-session-check-out-button"
            >
              {checkOutMutation.isPending
                ? t('coverageSessionRecorder.checkingOut')
                : t('coverageSessionRecorder.checkOutButton')}
            </Button>
          </div>
        )}

        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          {t('coverageSessionRecorder.activeSessionsHeading')}
        </h2>

        {isLoading && (
          <div className="space-y-2" aria-hidden="true">
            <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />
            <div className="h-16 w-full bg-gray-100 rounded animate-pulse" />
          </div>
        )}

        {isError && (
          <p
            role="alert"
            className="text-sm text-red-600"
            data-testid="coverage-session-recorder-load-error"
          >
            {t('coverageSessionRecorder.loadError')}
          </p>
        )}

        {!isLoading && !isError && (activeSessions ?? []).length === 0 && (
          <p className="text-sm text-gray-500" data-testid="coverage-session-recorder-empty">
            {t('coverageSessionRecorder.noActiveSessions')}
          </p>
        )}

        {!isLoading && !isError && (activeSessions ?? []).length > 0 && (
          <ul
            className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100"
            data-testid="coverage-session-list"
          >
            {(activeSessions ?? []).map((session) => (
              <li
                key={session.id}
                className="px-4 py-3 flex items-center justify-between gap-2"
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
      </main>
    </div>
  );
}
