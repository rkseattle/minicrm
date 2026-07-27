import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import { MOCK_ADMIN_USER } from '@/test/msw/handlers.js';

function TestApp() {
  return (
    <Routes>
      <Route path="/login" element={<div>Login page</div>} />
      <Route path="/access-denied" element={<div>Access denied page</div>} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<div>Protected content</div>} />
      </Route>
    </Routes>
  );
}

describe('ProtectedRoute', () => {
  it('shows a loading state while the auth check is in flight', () => {
    server.use(
      http.get('*/api/v1/auth/me', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ user: MOCK_ADMIN_USER });
      }),
    );
    renderWithProviders(<TestApp />);
    expect(screen.getByTestId('protected-route-loading')).toBeInTheDocument();
  });

  it('renders protected content for an authenticated admin', async () => {
    renderWithProviders(<TestApp />);
    await waitFor(() => expect(screen.getByText('Protected content')).toBeInTheDocument());
  });

  it('redirects to /login when unauthenticated', async () => {
    server.use(http.get('*/api/v1/auth/me', () => new HttpResponse(null, { status: 401 })));
    renderWithProviders(<TestApp />);
    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument());
  });

  it('redirects to /access-denied for a non-admin user — including the documented KNOWN GAP case where a real deployment could grant this user coverage:admin via a custom role (MINCRM-637): this component still redirects them, since /auth/me returns role only, never a resolved capability set, so it cannot tell that case apart from ordinary non-admin denial', async () => {
    server.use(
      http.get('*/api/v1/auth/me', () =>
        HttpResponse.json({ user: { ...MOCK_ADMIN_USER, role: 'rep' } }),
      ),
    );
    renderWithProviders(<TestApp />);
    await waitFor(() => expect(screen.getByText('Access denied page')).toBeInTheDocument());
  });

  describe('VITE_COVERAGE_DASHBOARD_NO_AUTH=true (MINCRM-636/637)', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('renders protected content immediately with no GET /auth/me call at all', async () => {
      vi.stubEnv('VITE_COVERAGE_DASHBOARD_NO_AUTH', 'true');
      let authMeCalled = false;
      server.use(
        http.get('*/api/v1/auth/me', () => {
          authMeCalled = true;
          return HttpResponse.json({ user: MOCK_ADMIN_USER });
        }),
      );
      renderWithProviders(<TestApp />);
      await waitFor(() => expect(screen.getByText('Protected content')).toBeInTheDocument());
      expect(authMeCalled).toBe(false);
    });
  });
});
