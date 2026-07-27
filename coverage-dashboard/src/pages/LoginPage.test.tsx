import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import LoginPage from './LoginPage.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';

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
