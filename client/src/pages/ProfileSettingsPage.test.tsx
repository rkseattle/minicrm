/**
 * Tests for the ProfileSettingsPage component.
 * Covers: loading state, load error, page render, save, clear (system default), error feedback.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import ProfileSettingsPage from './ProfileSettingsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

describe('ProfileSettingsPage', () => {
  describe('loading state', () => {
    it('shows loading text while fetching the current preference', () => {
      server.use(http.get('/api/users/me/language', () => new Promise(() => {})));
      renderWithProviders(<ProfileSettingsPage />);
      expect(screen.getByTestId('profile-settings-loading')).toBeInTheDocument();
    });
  });

  describe('load error state', () => {
    it('shows an error alert when the language API fails on load', async () => {
      server.use(
        http.get('/api/users/me/language', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderWithProviders(<ProfileSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-settings-load-error')).toBeInTheDocument();
      });
    });

    it('does not render the form when the API fails on load', async () => {
      server.use(
        http.get('/api/users/me/language', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderWithProviders(<ProfileSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-settings-load-error')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('profile-settings-save')).not.toBeInTheDocument();
    });
  });

  describe('page render', () => {
    it('renders the page heading', async () => {
      renderWithProviders(<ProfileSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-settings-heading')).toBeInTheDocument();
      });
    });

    it('shows "Use system default" selected when user has no preference', async () => {
      renderWithProviders(<ProfileSettingsPage />);
      await waitFor(() => {
        const select = screen.getByTestId('preferred-language-select') as HTMLSelectElement;
        expect(select.value).toBe('__system_default__');
      });
    });

    it('shows the stored preference when the user has one', async () => {
      server.use(http.get('/api/users/me/language', () => HttpResponse.json({ language: 'fr' })));
      renderWithProviders(<ProfileSettingsPage />);
      await waitFor(() => {
        const select = screen.getByTestId('preferred-language-select') as HTMLSelectElement;
        expect(select.value).toBe('fr');
      });
    });

    it('renders the save button', async () => {
      renderWithProviders(<ProfileSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-settings-save')).toBeInTheDocument();
      });
    });
  });

  describe('save action', () => {
    it('shows success message after saving a language preference', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ProfileSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('preferred-language-select')).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId('preferred-language-select'), 'de');
      await user.click(screen.getByTestId('profile-settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('profile-settings-success')).toBeInTheDocument();
      });
    });

    it('does not show an error message after a successful save', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ProfileSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('preferred-language-select')).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId('preferred-language-select'), 'es');
      await user.click(screen.getByTestId('profile-settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('profile-settings-success')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('profile-settings-error')).not.toBeInTheDocument();
    });

    it('saves null when "Use system default" is selected', async () => {
      const capturedBodies: { language: string | null }[] = [];
      server.use(
        http.get('/api/users/me/language', () => HttpResponse.json({ language: 'fr' })),
        http.patch('/api/users/me/language', async ({ request }) => {
          const body = (await request.json()) as { language: string | null };
          capturedBodies.push(body);
          return HttpResponse.json({ language: null });
        }),
      );

      const user = userEvent.setup();
      renderWithProviders(<ProfileSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('preferred-language-select')).toBeInTheDocument();
      });

      await user.selectOptions(
        screen.getByTestId('preferred-language-select'),
        '__system_default__',
      );
      await user.click(screen.getByTestId('profile-settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('profile-settings-success')).toBeInTheDocument();
      });
      expect(capturedBodies[0]?.language).toBeNull();
    });

    it('shows an error message when the save request fails', async () => {
      server.use(
        http.patch('/api/users/me/language', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );

      const user = userEvent.setup();
      renderWithProviders(<ProfileSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('preferred-language-select')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('profile-settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('profile-settings-error')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('profile-settings-success')).not.toBeInTheDocument();
    });

    it('disables the save button while the mutation is pending', async () => {
      server.use(http.patch('/api/users/me/language', () => new Promise(() => {})));

      const user = userEvent.setup();
      renderWithProviders(<ProfileSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('profile-settings-save')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('profile-settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('profile-settings-save')).toBeDisabled();
      });
    });
  });
});
