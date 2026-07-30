/**
 * Manual-testing coverage session recorder. (MINCRM-609..612, MINCRM-663)
 * Moved here from minicrm-client's CoverageSessionRecorderPage.tsx, which is
 * deleted entirely — internal CI/dev tooling has no business being
 * reachable through the product's own admin UI.
 *
 * Cross-app attribution (found via Greptile PR review — "CRM requests lose
 * session attribution"): this app and the CRM client are genuinely separate
 * origins with no shared JS runtime, so setting the correlation header on
 * THIS app's own axios instance has no effect on requests the CRM tab
 * makes. Instead, starting a session here generates a link back to the CRM
 * client with `?coverageCorrelationId=<id>` appended; the CRM client's own
 * coverageCorrelation.ts picks that up once, persists it to localStorage,
 * and its axiosInstance.ts forwards it on every request for the rest of
 * the manual-testing session — see that module's own docblock for the
 * full design.
 *
 * Orphaned sessions on navigation (found via the same review — "Navigation
 * orphans active sessions"): the OLD design held "the session currently
 * being recorded" purely as local React state, discarded on unmount, while
 * the server-side session stayed active — reopening the page then allowed
 * a second concurrent check-in with no way to resume or check out the
 * first. This version treats the server's own active-sessions list (GET
 * /admin/coverage/sessions) as the only source of truth: every active
 * session, regardless of which browser tab or reload started it, is
 * listed with its own "Copy CRM link" and "Check out" actions. There is no
 * separate "recording" component state to lose.
 *
 * Dump attribution is automatic server-side (see
 * attributeDumpToSessionIfCorrelated in coverageController.ts): every
 * request carrying x-coverage-correlation-id while a session is active is
 * attributed to it without a separate client-side call.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  startCoverageSession,
  endCoverageSession,
  listAllActiveCoverageSessions,
  COVERAGE_SESSIONS_QUERY_KEY,
} from '@/api/coverageSessions.js';
import type { CoverageSession } from '@shared/schemas/coverageSessionSchema.js';

/**
 * Origin the manual-testing session recorder generates check-in links
 * against — the CRM client's own deployed origin, not this dashboard's.
 * Falls back to the dev-server default (client/vite.config.ts's own
 * port) so this works out of the box in local development without any
 * configuration; a real deployment sets VITE_CRM_ORIGIN explicitly.
 */
const CRM_ORIGIN = import.meta.env['VITE_CRM_ORIGIN'] ?? 'http://localhost:5173';

function buildCrmCorrelationLink(correlationId: string): string {
  const url = new URL(CRM_ORIGIN);
  url.searchParams.set('coverageCorrelationId', correlationId);
  return url.toString();
}

/** Tag applied when no usable build SHA is available. */
const UNKNOWN_BUILD_SHA = 'unknown';

/**
 * Same accept-set as the two sibling resolvers — the QA harness's
 * SAFE_BUILD_SHA_PATTERN and the server's SAFE_PATH_SEGMENT_PATTERN. All three
 * tag sessions or dumps that the attestation gate and the coverage map later
 * key off, so a value one accepts and another rejects is a silent split.
 *
 * A malformed value here is a build-time misconfiguration (a branch-style ref,
 * a quoted string, a stray newline) rather than a path-traversal risk, since
 * this value goes into a JSON body rather than a filesystem path — but the
 * remedy is the same: refuse it, tag 'unknown', and say so on screen.
 */
const SAFE_BUILD_SHA_PATTERN = /^(?!\.\.?$)[A-Za-z0-9._-]+$/;

/**
 * Resolves the build SHA a manually recorded session is tagged with.
 * (MINCRM-688)
 *
 * `||`, not `??`: an EMPTY VITE_BUILD_SHA is what an unset or misconfigured
 * build-time substitution actually produces, and under `??` that empty string
 * won outright and was sent as the buildSha. coverageSessionSchema requires
 * min(1), so the request 400s and the user sees the generic "please try
 * again" error — advice that cannot possibly help, since retrying re-sends
 * the same empty value. Degrading to 'unknown' at least produces a session;
 * the caller surfaces that state in the UI.
 *
 * Read at CALL time, never captured in a module-level const: vi.stubEnv only
 * affects reads that happen after the stub is applied, so a value computed
 * once at import time would be invisible to per-test stubbing. Same lesson as
 * useAuth.ts's isNoAuthMode() — see its docblock.
 */
function resolveBuildSha(): string {
  const configured = import.meta.env['VITE_BUILD_SHA'];
  if (!configured) return UNKNOWN_BUILD_SHA;
  return SAFE_BUILD_SHA_PATTERN.test(configured) ? configured : UNKNOWN_BUILD_SHA;
}

export default function SessionRecorderPage() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [issueKey, setIssueKey] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);

  // Called from render rather than hoisted to a module-level const — see
  // resolveBuildSha's own docblock on vi.stubEnv timing.
  const buildSha = resolveBuildSha();
  const hasUnknownBuildSha = buildSha === UNKNOWN_BUILD_SHA;

  const {
    data: activeSessions,
    isLoading,
    isError,
  } = useQuery({
    queryKey: COVERAGE_SESSIONS_QUERY_KEY,
    queryFn: () => listAllActiveCoverageSessions(),
  });
  const sessions = activeSessions ?? [];

  const checkInMutation = useMutation({
    mutationFn: () =>
      startCoverageSession({
        label: label.trim(),
        source: 'manual',
        buildSha,
        environment: import.meta.env.MODE,
        issueKey: issueKey.trim() || undefined,
      }),
    onSuccess: () => {
      setLabel('');
      setIssueKey('');
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: COVERAGE_SESSIONS_QUERY_KEY });
    },
    onError: () => setActionError('Could not start the session — please try again.'),
  });

  const checkOutMutation = useMutation({
    mutationFn: (session: CoverageSession) => endCoverageSession(session.id, session.version),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: COVERAGE_SESSIONS_QUERY_KEY });
    },
    onError: () => setActionError('Could not end the session — please try again.'),
  });

  async function handleCopyLink(session: CoverageSession): Promise<void> {
    const link = buildCrmCorrelationLink(session.correlationId);
    try {
      await navigator.clipboard.writeText(link);
      setCopiedSessionId(session.id);
      window.setTimeout(() => setCopiedSessionId(null), 2000);
    } catch {
      // Clipboard access can be denied by browser permissions/context (e.g.
      // non-HTTPS in some browsers) — the link itself is still shown in
      // the DOM below as a fallback, so this is not a hard failure.
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1
        className="mb-2 text-2xl font-semibold text-gray-900"
        data-testid="coverage-session-recorder-heading"
      >
        Manual Testing Session Recorder
      </h1>
      <p className="mb-6 text-sm text-gray-600">
        Check in, then open the CRM link for this session in a separate tab before you start
        exploratory testing. Check out here when done.
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

      {/*
        MINCRM-688: a session tagged 'unknown' records fine but can never be
        matched to a real commit, so any coverage attributed to it is
        unusable for build-level reporting. Surfaced here, before check-in,
        because this is a human-initiated flow — a console warning (what the
        automated E2E harness does) would never be seen by the person
        actually starting the session.
      */}
      {hasUnknownBuildSha && (
        <p
          role="status"
          className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
          data-testid="coverage-session-unknown-build-sha-notice"
        >
          No usable build SHA (VITE_BUILD_SHA is unset, empty, or malformed), so sessions started
          here are tagged &ldquo;unknown&rdquo; and cannot be matched to a commit. Recording still
          works, but this coverage will not appear in build-level reports. Rebuild this dashboard
          from a git checkout, or set <code>GIT_COMMIT_SHA</code> before building. See
          docs/dev/coverage.md.
        </p>
      )}

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

      {!isLoading && !isError && sessions.length === 0 && (
        <p className="text-sm text-gray-500" data-testid="coverage-session-recorder-empty">
          No active sessions.
        </p>
      )}

      {!isLoading && !isError && sessions.length > 0 && (
        <ul
          className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white"
          data-testid="coverage-session-list"
        >
          {sessions.map((session) => (
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
                <p className="mt-1 break-all text-xs text-indigo-600">
                  {buildCrmCorrelationLink(session.correlationId)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyLink(session)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700"
                  data-testid={`coverage-session-copy-link-${session.id}`}
                >
                  {copiedSessionId === session.id ? 'Copied!' : 'Copy CRM link'}
                </button>
                <button
                  type="button"
                  disabled={checkOutMutation.isPending}
                  onClick={() => checkOutMutation.mutate(session)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50"
                  data-testid={`coverage-session-check-out-${session.id}`}
                >
                  Check out
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
