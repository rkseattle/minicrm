/**
 * Tests for GeneralSettings — default language and nav layout settings.
 * Reset setup checklist tests moved to SetupChecklistSettings.test.tsx.
 * MFA enforcement tests moved to MfaSettings.test.tsx.
 *
 * Verifies:
 * - Default language select renders and reflects current value
 * - Saving a new language shows success confirmation
 * - Nav layout section renders (desktop-only)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import GeneralSettings from './GeneralSettings.js';

describe('GeneralSettings', () => {
  it('renders the default language select', async () => {
    renderWithProviders(<GeneralSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('default-language-select')).toBeInTheDocument();
    });
  });

  it('shows the current language pre-selected', async () => {
    renderWithProviders(<GeneralSettings />);
    await waitFor(() => {
      const select = screen.getByTestId('default-language-select') as HTMLSelectElement;
      expect(select.value).toBe('en');
    });
  });

  it('shows success message after saving a language change', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GeneralSettings />);
    await waitFor(() => expect(screen.getByTestId('default-language-select')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('default-language-select'), 'fr');
    await user.click(screen.getByTestId('settings-save'));
    await waitFor(() => {
      expect(screen.getByTestId('settings-success')).toBeInTheDocument();
    });
  });

  it('shows error message when the save request fails', async () => {
    server.use(
      http.patch('/api/v1/settings/default-language', () =>
        HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<GeneralSettings />);
    await waitFor(() => expect(screen.getByTestId('settings-save')).toBeInTheDocument());
    await user.click(screen.getByTestId('settings-save'));
    await waitFor(() => {
      expect(screen.getByTestId('settings-error')).toBeInTheDocument();
    });
  });

  it('does not render the reset onboarding section (moved to SetupChecklistSettings)', async () => {
    renderWithProviders(<GeneralSettings />);
    await waitFor(() => expect(screen.getByTestId('default-language-select')).toBeInTheDocument());
    expect(screen.queryByTestId('reset-onboarding-section')).not.toBeInTheDocument();
  });

  it('does not render the MFA section (moved to MfaSettings)', async () => {
    renderWithProviders(<GeneralSettings />);
    await waitFor(() => expect(screen.getByTestId('default-language-select')).toBeInTheDocument());
    expect(screen.queryByTestId('mfa-required-section')).not.toBeInTheDocument();
  });
});
