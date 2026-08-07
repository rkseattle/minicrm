/**
 * React application entry point.
 * Sets up the QueryClient, Router, and i18n providers, then mounts the App.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import './index.css';
import i18n from './i18n.js';
import App from './App.js';
import ErrorBoundary from './components/ErrorBoundary.js';
import { BreakpointProvider } from './context/BreakpointContext.js';
import { BrandingProvider } from './context/BrandingContext.js';
import { initSentry } from './sentry.js';
import { setupInterceptors } from './api/axiosInstance.js';
import { relayCoverageCorrelationIdFromUrl } from './coverageCorrelation.js';

initSentry();

// MINCRM-663: picks up a manual-testing coverage session's correlation ID
// from the URL (if the admin arrived via a check-in link from the
// standalone coverage-dashboard app) and persists it for axiosInstance.ts
// to forward on every request. A no-op for every normal page load. Must
// run before any API request may fire, so this happens first.
relayCoverageCorrelationIdFromUrl();

/**
 * Shared React Query client instance.
 *
 * Cache policy (MINCRM-348):
 *   staleTime: 0   — every cached response is immediately stale; React Query
 *                    refetches in the background on mount and window focus so
 *                    teammates' changes are visible without a manual refresh.
 *                    The cached value is served first (no loading flash).
 *   refetchOnWindowFocus: true — explicit policy; ensures tab-switching
 *                    triggers a background refresh of all active queries.
 *
 * Per-query overrides (intentionally long-lived):
 *   NavLayoutContext  5 min — layout changes are rare and admin-only
 *   GlobalSearch      30 s  — avoids hammering the server on rapid typing
 *   ContactSelector   60 s  — picker results stable during form completion
 *   usePipelineStages 5 min — stage definitions change rarely
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      refetchOnWindowFocus: true,
      // Never retry a 4xx. A 404 is a definitive answer — the record does not
      // exist — and retrying it three times with exponential backoff (React
      // Query's default) delays the not-found state by seconds while changing
      // nothing about the outcome. Under CI load that pushed the not-found
      // render past the 10s budget its E2E specs allow, surfacing as a timeout
      // on a page that was working correctly, just slowly.
      //
      // 5xx and network errors still retry: those are genuinely transient.
      // Mirrors the predicate useAuth.ts already applies to its own 401.
      retry: (failureCount, error) => {
        const status = (error as AxiosError)?.response?.status;
        if (status !== undefined && status >= 400 && status < 500) return false;
        return failureCount < 3;
      },
    },
  },
});

// Wire the global 401 interceptor now that queryClient exists. (MINCRM-365)
setupInterceptors(queryClient);

// Expose i18n on window so E2E tests can call window.i18n.changeLanguage('pseudo')
// via page.evaluate(). MINCRM-241
(window as Window & { i18n?: typeof i18n }).i18n = i18n;

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found — check index.html for <div id="root">');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <I18nextProvider i18n={i18n}>
          <BreakpointProvider>
            <BrandingProvider>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </BrandingProvider>
          </BreakpointProvider>
        </I18nextProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
