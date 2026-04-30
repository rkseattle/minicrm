/**
 * Tests for App — root routing configuration.
 *
 * Verifies:
 * - /login renders LoginPage (public route, no auth required)
 * - / renders DashboardPage for an authenticated user
 * - /contacts renders ContactsPage for an authenticated user
 * - /admin/settings renders AdminSettingsPage for an admin user
 * - Unknown paths redirect to / (catch-all → dashboard)
 * - /pipeline redirects to /deals
 */

import { Suspense } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BreakpointProvider } from '@/context/BreakpointContext.js';
import { server } from './test/setup.js';
import App from './App.js';

function renderApp(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BreakpointProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Suspense fallback={null}>
            <App />
          </Suspense>
        </MemoryRouter>
      </BreakpointProvider>
    </QueryClientProvider>,
  );
}

describe('App routing', () => {
  it('renders the login form at /login', async () => {
    renderApp('/login');

    await waitFor(() => {
      expect(screen.getByTestId('login-email')).toBeInTheDocument();
    });
  });

  it('redirects unauthenticated users to /login', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } },
          { status: 401 },
        ),
      ),
    );

    renderApp('/');

    await waitFor(() => {
      expect(screen.getByTestId('login-email')).toBeInTheDocument();
    });
  });

  it('renders the dashboard at / for an authenticated admin', async () => {
    renderApp('/');

    // DashboardPage renders a recent activity feed
    await waitFor(() => {
      expect(screen.getByTestId('recent-activity-feed')).toBeInTheDocument();
    });
  });

  it('renders contacts page at /contacts', async () => {
    renderApp('/contacts');

    await waitFor(() => {
      expect(screen.getByTestId('new-contact-button')).toBeInTheDocument();
    });
  });

  it('renders admin settings page at /admin/settings', async () => {
    renderApp('/admin/settings');

    await waitFor(() => {
      expect(screen.getByTestId('settings-heading')).toBeInTheDocument();
    });
  });

  it('redirects /pipeline to /deals', async () => {
    renderApp('/pipeline');

    await waitFor(() => {
      expect(screen.getByTestId('new-deal-button')).toBeInTheDocument();
    });
  });

  it('redirects unknown paths to the dashboard', async () => {
    renderApp('/this-path-does-not-exist');

    await waitFor(() => {
      expect(screen.getByTestId('recent-activity-feed')).toBeInTheDocument();
    });
  });
});
