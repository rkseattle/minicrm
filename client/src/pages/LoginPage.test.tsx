/**
 * Tests for the LoginPage component.
 * Covers: render, form interaction, failed login error state, redirect on success,
 * session-expired banner, ?next= redirect after re-authentication,
 * and MFA challenge / org-MFA-required flows.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './LoginPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { MY_LANGUAGE_QUERY_KEY, MY_NAV_LAYOUT_QUERY_KEY } from '@/api/users.js';
import { QueryClient } from '@tanstack/react-query';
import { server } from '../test/setup.js';
import { ADMIN_USER } from '../test/msw/handlers.js';

/** Renders LoginPage with a mock dashboard route so redirect can be verified */
function renderLoginPage(queryClient?: QueryClient) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<div>Dashboard</div>} />
      <Route path="/contacts" element={<div>Contacts page</div>} />
      <Route path="/change-password" element={<div>Change password page</div>} />
      <Route path="/forgot-password" element={<div>Forgot password page</div>} />
      <Route path="/profile" element={<div data-testid="profile-page">Profile</div>} />
    </Routes>,
    { initialEntries: ['/login'], queryClient },
  );
}

/**
 * Renders LoginPage with ?reason=session_expired (and optional ?next=) query params,
 * simulating a redirect from the Axios 401 interceptor.
 */
function renderLoginPageSessionExpired(next?: string) {
  const search = next
    ? `?reason=session_expired&next=${encodeURIComponent(next)}`
    : '?reason=session_expired';
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<div>Dashboard</div>} />
      <Route path="/contacts" element={<div>Contacts page</div>} />
      <Route path="/deals" element={<div>Deals page</div>} />
      <Route path="/change-password" element={<div>Change password page</div>} />
    </Routes>,
    { initialEntries: [`/login${search}`] },
  );
}

/**
 * Renders LoginPage with pre-seeded location state simulating a redirect from
 * ProtectedRoute, so the redirect-back behaviour can be verified.
 *
 * Uses a /start shim route that issues a Navigate to /login with the correct
 * state, because renderWithProviders accepts only string initialEntries.
 *
 * @param from - The pathname the user was trying to reach before being redirected.
 */
function renderLoginPageWithFrom(from: string) {
  return renderWithProviders(
    <Routes>
      {/* Shim: navigate to /login with the from state, exactly as ProtectedRoute does */}
      <Route
        path="/start"
        element={<Navigate to="/login" state={{ from: { pathname: from } }} replace />}
      />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<div>Dashboard</div>} />
      <Route path="/contacts" element={<div>Contacts page</div>} />
      <Route path="/change-password" element={<div>Change password page</div>} />
      <Route path="/forgot-password" element={<div>Forgot password page</div>} />
    </Routes>,
    { initialEntries: ['/start'] },
  );
}

describe('LoginPage', () => {
  it('renders the MiniCRM brand heading', () => {
    renderLoginPage();
    expect(screen.getByRole('heading', { name: 'MiniCRM' })).toBeInTheDocument();
  });

  it('renders the email and password fields', () => {
    renderLoginPage();
    expect(screen.getByTestId('login-email')).toBeInTheDocument();
    expect(screen.getByTestId('login-password')).toBeInTheDocument();
  });

  it('renders the sign in button', () => {
    renderLoginPage();
    expect(screen.getByTestId('login-submit')).toBeInTheDocument();
  });

  it('does not show an error alert on initial render', () => {
    renderLoginPage();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error alert on invalid credentials', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByTestId('login-email'), 'wrong@example.com');
    await user.type(screen.getByTestId('login-password'), 'wrong-password');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('redirects to the dashboard on successful login', async () => {
    const user = userEvent.setup();

    // Override auth/me to return the logged-in user after successful login
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: ADMIN_USER })));

    renderLoginPage();

    await user.type(screen.getByTestId('login-email'), 'admin@example.com');
    await user.type(screen.getByTestId('login-password'), 'correct-password');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('redirects to the saved location (from state) after successful login', async () => {
    const user = userEvent.setup();
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: ADMIN_USER })));

    renderLoginPageWithFrom('/contacts');

    await user.type(screen.getByTestId('login-email'), 'admin@example.com');
    await user.type(screen.getByTestId('login-password'), 'correct-password');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByText('Contacts page')).toBeInTheDocument();
    });
  });

  it('redirects to dashboard when from state is /change-password', async () => {
    // /change-password must never be a redirect-back destination — it is reserved
    // for the forced-change flow and redirecting back there would create a loop.
    const user = userEvent.setup();
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: ADMIN_USER })));

    renderLoginPageWithFrom('/change-password');

    await user.type(screen.getByTestId('login-email'), 'admin@example.com');
    await user.type(screen.getByTestId('login-password'), 'correct-password');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('redirects to dashboard when no from state is present', async () => {
    const user = userEvent.setup();
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: ADMIN_USER })));

    renderLoginPage();

    await user.type(screen.getByTestId('login-email'), 'admin@example.com');
    await user.type(screen.getByTestId('login-password'), 'correct-password');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('renders the "Forgot your password?" link', () => {
    renderLoginPage();
    expect(screen.getByTestId('login-forgot-password')).toBeInTheDocument();
  });

  it('navigates to /forgot-password when the link is clicked', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.click(screen.getByTestId('login-forgot-password'));

    await waitFor(() => {
      expect(screen.getByText('Forgot password page')).toBeInTheDocument();
    });
  });

  it('disables the submit button while the login request is in flight', async () => {
    const user = userEvent.setup();

    // Make the login response slow so we can observe the pending state
    server.use(
      http.post('/api/v1/auth/login', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({ user: ADMIN_USER });
      }),
    );

    renderLoginPage();
    await user.type(screen.getByTestId('login-email'), 'admin@example.com');
    await user.type(screen.getByTestId('login-password'), 'correct-password');

    const submitButton = screen.getByTestId('login-submit');
    await user.click(submitButton);

    expect(submitButton).toBeDisabled();
  });
});

// ── session-expired banner + ?next= redirect ────────────────────

describe('LoginPage — session expired', () => {
  it('does not show the session-expired banner without ?reason=session_expired', () => {
    renderLoginPage();
    expect(screen.queryByTestId('session-expired-banner')).not.toBeInTheDocument();
  });

  it('shows the session-expired banner when ?reason=session_expired is present', () => {
    renderLoginPageSessionExpired();
    expect(screen.getByTestId('session-expired-banner')).toBeInTheDocument();
  });

  it('session-expired banner has role="status" for screen readers', () => {
    renderLoginPageSessionExpired();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('redirects to ?next= path after successful login', async () => {
    const user = userEvent.setup();
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: ADMIN_USER })));

    renderLoginPageSessionExpired('/deals');

    await user.type(screen.getByTestId('login-email'), 'admin@example.com');
    await user.type(screen.getByTestId('login-password'), 'correct-password');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByText('Deals page')).toBeInTheDocument();
    });
  });

  it('redirects to dashboard when ?next= is /change-password (loop prevention)', async () => {
    const user = userEvent.setup();
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: ADMIN_USER })));

    renderLoginPageSessionExpired('/change-password');

    await user.type(screen.getByTestId('login-email'), 'admin@example.com');
    await user.type(screen.getByTestId('login-password'), 'correct-password');
    await user.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  describe('MFA challenge flow', () => {
    it('shows the MFA modal when login returns mfaRequired:true', async () => {
      server.use(
        http.post('/api/v1/auth/login', () =>
          HttpResponse.json({ mfaRequired: true, mfaToken: 'test-mfa-token' }),
        ),
      );
      const user = userEvent.setup();
      renderLoginPage();
      await user.type(screen.getByTestId('login-email'), 'admin@example.com');
      await user.type(screen.getByTestId('login-password'), 'correct-password');
      await user.click(screen.getByTestId('login-submit'));
      await waitFor(() => {
        expect(screen.getByTestId('mfa-login-modal')).toBeInTheDocument();
      });
    });

    it("clears a previous account's cached data when MFA verification completes the login", async () => {
      // The path an MFA-enrolled user takes on every login — a session entry
      // like any other, and the one completeLogin reaches via handleMfaSuccess.
      server.use(
        http.post('/api/v1/auth/login', () =>
          HttpResponse.json({ mfaRequired: true, mfaToken: 'test-mfa-token' }),
        ),
        http.post('/api/v1/auth/mfa/verify-login', () => HttpResponse.json({ user: ADMIN_USER })),
        http.get('/api/v1/auth/me', () => HttpResponse.json({ user: ADMIN_USER })),
      );
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      queryClient.setQueryData(MY_LANGUAGE_QUERY_KEY, { language: 'fr' });

      const user = userEvent.setup();
      renderLoginPage(queryClient);
      await user.type(screen.getByTestId('login-email'), 'admin@example.com');
      await user.type(screen.getByTestId('login-password'), 'correct-password');
      await user.click(screen.getByTestId('login-submit'));

      await waitFor(() => expect(screen.getByTestId('mfa-login-modal')).toBeInTheDocument());
      await user.type(screen.getByTestId('mfa-login-code-input'), '123456');
      await user.click(screen.getByTestId('mfa-login-submit'));

      await waitFor(() => expect(queryClient.getQueryData(MY_LANGUAGE_QUERY_KEY)).toBeUndefined());
    });

    it('redirects to /profile?mfa_setup_required=1 when login returns mfaSetupRequired:true', async () => {
      server.use(
        http.post('/api/v1/auth/login', () =>
          HttpResponse.json({ user: ADMIN_USER, mfaSetupRequired: true }),
        ),
        http.get('/api/v1/auth/me', () => HttpResponse.json({ user: ADMIN_USER })),
      );
      const user = userEvent.setup();
      renderLoginPage();
      await user.type(screen.getByTestId('login-email'), 'admin@example.com');
      await user.type(screen.getByTestId('login-password'), 'correct-password');
      await user.click(screen.getByTestId('login-submit'));
      await waitFor(() => {
        expect(screen.getByTestId('profile-page')).toBeInTheDocument();
      });
    });

    it("clears a previous account's cached data on the mfaSetupRequired path too", async () => {
      // A session cookie is issued on this branch, so it is a session entry
      // like any other and must not leave the last account's data readable.
      server.use(
        http.post('/api/v1/auth/login', () =>
          HttpResponse.json({ user: ADMIN_USER, mfaSetupRequired: true }),
        ),
        http.get('/api/v1/auth/me', () => HttpResponse.json({ user: ADMIN_USER })),
      );
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      queryClient.setQueryData(MY_LANGUAGE_QUERY_KEY, { language: 'fr' });

      const user = userEvent.setup();
      renderLoginPage(queryClient);
      await user.type(screen.getByTestId('login-email'), 'admin@example.com');
      await user.type(screen.getByTestId('login-password'), 'correct-password');
      await user.click(screen.getByTestId('login-submit'));

      await waitFor(() => expect(queryClient.getQueryData(MY_LANGUAGE_QUERY_KEY)).toBeUndefined());
    });
  });
});

describe('LoginPage — cache isolation between accounts', () => {
  it("clears a previous account's cached per-user data on a successful login", async () => {
    // gcTime must not be 0: renderWithProviders defaults to it, which collects
    // entries on unmount and would pass whether or not login cleared them.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(MY_LANGUAGE_QUERY_KEY, { language: 'fr' });
    queryClient.setQueryData(MY_NAV_LAYOUT_QUERY_KEY, { layout: 'left' });

    renderLoginPage(queryClient);

    await userEvent.type(screen.getByTestId('login-email'), 'admin@example.com');
    await userEvent.type(screen.getByTestId('login-password'), 'correct-password');
    await userEvent.click(screen.getByTestId('login-submit'));

    // Read the cache: rendered output cannot distinguish "cleared" from "stale
    // but still readable", which is the defect.
    await waitFor(() => expect(queryClient.getQueryData(MY_LANGUAGE_QUERY_KEY)).toBeUndefined());
    expect(queryClient.getQueryData(MY_NAV_LAYOUT_QUERY_KEY)).toBeUndefined();
  });
});
