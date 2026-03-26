/**
 * Tests for the ProtectedRoute component.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { ADMIN_USER } from '../test/msw/handlers.js';

/** Renders ProtectedRoute with a child Outlet and a /login fallback route */
function renderProtectedRoute(initialEntries = ['/protected']) {
  return renderWithProviders(
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/protected" element={<div>Protected content</div>} />
      </Route>
      <Route path="/login" element={<div>Login page</div>} />
    </Routes>,
    { initialEntries },
  );
}

describe('ProtectedRoute', () => {
  it('shows a loading indicator while the auth check is in progress', () => {
    // Delay the response so the loading state is visible on initial render
    server.use(
      http.get('/api/auth/me', async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return HttpResponse.json({ user: ADMIN_USER });
      }),
    );
    renderProtectedRoute();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders child routes when the user is authenticated', async () => {
    renderProtectedRoute();
    await waitFor(() => {
      expect(screen.getByText('Protected content')).toBeInTheDocument();
    });
  });

  it('redirects to /login when the user is not authenticated', async () => {
    server.use(
      http.get('/api/auth/me', () => {
        return HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
      }),
    );
    renderProtectedRoute();
    await waitFor(() => {
      expect(screen.getByText('Login page')).toBeInTheDocument();
    });
  });
});
