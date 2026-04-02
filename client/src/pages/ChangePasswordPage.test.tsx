/**
 * Tests for the ChangePasswordPage component.
 * Covers: context banner render, form field render, validation errors,
 * successful submission redirect, and server error display.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import ChangePasswordPage from './ChangePasswordPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

/** Renders ChangePasswordPage with a stub home route for redirect verification */
function renderChangePasswordPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route path="/" element={<div>Home</div>} />
    </Routes>,
    { initialEntries: ['/change-password'] },
  );
}

describe('ChangePasswordPage', () => {
  it('renders the context banner', () => {
    renderChangePasswordPage();
    expect(screen.getByTestId('change-password-context-banner')).toBeInTheDocument();
    expect(screen.getByTestId('change-password-context-banner')).toHaveTextContent(
      'Your admin has set a temporary password',
    );
  });

  it('renders all form fields', () => {
    renderChangePasswordPage();
    expect(screen.getByTestId('change-password-current')).toBeInTheDocument();
    expect(screen.getByTestId('change-password-new')).toBeInTheDocument();
    expect(screen.getByTestId('change-password-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('change-password-submit')).toBeInTheDocument();
  });

  it('does not show an error alert on initial render', () => {
    renderChangePasswordPage();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error when passwords do not match', async () => {
    const user = userEvent.setup();
    renderChangePasswordPage();

    await user.type(screen.getByTestId('change-password-current'), 'OldPass1');
    await user.type(screen.getByTestId('change-password-new'), 'NewPass1');
    await user.type(screen.getByTestId('change-password-confirm'), 'DifferentPass1');
    await user.click(screen.getByTestId('change-password-submit'));

    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
  });

  it('shows an error when the new password is too short', async () => {
    const user = userEvent.setup();
    renderChangePasswordPage();

    await user.type(screen.getByTestId('change-password-current'), 'OldPass1');
    await user.type(screen.getByTestId('change-password-new'), 'Abc1');
    await user.type(screen.getByTestId('change-password-confirm'), 'Abc1');
    await user.click(screen.getByTestId('change-password-submit'));

    expect(screen.getByRole('alert')).toHaveTextContent('at least');
  });

  it('shows an error when the new password lacks complexity', async () => {
    const user = userEvent.setup();
    renderChangePasswordPage();

    await user.type(screen.getByTestId('change-password-current'), 'OldPass1');
    await user.type(screen.getByTestId('change-password-new'), 'alllowercase');
    await user.type(screen.getByTestId('change-password-confirm'), 'alllowercase');
    await user.click(screen.getByTestId('change-password-submit'));

    expect(screen.getByRole('alert')).toHaveTextContent('letter and one number');
  });

  it('redirects to home on successful submission', async () => {
    const user = userEvent.setup();
    renderChangePasswordPage();

    await user.type(screen.getByTestId('change-password-current'), 'OldPass1');
    await user.type(screen.getByTestId('change-password-new'), 'NewPass1');
    await user.type(screen.getByTestId('change-password-confirm'), 'NewPass1');
    await user.click(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
  });

  it('disables the submit button while the request is in flight', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('/api/auth/change-password', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({ message: 'Password changed successfully' });
      }),
    );

    renderChangePasswordPage();

    await user.type(screen.getByTestId('change-password-current'), 'OldPass1');
    await user.type(screen.getByTestId('change-password-new'), 'NewPass1');
    await user.type(screen.getByTestId('change-password-confirm'), 'NewPass1');

    const submitButton = screen.getByTestId('change-password-submit');
    await user.click(submitButton);

    expect(submitButton).toBeDisabled();
  });

  it('shows a server error when the API returns an error', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('/api/auth/change-password', () => {
        return HttpResponse.json(
          { error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect.' } },
          { status: 400 },
        );
      }),
    );

    renderChangePasswordPage();

    await user.type(screen.getByTestId('change-password-current'), 'WrongPass1');
    await user.type(screen.getByTestId('change-password-new'), 'NewPass1');
    await user.type(screen.getByTestId('change-password-confirm'), 'NewPass1');
    await user.click(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Current password is incorrect.');
    });
  });
});
