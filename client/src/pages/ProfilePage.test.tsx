/**
 * Tests for ProfilePage.
 *
 * Covers: loading states, language preference form, notification preferences form,
 * save success/error feedback, checkbox toggling, and MFA section.
 */

import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import ProfilePage from './ProfilePage.js';
import i18n from '../i18n.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

describe('ProfilePage', () => {
  // Saving a language mutates the i18next singleton, which outlives the test that did
  // it — without this, assertions on English strings depend on which tests ran first.
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

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
      server.use(http.get('/api/v1/users/me/language', () => new Promise(() => {})));
      renderWithProviders(<ProfilePage />);
      expect(screen.getByTestId('profile-lang-loading')).toBeInTheDocument();
    });

    it('shows loading text while fetching notification prefs', () => {
      server.use(
        http.get('/api/v1/users/me/notification-preferences', () => new Promise(() => {})),
      );
      renderWithProviders(<ProfilePage />);
      expect(screen.getByTestId('profile-prefs-loading')).toBeInTheDocument();
    });
  });

  describe('load error state', () => {
    it('shows error when language preference fails to load', async () => {
      server.use(
        http.get('/api/v1/users/me/language', () =>
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
        http.get('/api/v1/users/me/notification-preferences', () =>
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

    it('sends null for Use system default, which the schema requires', async () => {
      let sent: unknown;
      server.use(
        http.patch('/api/v1/users/me/language', async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json({ language: null });
        }),
      );
      const user = userEvent.setup();
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-lang-section')).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId('profile-language-select'), '');
      await user.click(screen.getByTestId('profile-lang-save'));

      await waitFor(() => {
        expect(screen.getByTestId('profile-lang-success')).toBeInTheDocument();
      });
      expect(sent).toEqual({ language: null });
    });

    it('switches the interface on save, not just on the next page load', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-lang-section')).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId('profile-language-select'), 'fr');
      await user.click(screen.getByTestId('profile-lang-save'));

      await waitFor(() => {
        expect(i18n.language).toBe('fr');
      });
    });

    it('keeps the picked language visible when the save fails', async () => {
      server.use(
        http.patch('/api/v1/users/me/language', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-lang-section')).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId('profile-language-select'), 'de');
      await user.click(screen.getByTestId('profile-lang-save'));
      await waitFor(() => {
        expect(screen.getByTestId('profile-lang-save-error')).toBeInTheDocument();
      });

      // Clearing the pending choice before the request settles would discard it here and
      // force the user to pick again before retrying.
      expect(screen.getByTestId('profile-language-select')).toHaveValue('de');
    });

    it('shows error message when language save fails', async () => {
      server.use(
        http.patch('/api/v1/users/me/language', () =>
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
      server.use(http.patch('/api/v1/users/me/language', () => new Promise(() => {})));
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
        http.get('/api/v1/users/me/notification-preferences', () =>
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
        http.patch('/api/v1/users/me/notification-preferences', () =>
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
      server.use(
        http.patch('/api/v1/users/me/notification-preferences', () => new Promise(() => {})),
      );
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

  describe('MFA section', () => {
    it('renders the MFA section', async () => {
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-mfa-section')).toBeInTheDocument();
      });
    });

    it('shows loading while MFA status is fetching', () => {
      server.use(http.get('/api/v1/auth/mfa/status', () => new Promise(() => {})));
      renderWithProviders(<ProfilePage />);
      expect(screen.getByTestId('profile-mfa-loading')).toBeInTheDocument();
    });

    it('shows error when MFA status fails to load', async () => {
      server.use(
        http.get('/api/v1/auth/mfa/status', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-mfa-error')).toBeInTheDocument();
      });
    });

    it('shows "Disabled" badge when MFA is not enabled', async () => {
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-mfa-status-badge')).toHaveTextContent('Disabled');
      });
    });

    it('shows "Enabled" badge when MFA is enabled', async () => {
      server.use(
        http.get('/api/v1/auth/mfa/status', () =>
          HttpResponse.json({ enabled: true, recoveryCodesRemaining: 6 }),
        ),
      );
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-mfa-status-badge')).toHaveTextContent('Enabled');
      });
    });

    it('shows recovery codes count when MFA is enabled', async () => {
      server.use(
        http.get('/api/v1/auth/mfa/status', () =>
          HttpResponse.json({ enabled: true, recoveryCodesRemaining: 5 }),
        ),
      );
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-mfa-recovery-count')).toBeInTheDocument();
      });
    });

    it('shows the Enable 2FA button when MFA is disabled', async () => {
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-mfa-enable-button')).toBeInTheDocument();
      });
    });

    it('shows the Disable button when MFA is enabled', async () => {
      server.use(
        http.get('/api/v1/auth/mfa/status', () =>
          HttpResponse.json({ enabled: true, recoveryCodesRemaining: 8 }),
        ),
      );
      renderWithProviders(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByTestId('profile-mfa-disable-button')).toBeInTheDocument();
      });
    });

    it('opens the setup modal when Enable 2FA is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ProfilePage />);
      await waitFor(() =>
        expect(screen.getByTestId('profile-mfa-enable-button')).toBeInTheDocument(),
      );
      await user.click(screen.getByTestId('profile-mfa-enable-button'));
      expect(screen.getByTestId('mfa-setup-modal')).toBeInTheDocument();
    });

    it('opens the disable modal when Disable is clicked', async () => {
      server.use(
        http.get('/api/v1/auth/mfa/status', () =>
          HttpResponse.json({ enabled: true, recoveryCodesRemaining: 8 }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ProfilePage />);
      await waitFor(() =>
        expect(screen.getByTestId('profile-mfa-disable-button')).toBeInTheDocument(),
      );
      await user.click(screen.getByTestId('profile-mfa-disable-button'));
      expect(screen.getByTestId('mfa-disable-modal')).toBeInTheDocument();
    });

    it('shows the org-MFA-required banner when mfa_setup_required=1 is in the URL', async () => {
      renderWithProviders(<ProfilePage />, {
        initialEntries: ['/profile?mfa_setup_required=1'],
      });
      await waitFor(() => {
        expect(screen.getByTestId('profile-mfa-required-banner')).toBeInTheDocument();
      });
    });

    it('does not show the org-MFA-required banner without the query param', async () => {
      renderWithProviders(<ProfilePage />);
      await waitFor(() => expect(screen.getByTestId('profile-mfa-section')).toBeInTheDocument());
      expect(screen.queryByTestId('profile-mfa-required-banner')).not.toBeInTheDocument();
    });
  });
});

describe('nav layout preference form', () => {
  it('renders the select with the workspace-default option first', async () => {
    renderWithProviders(<ProfilePage />);

    const select = await screen.findByTestId('profile-navlayout-select');
    const options = within(select).getAllByRole('option');
    expect(options[0]).toHaveValue('');
    expect(options.map((o) => o.getAttribute('value'))).toEqual(['', 'top', 'left', 'hamburger']);
  });

  it('sends null when "Use workspace default" is saved, which is what clears it', async () => {
    let patchedBody: { layout: string | null } | null = null;
    server.use(
      http.get('/api/v1/users/me/nav-layout', () => HttpResponse.json({ layout: 'left' })),
      http.patch('/api/v1/users/me/nav-layout', async ({ request }) => {
        patchedBody = (await request.json()) as { layout: string | null };
        return HttpResponse.json(patchedBody);
      }),
    );

    renderWithProviders(<ProfilePage />);
    const select = await screen.findByTestId('profile-navlayout-select');
    await waitFor(() => expect(select).toHaveValue('left'));

    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('profile-navlayout-save'));

    await waitFor(() => expect(patchedBody).toEqual({ layout: null }));
  });

  it('sends the chosen layout on the wire and reports success', async () => {
    let patchedBody: { layout: string | null } | null = null;
    server.use(
      http.patch('/api/v1/users/me/nav-layout', async ({ request }) => {
        patchedBody = (await request.json()) as { layout: string | null };
        return HttpResponse.json(patchedBody);
      }),
    );

    renderWithProviders(<ProfilePage />);
    const select = await screen.findByTestId('profile-navlayout-select');

    fireEvent.change(select, { target: { value: 'hamburger' } });
    fireEvent.click(screen.getByTestId('profile-navlayout-save'));

    expect(await screen.findByTestId('profile-navlayout-success')).toBeInTheDocument();
    expect(patchedBody).toEqual({ layout: 'hamburger' });
  });

  it('keeps the picked layout visible and shows an error when the save fails', async () => {
    server.use(
      http.patch('/api/v1/users/me/nav-layout', () => HttpResponse.json({}, { status: 500 })),
    );

    renderWithProviders(<ProfilePage />);
    const select = await screen.findByTestId('profile-navlayout-select');

    fireEvent.change(select, { target: { value: 'left' } });
    fireEvent.click(screen.getByTestId('profile-navlayout-save'));

    expect(await screen.findByTestId('profile-navlayout-save-error')).toBeInTheDocument();
    expect(select).toHaveValue('left');
  });
});

describe('nav layout preference form — async states', () => {
  it('shows the loading state before the preference arrives', () => {
    server.use(http.get('/api/v1/users/me/nav-layout', () => new Promise(() => {})));

    renderWithProviders(<ProfilePage />);

    expect(screen.getByTestId('profile-navlayout-loading')).toBeInTheDocument();
  });

  it('shows the error state when the preference cannot be loaded', async () => {
    server.use(
      http.get('/api/v1/users/me/nav-layout', () => HttpResponse.json({}, { status: 500 })),
    );

    renderWithProviders(<ProfilePage />);

    expect(await screen.findByTestId('profile-navlayout-error')).toBeInTheDocument();
  });
});
