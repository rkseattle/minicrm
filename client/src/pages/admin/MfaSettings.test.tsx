/**
 * Tests for MfaSettings — MFA enforcement toggle.
 *
 * Verifies:
 * - Section renders with the MFA checkbox
 * - Checkbox reflects mfa_required value from API
 * - Toggle shows success message on save
 * - Toggle shows error message when save fails
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import MfaSettings from './MfaSettings.js';

describe('MfaSettings', () => {
  it('renders the MFA required section', async () => {
    renderWithProviders(<MfaSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('mfa-required-section')).toBeInTheDocument();
    });
  });

  it('shows the MFA checkbox unchecked by default', async () => {
    renderWithProviders(<MfaSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('mfa-required-checkbox')).not.toBeChecked();
    });
  });

  it('shows the MFA checkbox checked when mfa_required is true', async () => {
    server.use(
      http.get('/api/v1/settings/mfa-required', () => HttpResponse.json({ mfa_required: true })),
    );
    renderWithProviders(<MfaSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('mfa-required-checkbox')).toBeChecked();
    });
  });

  it('shows success message after toggling the MFA checkbox', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MfaSettings />);
    await waitFor(() => expect(screen.getByTestId('mfa-required-checkbox')).toBeInTheDocument());
    await user.click(screen.getByTestId('mfa-required-checkbox'));
    await waitFor(() => {
      expect(screen.getByTestId('mfa-required-success')).toBeInTheDocument();
    });
  });

  it('shows error message when the MFA toggle save fails', async () => {
    server.use(
      http.patch('/api/v1/settings/mfa-required', () =>
        HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<MfaSettings />);
    await waitFor(() => expect(screen.getByTestId('mfa-required-checkbox')).toBeInTheDocument());
    await user.click(screen.getByTestId('mfa-required-checkbox'));
    await waitFor(() => {
      expect(screen.getByTestId('mfa-required-error')).toBeInTheDocument();
    });
  });
});
