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

/** Shared React Query client instance */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Do not refetch in the background by default — explicit invalidation is used
      staleTime: 1000 * 60 * 5,
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
