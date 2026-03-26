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

/** Shared React Query client instance */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Do not refetch in the background by default — explicit invalidation is used
      staleTime: 1000 * 60 * 5,
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found — check index.html for <div id="root">');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <I18nextProvider i18n={i18n}>
          <App />
        </I18nextProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
