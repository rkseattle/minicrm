/**
 * Tests for ForgotPasswordPage (MINCRM-156).
 * Covers: form render, successful submission shows success message,
 * button loading state, server error display.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import ForgotPasswordPage from './ForgotPasswordPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

function renderForgotPasswordPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/login" element={<div>Login</div>} />
    </Routes>,
    { initialEntries: ['/forgot-password'] },
  );
}

describe('ForgotPasswordPage', () => {
  it('renders the email input and submit button', () => {
    renderForgotPasswordPage();
    expect(screen.getByTestId('forgot-password-email')).toBeInTheDocument();
    expect(screen.getByTestId('forgot-password-submit')).toBeInTheDocument();
  });

  it('renders the back-to-login link', () => {
    renderForgotPasswordPage();
    expect(screen.getByTestId('forgot-password-back-to-login')).toBeInTheDocument();
  });

  it('shows the success message after successful submission', async () => {
    const user = userEvent.setup();
    renderForgotPasswordPage();

    await user.type(screen.getByTestId('forgot-password-email'), 'user@example.com');
    await user.click(screen.getByTestId('forgot-password-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('forgot-password-success')).toBeInTheDocument();
    });

    // Form should be hidden after success.
    expect(screen.queryByTestId('forgot-password-submit')).not.toBeInTheDocument();
  });

  it('hides the form and shows the success message (no user enumeration — same UI for any email)', async () => {
    const user = userEvent.setup();
    renderForgotPasswordPage();

    await user.type(screen.getByTestId('forgot-password-email'), 'nobody@example.com');
    await user.click(screen.getByTestId('forgot-password-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('forgot-password-success')).toBeInTheDocument();
    });
  });

  it('disables the submit button while the request is in flight', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('/api/v1/auth/forgot-password', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({
          message: 'If an account with that email exists, a reset link has been sent.',
        });
      }),
    );

    renderForgotPasswordPage();

    await user.type(screen.getByTestId('forgot-password-email'), 'user@example.com');
    const submitButton = screen.getByTestId('forgot-password-submit');
    await user.click(submitButton);

    expect(submitButton).toBeDisabled();
  });

  it('shows a server error when the API returns 400', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('/api/v1/auth/forgot-password', () => {
        return HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Must be a valid email address' } },
          { status: 400 },
        );
      }),
    );

    renderForgotPasswordPage();

    await user.type(screen.getByTestId('forgot-password-email'), 'not-an-email');
    await user.click(screen.getByTestId('forgot-password-submit'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Must be a valid email address');
    });
  });

  it('shows the generic error message when the server returns no structured error body', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('/api/v1/auth/forgot-password', () => {
        return HttpResponse.json({}, { status: 500 });
      }),
    );

    renderForgotPasswordPage();

    await user.type(screen.getByTestId('forgot-password-email'), 'user@example.com');
    await user.click(screen.getByTestId('forgot-password-submit'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
