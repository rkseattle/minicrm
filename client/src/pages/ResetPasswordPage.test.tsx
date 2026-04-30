/**
 * Tests for ResetPasswordPage (MINCRM-157).
 * Covers: missing token state, form field render, password mismatch validation,
 * complexity validation, successful reset redirects to home, token-invalid error
 * with re-request link, and loading state.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import ResetPasswordPage from './ResetPasswordPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

/** Renders ResetPasswordPage at /reset-password with the given token query param */
function renderResetPasswordPage(token?: string) {
  const path = token ? `/reset-password?token=${token}` : '/reset-password';
  return renderWithProviders(
    <Routes>
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/forgot-password" element={<div>Forgot Password</div>} />
      <Route path="/" element={<div>Home</div>} />
    </Routes>,
    { initialEntries: [path] },
  );
}

describe('ResetPasswordPage — missing token', () => {
  it('shows an invalid token error when no token is in the URL', () => {
    renderResetPasswordPage();
    expect(screen.getByTestId('reset-password-invalid-token')).toBeInTheDocument();
    expect(screen.getByTestId('reset-password-request-new-link')).toBeInTheDocument();
  });

  it('does not render the password form when token is missing', () => {
    renderResetPasswordPage();
    expect(screen.queryByTestId('reset-password-new')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reset-password-submit')).not.toBeInTheDocument();
  });
});

describe('ResetPasswordPage — with token', () => {
  it('renders the new password and confirm password fields', () => {
    renderResetPasswordPage('abc123token');
    expect(screen.getByTestId('reset-password-new')).toBeInTheDocument();
    expect(screen.getByTestId('reset-password-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('reset-password-submit')).toBeInTheDocument();
  });

  it('renders the inline password requirements hint', () => {
    renderResetPasswordPage('abc123token');
    expect(screen.getByTestId('reset-password-hint')).toBeInTheDocument();
  });

  it('does not show an error on initial render', () => {
    renderResetPasswordPage('abc123token');
    expect(screen.queryByTestId('reset-password-error')).not.toBeInTheDocument();
  });

  it('shows a mismatch error when passwords do not match', async () => {
    const user = userEvent.setup();
    renderResetPasswordPage('abc123token');

    await user.type(screen.getByTestId('reset-password-new'), 'NewPass1');
    await user.type(screen.getByTestId('reset-password-confirm'), 'DifferentPass1');
    await user.click(screen.getByTestId('reset-password-submit'));

    expect(screen.getByTestId('reset-password-error')).toHaveTextContent('do not match');
  });

  it('shows an error when the new password is too short', async () => {
    const user = userEvent.setup();
    renderResetPasswordPage('abc123token');

    await user.type(screen.getByTestId('reset-password-new'), 'Ab1');
    await user.type(screen.getByTestId('reset-password-confirm'), 'Ab1');
    await user.click(screen.getByTestId('reset-password-submit'));

    expect(screen.getByTestId('reset-password-error')).toHaveTextContent('at least');
  });

  it('shows an error when the password lacks complexity (no number)', async () => {
    const user = userEvent.setup();
    renderResetPasswordPage('abc123token');

    await user.type(screen.getByTestId('reset-password-new'), 'alllowercase');
    await user.type(screen.getByTestId('reset-password-confirm'), 'alllowercase');
    await user.click(screen.getByTestId('reset-password-submit'));

    expect(screen.getByTestId('reset-password-error')).toHaveTextContent('letter and one number');
  });

  it('redirects to home on successful submission', async () => {
    const user = userEvent.setup();
    renderResetPasswordPage('valid-token');

    await user.type(screen.getByTestId('reset-password-new'), 'NewPass1');
    await user.type(screen.getByTestId('reset-password-confirm'), 'NewPass1');
    await user.click(screen.getByTestId('reset-password-submit'));

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
  });

  it('shows a token-invalid error and re-request link when the server returns RESET_TOKEN_INVALID', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('/api/v1/auth/reset-password', () => {
        return HttpResponse.json(
          {
            error: {
              code: 'RESET_TOKEN_INVALID',
              message: 'This reset link is invalid or has expired.',
            },
          },
          { status: 400 },
        );
      }),
    );

    renderResetPasswordPage('expired-token');

    await user.type(screen.getByTestId('reset-password-new'), 'NewPass1');
    await user.type(screen.getByTestId('reset-password-confirm'), 'NewPass1');
    await user.click(screen.getByTestId('reset-password-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('reset-password-error')).toHaveTextContent(
        'invalid or has expired',
      );
      expect(screen.getByTestId('reset-password-request-new-link')).toBeInTheDocument();
    });
  });

  it('disables the submit button while the request is in flight', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('/api/v1/auth/reset-password', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({
          user: {
            id: '1',
            email: 'a@b.com',
            name: 'A',
            role: 'rep',
            status: 'active',
            must_change_password: false,
            created_at: '2025-01-01T00:00:00.000Z',
          },
        });
      }),
    );

    renderResetPasswordPage('valid-token');

    await user.type(screen.getByTestId('reset-password-new'), 'NewPass1');
    await user.type(screen.getByTestId('reset-password-confirm'), 'NewPass1');

    const submitButton = screen.getByTestId('reset-password-submit');
    await user.click(submitButton);

    expect(submitButton).toBeDisabled();
  });
});
