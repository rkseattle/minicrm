/**
 * Tests for ProfilePage.
 *
 * Covers: loading states, language preference form, notification preferences form,
 * save success/error feedback, and checkbox toggling.
 *
 * MINCRM-161, MINCRM-162, MINCRM-163
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import ProfilePage from './ProfilePage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

describe('ProfilePage', () => {
  describe('page render', () => {
    it('renders the page heading', async () => {
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-heading')).toBeInTheDocument();
      });
    });

    it('renders the language section after loading', async () => {
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-lang-section')).toBeInTheDocument();
      });
    });

    it('renders the notifications section', async () => {
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-notifications-section')).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows loading text while fetching language preference', () => {
      server.use(http.get('/api/users/me/language', () => new Promise(() => {})));
      renderWithProviders(<ProfilePage />);
      expect(screen.getByTestId('profile-lang-loading')).toBeInTheDocument();
    });

    it('shows loading text while fetching notification prefs', () => {
      server.use(http.get('/api/users/me/notification-preferences', () => new Promise(() => {})));
      renderWithProviders(<ProfilePage />);
      expect(screen.getByTestId('profile-prefs-loading')).toBeInTheDocument();
    });
  });

  describe('load error state', () => {
    it('shows error when language preference fails to load', async () => {
      server.use(
        http.get('/api/users/me/language', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-lang-error')).toBeInTheDocument();
      });
    });

    it('shows error when notification prefs fail to load', async () => {
      server.use(
        http.get('/api/users/me/notification-preferences', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-prefs-error')).toBeInTheDocument();
      });
    });
  });

  describe('language preference form', () => {
    it('renders the language select', async () => {
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-language-select')).toBeInTheDocument();
      });
    });

    it('shows success message after saving language preference', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-lang-section')).toBeInTheDocument();
      });
      await user.selectOptions(screen.getByTestId('profile-language-select'), 'fr');
      await user.click(screen.getByTestId('profile-lang-save'));
      await waitFor(() => {
        expect(screen.getByTestId('profile-lang-success')).toBeInTheDocument();
      });
    });

    it('shows error message when language save fails', async () => {
      server.use(
        http.patch('/api/users/me/language', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-lang-section')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('profile-lang-save'));
      await waitFor(() => {
        expect(screen.getByTestId('profile-lang-save-error')).toBeInTheDocument();
      });
    });

    it('disables save button while language mutation is pending', async () => {
      server.use(http.patch('/api/users/me/language', () => new Promise(() => {})));
      const user = userEvent.setup();
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-lang-save')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('profile-lang-save'));
      await waitFor(() => {
        expect(screen.getByTestId('profile-lang-save')).toBeDisabled();
      });
    });
  });

  describe('notification preferences form', () => {
    it('renders all three notification checkboxes', async () => {
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('notif-checkbox-notify_overdue_tasks')).toBeInTheDocument();
        expect(screen.getByTestId('notif-checkbox-notify_assignments')).toBeInTheDocument();
        expect(screen.getByTestId('notif-checkbox-notify_deal_stage_changes')).toBeInTheDocument();
      });
    });

    it('checkboxes reflect the loaded preferences (all true by default)', async () => {
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('notif-checkbox-notify_overdue_tasks')).toBeChecked();
        expect(screen.getByTestId('notif-checkbox-notify_assignments')).toBeChecked();
        expect(screen.getByTestId('notif-checkbox-notify_deal_stage_changes')).toBeChecked();
      });
    });

    it('reflects opted-out preferences loaded from server', async () => {
      server.use(
        http.get('/api/users/me/notification-preferences', () =>
          HttpResponse.json({
            preferences: {
              notify_overdue_tasks: false,
              notify_assignments: false,
              notify_deal_stage_changes: true,
            },
          }),
        ),
      );
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('notif-checkbox-notify_overdue_tasks')).not.toBeChecked();
        expect(screen.getByTestId('notif-checkbox-notify_assignments')).not.toBeChecked();
        expect(screen.getByTestId('notif-checkbox-notify_deal_stage_changes')).toBeChecked();
      });
    });

    it('toggling a checkbox updates its checked state', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('notif-checkbox-notify_overdue_tasks')).toBeChecked();
      });
      await user.click(screen.getByTestId('notif-checkbox-notify_overdue_tasks'));
      expect(screen.getByTestId('notif-checkbox-notify_overdue_tasks')).not.toBeChecked();
    });

    it('shows success message after saving notification prefs', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-prefs-save')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('profile-prefs-save'));
      await waitFor(() => {
        expect(screen.getByTestId('profile-prefs-success')).toBeInTheDocument();
      });
    });

    it('shows error message when prefs save fails', async () => {
      server.use(
        http.patch('/api/users/me/notification-preferences', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-prefs-save')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('profile-prefs-save'));
      await waitFor(() => {
        expect(screen.getByTestId('profile-prefs-save-error')).toBeInTheDocument();
      });
    });

    it('disables save button while prefs mutation is pending', async () => {
      server.use(http.patch('/api/users/me/notification-preferences', () => new Promise(() => {})));
      const user = userEvent.setup();
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-prefs-save')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('profile-prefs-save'));
      await waitFor(() => {
        expect(screen.getByTestId('profile-prefs-save')).toBeDisabled();
      });
    });
  });
});
