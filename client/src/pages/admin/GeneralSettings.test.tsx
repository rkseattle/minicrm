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

describe('GeneralSettings — nav layout control vs a personal override', () => {
  it("checks the workspace radio, not the admin's own layout", async () => {
    // This control edits the workspace row, so it shows the workspace value.
    server.use(
      http.get('/api/v1/settings/nav-layout', () => HttpResponse.json({ layout: 'top' })),
      http.get('/api/v1/users/me/nav-layout', () => HttpResponse.json({ layout: 'left' })),
    );

    renderWithProviders(<GeneralSettings />);

    await waitFor(() =>
      expect(screen.getByTestId('nav-layout-option-top')).toHaveAttribute('aria-checked', 'true'),
    );
    expect(screen.getByTestId('nav-layout-option-left')).toHaveAttribute('aria-checked', 'false');
  });

  it("saves a workspace layout equal to the admin's personal one", async () => {
    // The workspace row is what this saves, independent of the admin's own layout.
    server.use(
      http.get('/api/v1/settings/nav-layout', () => HttpResponse.json({ layout: 'top' })),
      http.get('/api/v1/users/me/nav-layout', () => HttpResponse.json({ layout: 'left' })),
    );

    let patched = false;
    server.use(
      http.patch('/api/v1/settings/nav-layout', async ({ request }) => {
        patched = true;
        const body = (await request.json()) as { layout: string };
        return HttpResponse.json({ layout: body.layout });
      }),
    );

    renderWithProviders(<GeneralSettings />);
    await waitFor(() =>
      expect(screen.getByTestId('nav-layout-option-top')).toHaveAttribute('aria-checked', 'true'),
    );

    await userEvent.click(screen.getByTestId('nav-layout-option-left'));

    await waitFor(() => expect(patched).toBe(true));
  });
});

describe('GeneralSettings — nav layout hint copy', () => {
  it('says the workspace layout is a default a user can override', async () => {
    renderWithProviders(<GeneralSettings />);

    const hint = await screen.findByText(/default navigation layout/i);
    expect(hint).toHaveTextContent(/Profile Settings/i);
  });
});
