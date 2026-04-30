/**
 * Tests for GeneralSettings — Reset onboarding section (MINCRM-256).
 *
 * Verifies:
 * - Reset onboarding section renders for admin users
 * - Reset onboarding section does not render for rep users
 * - Clicking Reset calls PUT /api/settings/onboarding with false
 * - Success confirmation appears after reset
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import GeneralSettings from './GeneralSettings.js';

function mockAdminUser() {
  server.use(
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({
        user: {
          id: 'user-admin',
          email: 'admin@example.com',
          name: 'Admin User',
          role: 'admin',
          status: 'active',
          must_change_password: false,
        },
      }),
    ),
  );
}

function mockRepUser() {
  server.use(
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({
        user: {
          id: 'user-rep',
          email: 'rep@example.com',
          name: 'Rep User',
          role: 'rep',
          status: 'active',
          must_change_password: false,
        },
      }),
    ),
  );
}

describe('GeneralSettings — reset onboarding', () => {
  it('shows the reset onboarding section for admin users', async () => {
    mockAdminUser();
    renderWithProviders(<GeneralSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('reset-onboarding-section')).toBeInTheDocument();
    });
  });

  it('does not show the reset onboarding section for rep users', async () => {
    mockRepUser();
    renderWithProviders(<GeneralSettings />);

    // Wait for auth to resolve then confirm section absent
    await waitFor(() => {
      expect(screen.queryByTestId('reset-onboarding-section')).not.toBeInTheDocument();
    });
  });

  it('shows success confirmation after clicking Reset', async () => {
    mockAdminUser();
    let resetCalled = false;
    server.use(
      http.put('/api/v1/settings/onboarding', async ({ request }) => {
        const body = (await request.json()) as { onboarding_completed: boolean };
        if (body.onboarding_completed === false) resetCalled = true;
        return HttpResponse.json({ onboarding_completed: false });
      }),
    );

    renderWithProviders(<GeneralSettings />);

    await waitFor(() => expect(screen.getByTestId('reset-onboarding-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('reset-onboarding-button'));

    await waitFor(() => {
      expect(resetCalled).toBe(true);
      expect(screen.getByTestId('reset-onboarding-success')).toBeInTheDocument();
    });
  });

  it('shows error message when reset fails', async () => {
    mockAdminUser();
    server.use(
      http.put('/api/v1/settings/onboarding', () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<GeneralSettings />);

    await waitFor(() => expect(screen.getByTestId('reset-onboarding-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('reset-onboarding-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reset-onboarding-error')).toBeInTheDocument();
    });
  });
});
