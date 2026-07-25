import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
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
});
