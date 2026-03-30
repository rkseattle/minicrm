/**
 * Tests for the AdminSettingsPage component.
 * Covers: loading state, load error state, default language display, save action,
 * validation rejection (400), success/error feedback.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
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
});
