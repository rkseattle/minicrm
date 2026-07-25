import { describe, it, expect } from 'vitest';
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

  it('redirects to /access-denied for a non-admin user', async () => {
    server.use(
      http.get('*/api/v1/auth/me', () =>
        HttpResponse.json({ user: { ...MOCK_ADMIN_USER, role: 'rep' } }),
      ),
    );
    renderWithProviders(<TestApp />);
    await waitFor(() => expect(screen.getByText('Access denied page')).toBeInTheDocument());
  });
});
