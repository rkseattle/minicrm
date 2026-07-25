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
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getPersistedCoverageCorrelationId,
  checkOutCoverageSession,
} from '@/coverageCorrelation.js';

const POLL_INTERVAL_MS = 2000;

export default function CoverageSessionIndicator() {
  const { t } = useTranslation();
  const [correlationId, setCorrelationId] = useState<string | null>(() =>
    getPersistedCoverageCorrelationId(),
  );
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCorrelationId(getPersistedCoverageCorrelationId());
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  if (!correlationId) {
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
