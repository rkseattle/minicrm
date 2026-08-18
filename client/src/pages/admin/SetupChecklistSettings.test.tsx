/**
 * Tests for SetupChecklistSettings — onboarding checklist reset.
 *
 * Verifies:
 * - Reset section renders with the reset button
 * - Clicking Reset calls PUT /api/settings/onboarding with false
 * - Success confirmation appears after reset
 * - Error message appears when reset fails
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import SetupChecklistSettings from './SetupChecklistSettings.js';

describe('SetupChecklistSettings', () => {
  it('renders the reset onboarding section', async () => {
    renderWithProviders(<SetupChecklistSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('reset-onboarding-section')).toBeInTheDocument();
    });
  });

  it('renders the reset button', async () => {
    renderWithProviders(<SetupChecklistSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('reset-onboarding-button')).toBeInTheDocument();
    });
  });

  it('shows success confirmation after clicking Reset', async () => {
    let resetCalled = false;
    server.use(
      http.put('/api/v1/settings/onboarding', async ({ request }) => {
        const body = (await request.json()) as { onboarding_completed: boolean };
        if (body.onboarding_completed === false) resetCalled = true;
        return HttpResponse.json({ onboarding_completed: false });
      }),
    );

    renderWithProviders(<SetupChecklistSettings />);
    await waitFor(() => expect(screen.getByTestId('reset-onboarding-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('reset-onboarding-button'));

    await waitFor(() => {
      expect(resetCalled).toBe(true);
      expect(screen.getByTestId('reset-onboarding-success')).toBeInTheDocument();
    });
  });

  it('shows error message when reset fails', async () => {
    server.use(
      http.put('/api/v1/settings/onboarding', () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<SetupChecklistSettings />);
    await waitFor(() => expect(screen.getByTestId('reset-onboarding-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('reset-onboarding-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reset-onboarding-error')).toBeInTheDocument();
    });
  });
});
