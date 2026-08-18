/**
 * Tests for SetPasswordPage.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import SetPasswordPage from './SetPasswordPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

/** Renders SetPasswordPage at /set-password with the given token query param */
function renderSetPasswordPage(token?: string) {
  const path = token ? `/set-password?token=${token}` : '/set-password';
  return renderWithProviders(
    <Routes>
      <Route path="/set-password" element={<SetPasswordPage />} />
      <Route path="/login" element={<div>Login page</div>} />
    </Routes>,
    { initialEntries: [path] },
  );
}

describe('SetPasswordPage — missing token', () => {
  it('shows an invalid-token error when no token is present', () => {
    renderSetPasswordPage();
    expect(screen.getByTestId('set-password-invalid-token')).toBeInTheDocument();
  });

  it('does not render the password form when no token is present', () => {
    renderSetPasswordPage();
    expect(screen.queryByTestId('set-password-new')).not.toBeInTheDocument();
    expect(screen.queryByTestId('set-password-submit')).not.toBeInTheDocument();
  });
});

describe('SetPasswordPage — with token', () => {
  it('renders the password form when a token is present', () => {
    renderSetPasswordPage('abc123token');
    expect(screen.getByTestId('set-password-new')).toBeInTheDocument();
    expect(screen.getByTestId('set-password-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('set-password-submit')).toBeInTheDocument();
  });

  it('shows the password hint', () => {
    renderSetPasswordPage('abc123token');
    expect(screen.getByTestId('set-password-hint')).toBeInTheDocument();
  });

  it('shows no error on initial render', () => {
    renderSetPasswordPage('abc123token');
    expect(screen.queryByTestId('set-password-error')).not.toBeInTheDocument();
  });

  it('shows a mismatch error when passwords differ', async () => {
    const user = userEvent.setup();
    renderSetPasswordPage('abc123token');

    await user.type(screen.getByTestId('set-password-new'), 'NewP@ssw0rd!');
    await user.type(screen.getByTestId('set-password-confirm'), 'DifferentP@ss!');
    await user.click(screen.getByTestId('set-password-submit'));

    expect(screen.getByTestId('set-password-error')).toHaveTextContent('do not match');
  });

  it('shows a too-short error when password is below minimum length', async () => {
    const user = userEvent.setup();
    renderSetPasswordPage('abc123token');

    await user.type(screen.getByTestId('set-password-new'), 'Ab1!');
    await user.type(screen.getByTestId('set-password-confirm'), 'Ab1!');
    await user.click(screen.getByTestId('set-password-submit'));

    expect(screen.getByTestId('set-password-error')).toHaveTextContent('at least');
  });

  it('shows a complexity error when password has no number', async () => {
    const user = userEvent.setup();
    renderSetPasswordPage('abc123token');

    await user.type(screen.getByTestId('set-password-new'), 'alllowercase!');
    await user.type(screen.getByTestId('set-password-confirm'), 'alllowercase!');
    await user.click(screen.getByTestId('set-password-submit'));

    expect(screen.getByTestId('set-password-error')).toHaveTextContent('letter and one number');
  });

  it('shows a special-character error when password has no special character', async () => {
    const user = userEvent.setup();
    renderSetPasswordPage('abc123token');

    await user.type(screen.getByTestId('set-password-new'), 'ValidPass1234');
    await user.type(screen.getByTestId('set-password-confirm'), 'ValidPass1234');
    await user.click(screen.getByTestId('set-password-submit'));

    expect(screen.getByTestId('set-password-error')).toHaveTextContent('special character');
  });

  it('redirects to /login on successful submission', async () => {
    server.use(
      http.post('/api/v1/users/set-password', () => {
        return HttpResponse.json({ message: 'Password set successfully. You may now log in.' });
      }),
    );

    const user = userEvent.setup();
    renderSetPasswordPage('valid-token');

    await user.type(screen.getByTestId('set-password-new'), 'NewP@ssw0rd!');
    await user.type(screen.getByTestId('set-password-confirm'), 'NewP@ssw0rd!');
    await user.click(screen.getByTestId('set-password-submit'));

    await waitFor(() => {
      expect(screen.getByText('Login page')).toBeInTheDocument();
    });
  });

  it('shows already-activated message when server returns USER_ALREADY_ACTIVATED', async () => {
    server.use(
      http.post('/api/v1/users/set-password', () => {
        return HttpResponse.json(
          {
            error: {
              code: 'USER_ALREADY_ACTIVATED',
              message: 'This account has already been activated',
            },
          },
          { status: 409 },
        );
      }),
    );

    const user = userEvent.setup();
    renderSetPasswordPage('used-token');

    await user.type(screen.getByTestId('set-password-new'), 'NewP@ssw0rd!');
    await user.type(screen.getByTestId('set-password-confirm'), 'NewP@ssw0rd!');
    await user.click(screen.getByTestId('set-password-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('set-password-already-activated')).toBeInTheDocument();
    });
    expect(screen.getByTestId('set-password-login-link')).toBeInTheDocument();
  });

  it('disables the submit button while the request is in flight', async () => {
    server.use(
      http.post('/api/v1/users/set-password', async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return HttpResponse.json({ message: 'Password set successfully. You may now log in.' });
      }),
    );

    const user = userEvent.setup();
    renderSetPasswordPage('valid-token');

    await user.type(screen.getByTestId('set-password-new'), 'NewP@ssw0rd!');
    await user.type(screen.getByTestId('set-password-confirm'), 'NewP@ssw0rd!');
    await user.click(screen.getByTestId('set-password-submit'));

    expect(screen.getByTestId('set-password-submit')).toBeDisabled();
  });

  it('shows the generic error message when the server returns no structured error body', async () => {
    server.use(
      http.post('/api/v1/users/set-password', () => {
        return HttpResponse.json({}, { status: 500 });
      }),
    );

    const user = userEvent.setup();
    renderSetPasswordPage('valid-token');

    await user.type(screen.getByTestId('set-password-new'), 'NewP@ssw0rd!');
    await user.type(screen.getByTestId('set-password-confirm'), 'NewP@ssw0rd!');
    await user.click(screen.getByTestId('set-password-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('set-password-error')).toBeInTheDocument();
    });
  });
});
