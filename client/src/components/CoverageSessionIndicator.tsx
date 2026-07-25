/**
 * CoverageSessionIndicator — small floating "check out" affordance for an
 * active manual-testing coverage session. (MINCRM-663)
 *
 * Rendered at the app root (see App.tsx's LayoutShell, same
 * position:fixed precedent as SetupChecklistWidget) so it survives client-
 * side navigation without being remounted per-page. Visible ONLY while a
 * coverage correlation ID is persisted (see coverageCorrelation.ts) — the
 * overwhelming majority of admins never see this at all, since it only
 * appears after following a check-in link from the standalone
 * coverage-dashboard app's session recorder.
 *
 * Polls localStorage on an interval rather than reacting to a custom
 * event: the correlation ID can be set by relayCoverageCorrelationIdFromUrl
 * at a moment before this component has mounted (very first page load),
 * so a poll is simpler and more robust than wiring a dedicated pub/sub
 * channel for what is inherently rare, low-frequency state.
 *
 * Server reconciliation (found via Greptile PR review — "Dashboard checkout
 * leaves stale CRM state"): a session can be ended from the OTHER side (the
 * dashboard's own Check out) while this tab still has the correlation ID
 * persisted — nothing local would ever tell this component that happened.
 * A background useQuery polls the session's own current state by
 * correlation ID; the moment it comes back "not active" (ended remotely, or
 * any other reason it's no longer found), the effect below clears the
 * persisted correlation ID (a side effect on an external system —
 * localStorage — not a setState call) so the next localStorage poll tick
 * picks up the clear and hides this component, rather than continuing to
 * show a live indicator and attach a dead correlation ID to every request.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getPersistedCoverageCorrelationId,
  checkOutCoverageSession,
  clearPersistedCoverageCorrelationId,
} from '@/coverageCorrelation.js';
import { findActiveCoverageSessionByCorrelationId } from '@/api/coverageSessions.js';

const LOCALSTORAGE_POLL_INTERVAL_MS = 2000;
const SERVER_RECONCILE_INTERVAL_MS = 10_000;

export default function CoverageSessionIndicator() {
  const { t } = useTranslation();
  const [correlationId, setCorrelationId] = useState<string | null>(() =>
    getPersistedCoverageCorrelationId(),
  );
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCorrelationId(getPersistedCoverageCorrelationId());
    }, LOCALSTORAGE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const { data: activeSession, isFetched } = useQuery({
    queryKey: ['coverage-session-reconcile', correlationId],
    queryFn: () => findActiveCoverageSessionByCorrelationId(correlationId!),
    enabled: correlationId !== null,
    refetchInterval: SERVER_RECONCILE_INTERVAL_MS,
    // A brand-new session (just started in the dashboard, link not yet
    // followed here) is expected to briefly return null before the admin
    // even opens this CRM tab — retries would just delay noticing a
    // genuinely-ended session by the same amount.
    retry: false,
  });

  const confirmedEnded = correlationId !== null && isFetched && activeSession === null;

  useEffect(() => {
    if (confirmedEnded) {
      clearPersistedCoverageCorrelationId();
    }
  }, [confirmedEnded]);

  if (!correlationId || confirmedEnded) {
    return null;
  }

  async function handleCheckOut(): Promise<void> {
    setIsCheckingOut(true);
    try {
      await checkOutCoverageSession();
      setCorrelationId(null);
    } finally {
      setIsCheckingOut(false);
    }
  }

  return (
    <div
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 shadow-lg"
      data-testid="coverage-session-indicator"
      role="status"
      aria-label={t('coverageSession.label')}
    >
      <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
      <span className="text-xs font-medium text-gray-700">{t('coverageSession.label')}</span>
      <button
        type="button"
        onClick={() => void handleCheckOut()}
        disabled={isCheckingOut}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 disabled:opacity-50"
        data-testid="coverage-session-indicator-checkout-button"
      >
        {isCheckingOut ? t('coverageSession.checkingOut') : t('coverageSession.checkOutButton')}
      </button>
    </div>
  );
}
