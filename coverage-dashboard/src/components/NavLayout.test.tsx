import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import NavLayout from './NavLayout.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import { QueryClient } from '@tanstack/react-query';
import { COVERAGE_SUMMARY_QUERY_KEY } from '@/api/coverageReporting.js';

function TestApp() {
  return (
    <Routes>
      <Route element={<NavLayout />}>
        <Route path="/" element={<div>Page content</div>} />
      </Route>
    </Routes>
  );
}

describe('NavLayout', () => {
  it('renders the nav bar and child route content', () => {
    renderWithProviders(<TestApp />);
    expect(screen.getByTestId('nav-link-overview')).toBeInTheDocument();
    expect(screen.getByTestId('nav-link-gaps')).toBeInTheDocument();
    expect(screen.getByTestId('nav-link-traceability')).toBeInTheDocument();
    expect(screen.getByTestId('nav-link-sessions')).toBeInTheDocument();
    expect(screen.getByText('Page content')).toBeInTheDocument();
  });

  it('calls the logout endpoint when Sign out is clicked', async () => {
    let logoutCalled = false;
    server.use(
      http.post('*/api/v1/auth/logout', () => {
        logoutCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<TestApp />);

    await userEvent.click(screen.getByTestId('nav-logout-button'));

    await waitFor(() => expect(logoutCalled).toBe(true));
  });

  describe('VITE_COVERAGE_DASHBOARD_NO_AUTH=true (MINCRM-636/637)', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('hides the Sign out button — there is no session to sign out of', () => {
      vi.stubEnv('VITE_COVERAGE_DASHBOARD_NO_AUTH', 'true');
      renderWithProviders(<TestApp />);
      expect(screen.queryByTestId('nav-logout-button')).not.toBeInTheDocument();
    });
  });
});

describe('NavLayout — cache isolation between accounts', () => {
  beforeEach(() => {
    server.use(http.post('*/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })));
  });

  it('clears cached coverage data on logout rather than nulling only the auth entry', async () => {
    // gcTime must not be 0: renderWithProviders defaults to it, which collects
    // entries on unmount and would make this pass whether or not logout cleared.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(['coverage', 'summary'], { pct: 91 });
    queryClient.setQueryData(['coverage_sessions'], [{ id: 's1' }]);

    renderWithProviders(<TestApp />, { queryClient });

    await userEvent.click(screen.getByTestId('nav-logout-button'));

    // Read the cache, not the DOM: rendered output cannot distinguish "cleared"
    // from "stale but still readable", which is the whole defect.
    await waitFor(() => expect(queryClient.getQueryData(['coverage', 'summary'])).toBeUndefined());
    expect(queryClient.getQueryData(['coverage_sessions'])).toBeUndefined();
  });

  it('routes to /login after logout', async () => {
    // A client-side navigation, unlike the main client app: nothing here holds
    // module-level state that a document load would need to reset, and this app
    // mounts no query observers above the router.
    renderWithProviders(
      <Routes>
        <Route element={<NavLayout />}>
          <Route path="/" element={<div>Page content</div>} />
        </Route>
        <Route path="/login" element={<div data-testid="login-page">Login</div>} />
      </Routes>,
    );

    await userEvent.click(screen.getByTestId('nav-logout-button'));

    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
  });

  it('does not navigate away when the logout request fails', async () => {
    // LoginPage redirects an authenticated visitor back to '/', so navigating on
    // a failed logout would land the user on the dashboard still signed in —
    // having been told they signed out.
    server.use(http.post('*/api/v1/auth/logout', () => new HttpResponse(null, { status: 500 })));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(COVERAGE_SUMMARY_QUERY_KEY, { pct: 91 });

    renderWithProviders(
      <Routes>
        <Route element={<NavLayout />}>
          <Route path="/" element={<div>Page content</div>} />
        </Route>
        <Route path="/login" element={<div data-testid="login-page">Login</div>} />
      </Routes>,
      { queryClient },
    );

    await userEvent.click(screen.getByTestId('nav-logout-button'));

    await waitFor(() => expect(screen.getByTestId('nav-logout-error')).toBeInTheDocument());
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
    // The cache must survive too: the session did not end.
    expect(queryClient.getQueryData(COVERAGE_SUMMARY_QUERY_KEY)).toEqual({ pct: 91 });
  });
});
