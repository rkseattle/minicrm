/**
 * Tests for the AdminSettingsPage component.
 * Covers: loading state, load error state, default language display, save action,
 * validation rejection (400), success/error feedback, and demo data section (MINCRM-103).
 */

import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import i18n from 'i18next';
import AdminSettingsPage from './AdminSettingsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

describe('AdminSettingsPage', () => {
  describe('loading state', () => {
    it('shows loading text while fetching the current setting', () => {
      server.use(http.get('/api/settings/default-language', () => new Promise(() => {})));
      renderWithProviders(<AdminSettingsPage />);
      expect(screen.getByTestId('settings-loading')).toBeInTheDocument();
    });
  });

  describe('load error state', () => {
    it('shows an error alert when the settings API fails on load', async () => {
      server.use(
        http.get('/api/settings/default-language', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('settings-load-error')).toBeInTheDocument();
      });
    });

    it('does not render the form when the settings API fails on load', async () => {
      server.use(
        http.get('/api/settings/default-language', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('settings-load-error')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('settings-save')).not.toBeInTheDocument();
    });
  });

  describe('page render', () => {
    it('renders the page heading', async () => {
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('settings-heading')).toBeInTheDocument();
      });
    });

    it('renders the language select with the current default selected', async () => {
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        const select = screen.getByTestId('default-language-select') as HTMLSelectElement;
        expect(select).toBeInTheDocument();
        expect(select.value).toBe('en');
      });
    });

    it('renders the save button', async () => {
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('settings-save')).toBeInTheDocument();
      });
    });
  });

  describe('save action', () => {
    it('shows success message after a successful save', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('default-language-select')).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId('default-language-select'), 'fr');
      await user.click(screen.getByTestId('settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('settings-success')).toBeInTheDocument();
      });
    });

    it('does not show an error message after a successful save', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('default-language-select')).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId('default-language-select'), 'de');
      await user.click(screen.getByTestId('settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('settings-success')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('settings-error')).not.toBeInTheDocument();
    });

    it('shows an error message when the save request fails', async () => {
      server.use(
        http.patch('/api/settings/default-language', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );

      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('default-language-select')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('settings-error')).toBeInTheDocument();
      });
    });

    it('shows an error message when the server rejects the language value (400)', async () => {
      server.use(
        http.patch('/api/settings/default-language', () =>
          HttpResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: 'Invalid request' } },
            { status: 400 },
          ),
        ),
      );

      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('default-language-select')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('settings-error')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('settings-success')).not.toBeInTheDocument();
    });

    it('success message re-translates when the active language changes', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('default-language-select')).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId('default-language-select'), 'fr');
      await user.click(screen.getByTestId('settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('settings-success')).toBeInTheDocument();
      });

      // Verify the message is in English before switching
      expect(screen.getByTestId('settings-success')).toHaveTextContent('Default language updated.');

      // Switch the active language to French
      await act(async () => {
        await i18n.changeLanguage('fr');
      });

      // The success message should now reflect the French translation
      expect(screen.getByTestId('settings-success')).toHaveTextContent(
        'Langue par défaut mise à jour.',
      );
    });

    afterEach(async () => {
      // Reset language to English after any test that may change it
      await i18n.changeLanguage('en');
    });

    it('disables the save button while the mutation is pending', async () => {
      server.use(http.patch('/api/settings/default-language', () => new Promise(() => {})));

      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('settings-save')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('settings-save')).toBeDisabled();
      });
    });
  });

  // ── Demo data section (MINCRM-103) ─────────────────────────────────────────

  describe('demo data section', () => {
    it('renders the demo section', async () => {
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-section')).toBeInTheDocument();
      });
    });

    it('shows "No demo data" status badge when demo is inactive', async () => {
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-status-badge')).toHaveTextContent('No demo data');
      });
    });

    it('shows "Demo data active" status badge when demo is active', async () => {
      server.use(http.get('/api/admin/demo/status', () => HttpResponse.json({ active: true })));
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-status-badge')).toHaveTextContent('Demo data active');
      });
    });

    it('shows an error when demo status fails to load', async () => {
      server.use(
        http.get('/api/admin/demo/status', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-status-error')).toBeInTheDocument();
      });
    });

    it('seed button is disabled when demo data is active', async () => {
      server.use(http.get('/api/admin/demo/status', () => HttpResponse.json({ active: true })));
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-seed-button')).toBeDisabled();
      });
    });

    it('remove button is disabled when no demo data is present', async () => {
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-remove-button')).toBeDisabled();
      });
    });

    it('remove button is enabled when demo data is active', async () => {
      server.use(http.get('/api/admin/demo/status', () => HttpResponse.json({ active: true })));
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-remove-button')).not.toBeDisabled();
      });
    });

    it('seed button opens confirmation dialog', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-seed-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-seed-button'));
      expect(screen.getByTestId('demo-confirm-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('demo-confirm-title')).toHaveTextContent('Seed demo data?');
    });

    it('reset button opens confirmation dialog', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-reset-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-reset-button'));
      expect(screen.getByTestId('demo-confirm-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('demo-confirm-title')).toHaveTextContent('Reset demo data?');
    });

    it('remove button opens confirmation dialog when demo is active', async () => {
      server.use(http.get('/api/admin/demo/status', () => HttpResponse.json({ active: true })));
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-remove-button')).not.toBeDisabled();
      });
      await user.click(screen.getByTestId('demo-remove-button'));
      expect(screen.getByTestId('demo-confirm-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('demo-confirm-title')).toHaveTextContent('Remove demo data?');
    });

    it('cancel closes the confirmation dialog without acting', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-seed-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-seed-button'));
      expect(screen.getByTestId('demo-confirm-dialog')).toBeInTheDocument();
      await user.click(screen.getByTestId('demo-confirm-cancel'));
      expect(screen.queryByTestId('demo-confirm-dialog')).not.toBeInTheDocument();
      expect(screen.queryByTestId('demo-feedback')).not.toBeInTheDocument();
    });

    it('confirming seed shows success feedback', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-seed-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-seed-button'));
      await user.click(screen.getByTestId('demo-confirm-ok'));
      await waitFor(() => {
        expect(screen.getByTestId('demo-feedback')).toHaveTextContent(
          'Demo data seeded successfully.',
        );
      });
    });

    it('confirming reset shows success feedback', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-reset-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-reset-button'));
      await user.click(screen.getByTestId('demo-confirm-ok'));
      await waitFor(() => {
        expect(screen.getByTestId('demo-feedback')).toHaveTextContent(
          'Demo data reset successfully.',
        );
      });
    });

    it('confirming remove shows success feedback', async () => {
      server.use(http.get('/api/admin/demo/status', () => HttpResponse.json({ active: true })));
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-remove-button')).not.toBeDisabled();
      });
      await user.click(screen.getByTestId('demo-remove-button'));
      await user.click(screen.getByTestId('demo-confirm-ok'));
      await waitFor(() => {
        expect(screen.getByTestId('demo-feedback')).toHaveTextContent(
          'Demo data removed successfully.',
        );
      });
    });

    it('shows error feedback when seed fails', async () => {
      server.use(
        http.post('/api/admin/demo/seed', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-seed-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-seed-button'));
      await user.click(screen.getByTestId('demo-confirm-ok'));
      await waitFor(() => {
        expect(screen.getByTestId('demo-feedback')).toHaveTextContent(
          'Failed to seed demo data. Please try again.',
        );
      });
    });

    it('shows error feedback when reset fails', async () => {
      server.use(
        http.post('/api/admin/demo/reset', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-reset-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-reset-button'));
      await user.click(screen.getByTestId('demo-confirm-ok'));
      await waitFor(() => {
        expect(screen.getByTestId('demo-feedback')).toHaveTextContent(
          'Failed to reset demo data. Please try again.',
        );
      });
    });

    it('shows error feedback when remove fails', async () => {
      server.use(
        http.get('/api/admin/demo/status', () => HttpResponse.json({ active: true })),
        http.delete('/api/admin/demo', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('demo-remove-button')).not.toBeDisabled();
      });
      await user.click(screen.getByTestId('demo-remove-button'));
      await user.click(screen.getByTestId('demo-confirm-ok'));
      await waitFor(() => {
        expect(screen.getByTestId('demo-feedback')).toHaveTextContent(
          'Failed to remove demo data. Please try again.',
        );
      });
    });
  });
});
