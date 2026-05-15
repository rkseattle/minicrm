/**
 * Tests for the LoginPage component.
 * Covers: render, form interaction, failed login error state, redirect on success,
 * session-expired banner (MINCRM-365), and ?next= redirect after re-authentication.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './LoginPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { ADMIN_USER } from '../test/msw/handlers.js';

/** Renders LoginPage with a mock dashboard route so redirect can be verified */
function renderLoginPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<div>Dashboard</div>} />
      <Route path="/contacts" element={<div>Contacts page</div>} />
      <Route path="/change-password" element={<div>Change password page</div>} />
      <Route path="/forgot-password" element={<div>Forgot password page</div>} />
    </Routes>,
    { initialEntries: ['/login'] },
  );
}

/**
 * Renders LoginPage with ?reason=session_expired (and optional ?next=) query params,
 * simulating a redirect from the Axios 401 interceptor (MINCRM-365).
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

  it('redirects to the saved location (from state) after successful login (MINCRM-147)', async () => {
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

  it('redirects to dashboard when from state is /change-password (MINCRM-147)', async () => {
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

  it('renders the "Forgot your password?" link (MINCRM-156)', () => {
    renderLoginPage();
    expect(screen.getByTestId('login-forgot-password')).toBeInTheDocument();
  });

  it('navigates to /forgot-password when the link is clicked (MINCRM-156)', async () => {
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

// ── MINCRM-365: session-expired banner + ?next= redirect ────────────────────

describe('LoginPage — session expired (MINCRM-365)', () => {
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

  it('redirects to ?next= path after successful login (MINCRM-365)', async () => {
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
});
