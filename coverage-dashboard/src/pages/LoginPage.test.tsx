import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import LoginPage from './LoginPage.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import { QueryClient } from '@tanstack/react-query';

describe('LoginPage', () => {
  beforeEach(() => {
    server.use(http.get('*/api/v1/auth/me', () => new HttpResponse(null, { status: 401 })));
  });

  it('renders the login form when unauthenticated', async () => {
    renderWithProviders(<LoginPage />);
    await waitFor(() => expect(screen.getByTestId('login-form')).toBeInTheDocument());
  });

  it('shows an error message on invalid credentials (401)', async () => {
    server.use(http.post('*/api/v1/auth/login', () => new HttpResponse(null, { status: 401 })));
    renderWithProviders(<LoginPage />);
    await waitFor(() => expect(screen.getByTestId('login-form')).toBeInTheDocument());

    await userEvent.type(screen.getByTestId('login-email-input'), 'admin@example.com');
    await userEvent.type(screen.getByTestId('login-password-input'), 'wrong-password');
    await userEvent.click(screen.getByTestId('login-submit-button'));

    await waitFor(() => expect(screen.getByTestId('login-error')).toHaveTextContent(/invalid/i));
  });

  it('shows a generic error message on an unexpected server error', async () => {
    server.use(http.post('*/api/v1/auth/login', () => new HttpResponse(null, { status: 500 })));
    renderWithProviders(<LoginPage />);
    await waitFor(() => expect(screen.getByTestId('login-form')).toBeInTheDocument());

    await userEvent.type(screen.getByTestId('login-email-input'), 'admin@example.com');
    await userEvent.type(screen.getByTestId('login-password-input'), 'password123');
    await userEvent.click(screen.getByTestId('login-submit-button'));

    await waitFor(() =>
      expect(screen.getByTestId('login-error')).toHaveTextContent(/something went wrong/i),
    );
  });

  describe('VITE_COVERAGE_DASHBOARD_NO_AUTH=true (MINCRM-636/637)', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('redirects away from the login form — useAuth() reports authenticated with no login required', async () => {
      vi.stubEnv('VITE_COVERAGE_DASHBOARD_NO_AUTH', 'true');
      renderWithProviders(
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Home page</div>} />
        </Routes>,
        { initialEntries: ['/login'] },
      );
      await waitFor(() => expect(screen.getByText('Home page')).toBeInTheDocument());
      expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();
    });
  });
});

describe('LoginPage — cache isolation between accounts', () => {
  beforeEach(() => {
    server.use(
      http.post('*/api/v1/auth/login', () => HttpResponse.json({ user: { id: 'u2', email: 'b@example.com' } })),
      http.get('*/api/v1/auth/me', () => HttpResponse.json({ id: 'u2', email: 'b@example.com' })),
    );
  });

  it("clears a previous account's cached coverage data on a successful login", async () => {
    // gcTime must not be 0: renderWithProviders defaults to it, which collects
    // entries on unmount and would pass whether or not login cleared them.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(['coverage', 'summary'], { pct: 91 });
    queryClient.setQueryData(['coverage_sessions'], [{ id: 's1' }]);

    renderWithProviders(
      <Routes>
        <Route path="/" element={<LoginPage />} />
      </Routes>,
      { queryClient },
    );
    await waitFor(() => expect(screen.getByTestId('login-form')).toBeInTheDocument());

    await userEvent.type(screen.getByTestId('login-email-input'), 'b@example.com');
    await userEvent.type(screen.getByTestId('login-password-input'), 'correct-password');
    await userEvent.click(screen.getByTestId('login-submit-button'));

    // Read the cache, not the DOM: rendered output cannot distinguish "cleared"
    // from "stale but still readable", which is the defect.
    await waitFor(() => expect(queryClient.getQueryData(['coverage', 'summary'])).toBeUndefined());
    expect(queryClient.getQueryData(['coverage_sessions'])).toBeUndefined();
  });
});
