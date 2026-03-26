/**
 * Tests for the AdminRoute component.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import AdminRoute from './AdminRoute.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { REP_USER } from '../test/msw/handlers.js';

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
  it('renders child routes when user is an admin', async () => {
    renderAdminRoute();
    await waitFor(() => {
      expect(screen.getByText('Admin content')).toBeInTheDocument();
    });
  });

  it('redirects to / when user is authenticated but is a rep', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ user: REP_USER })));
    renderAdminRoute();
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('redirects to /login when user is not authenticated', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
      ),
    );
    renderAdminRoute();
    await waitFor(() => {
      expect(screen.getByText('Login page')).toBeInTheDocument();
    });
  });
});
