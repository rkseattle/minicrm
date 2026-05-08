/**
 * React application entry point.
 * Sets up the QueryClient, Router, and i18n providers, then mounts the App.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import './index.css';
import i18n from './i18n.js';
import App from './App.js';
import ErrorBoundary from './components/ErrorBoundary.js';
import { BreakpointProvider } from './context/BreakpointContext.js';
import { initSentry } from './sentry.js';

initSentry();

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
    },
  },
});

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
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <I18nextProvider i18n={i18n}>
          <BreakpointProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </BreakpointProvider>
        </I18nextProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
