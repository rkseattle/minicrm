/**
 * Tests for the AdminRoute component.
 *
 * added redirect-back location state test.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route, useLocation } from 'react-router-dom';
import AdminRoute from './AdminRoute.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { ADMIN_USER, REP_USER } from '../test/msw/handlers.js';

/** Captures the location state passed to /login so tests can assert on it. */
function LoginPageWithState() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from;
  return <div>Login page{from ? ` from=${from.pathname}` : ''}</div>;
}

/** Renders AdminRoute with a child Outlet, a dashboard fallback, and a login fallback */
function renderAdminRoute(initialEntries = ['/admin']) {
  return renderWithProviders(
    <Routes>
      <Route element={<AdminRoute />}>
        <Route path="/admin" element={<div>Admin content</div>} />
      </Route>
      <Route path="/" element={<div>Dashboard</div>} />
      <Route path="/login" element={<div>Login page</div>} />
    </Routes>,
    { initialEntries },
  );
}

describe('AdminRoute', () => {
  it('shows a loading indicator while the auth check is in progress', () => {
    server.use(
      http.get('/api/v1/auth/me', async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return HttpResponse.json({ user: ADMIN_USER });
      }),
    );
    renderAdminRoute();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders child routes when user is an admin', async () => {
    renderAdminRoute();
    await waitFor(() => {
      expect(screen.getByText('Admin content')).toBeInTheDocument();
    });
  });

  it('redirects to / when user is authenticated but is a rep', async () => {
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })));
    renderAdminRoute();
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('redirects to /login when user is not authenticated', async () => {
    server.use(
      http.get('/api/v1/auth/me', () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
      ),
    );
    renderAdminRoute();
    await waitFor(() => {
      expect(screen.getByText('Login page')).toBeInTheDocument();
    });
  });

  it('passes the current location as state when redirecting to /login', async () => {
    server.use(
      http.get('/api/v1/auth/me', () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<div>Admin content</div>} />
        </Route>
        <Route path="/login" element={<LoginPageWithState />} />
      </Routes>,
      { initialEntries: ['/admin'] },
    );
    await waitFor(() => {
      expect(screen.getByText('Login page from=/admin')).toBeInTheDocument();
    });
  });
});
