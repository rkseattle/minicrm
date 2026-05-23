/**
 * Tests for the UsersPage component.
 * Covers: loading state, user list rendering, empty state, invite form,
 * UserActionsMenu open/close and action behaviour, SetPasswordForm validation,
 * and invite/set-password error states. (MINCRM-303)
 */

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import UsersPage from './UsersPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { ADMIN_USER, REP_USER, INVITED_USER } from '../test/msw/handlers.js';

describe('UsersPage', () => {
  describe('loading state', () => {
    it('shows loading text while fetching users', () => {
      server.use(
        http.get('/api/v1/users', async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 });
        }),
      );
      renderWithProviders(<UsersPage />);
      expect(screen.getByText('Loading users…')).toBeInTheDocument();
    });
  });

  describe('user list', () => {
    it('renders the page title', async () => {
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'User Management' })).toBeInTheDocument();
      });
    });

    it('renders a row for each user', async () => {
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        // names appear in both mobile card and desktop table, so use getAllByText
        expect(screen.getAllByText(ADMIN_USER.name).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(REP_USER.name).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(INVITED_USER.name).length).toBeGreaterThanOrEqual(1);
      });
    });

    it('shows the Active badge for active users', async () => {
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
      });
    });

    it('shows the Invited badge for invited users', async () => {
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        // badge appears in both mobile card and desktop table
        expect(screen.getAllByText('Invited').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('renders a meatball trigger button for each user row', async () => {
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`user-actions-${ADMIN_USER.id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`user-actions-${REP_USER.id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`user-actions-${INVITED_USER.id}`)).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows empty state message when no users exist', async () => {
      server.use(
        http.get('/api/v1/users', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 }),
        ),
      );
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('No users yet.')).toBeInTheDocument();
      });
    });
  });

  describe('error state', () => {
    it('shows generic error alert when the users API fails', async () => {
      server.use(
        http.get('/api/v1/users', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  describe('invite form', () => {
    // jsdom starts with isDesktop=false so the form panel is collapsed by default.
    // Each test opens it via the toggle before interacting with fields.
    async function openInvitePanel(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByTestId('invite-form-toggle'));
    }

    it('renders invite form fields when panel is open', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await openInvitePanel(user);
      expect(screen.getByTestId('invite-name')).toBeInTheDocument();
      expect(screen.getByTestId('invite-email')).toBeInTheDocument();
      expect(screen.getByTestId('invite-role')).toBeInTheDocument();
      expect(screen.getByTestId('invite-submit')).toBeInTheDocument();
    });

    it('shows success message and set-password link after a successful invite', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await openInvitePanel(user);

      await user.type(screen.getByTestId('invite-name'), 'New User');
      await user.type(screen.getByTestId('invite-email'), 'new@example.com');
      await user.click(screen.getByTestId('invite-submit'));

      await waitFor(() => {
        const statusRegion = screen.getByRole('status');
        expect(
          within(statusRegion).getByText('User invited. Share the set-password link with them.'),
        ).toBeInTheDocument();
      });
    });

    it('clears the form after a successful invite', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await openInvitePanel(user);

      await user.type(screen.getByTestId('invite-name'), 'New User');
      await user.type(screen.getByTestId('invite-email'), 'new@example.com');
      await user.click(screen.getByTestId('invite-submit'));

      await waitFor(() => {
        expect(screen.getByRole('status')).toBeInTheDocument();
      });

      expect(screen.getByTestId('invite-name')).toHaveValue('');
      expect(screen.getByTestId('invite-email')).toHaveValue('');
    });
  });

  describe('UserActionsMenu — open/close behaviour', () => {
    it('menu is closed by default', async () => {
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`user-actions-${ADMIN_USER.id}`)).toBeInTheDocument();
      });
      expect(screen.queryByTestId(`deactivate-${ADMIN_USER.id}`)).not.toBeInTheDocument();
    });

    it('opens the menu when the meatball button is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`user-actions-${ADMIN_USER.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`user-actions-${ADMIN_USER.id}`));

      expect(screen.getByTestId(`deactivate-${ADMIN_USER.id}`)).toBeInTheDocument();
    });

    it('closes the menu when the meatball button is clicked again', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`user-actions-${ADMIN_USER.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`user-actions-${ADMIN_USER.id}`));
      expect(screen.getByTestId(`deactivate-${ADMIN_USER.id}`)).toBeInTheDocument();

      await user.click(screen.getByTestId(`user-actions-${ADMIN_USER.id}`));
      expect(screen.queryByTestId(`deactivate-${ADMIN_USER.id}`)).not.toBeInTheDocument();
    });

    it('closes the menu when clicking outside', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`user-actions-${ADMIN_USER.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`user-actions-${ADMIN_USER.id}`));
      expect(screen.getByTestId(`deactivate-${ADMIN_USER.id}`)).toBeInTheDocument();

      await user.click(document.body);
      expect(screen.queryByTestId(`deactivate-${ADMIN_USER.id}`)).not.toBeInTheDocument();
    });

    it('opening a second menu closes the first', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`user-actions-${ADMIN_USER.id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`user-actions-${REP_USER.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`user-actions-${ADMIN_USER.id}`));
      expect(screen.getByTestId(`deactivate-${ADMIN_USER.id}`)).toBeInTheDocument();

      await user.click(screen.getByTestId(`user-actions-${REP_USER.id}`));
      expect(screen.queryByTestId(`deactivate-${ADMIN_USER.id}`)).not.toBeInTheDocument();
      expect(screen.getByTestId(`deactivate-${REP_USER.id}`)).toBeInTheDocument();
    });
  });

  describe('UserActionsMenu — actions', () => {
    it('Make Rep item triggers a role mutation for an admin user', async () => {
      const user = userEvent.setup();
      let capturedBody: unknown;
      server.use(
        http.patch(`/api/v1/users/${ADMIN_USER.id}/role`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ user: { ...ADMIN_USER, role: 'rep' } });
        }),
      );

      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`user-actions-${ADMIN_USER.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`user-actions-${ADMIN_USER.id}`));
      await user.click(screen.getByTestId(`make-rep-${ADMIN_USER.id}`));

      await waitFor(() => {
        expect(capturedBody).toEqual({ role: 'rep' });
      });
    });

    it('Make Admin item triggers a role mutation for a rep user', async () => {
      const user = userEvent.setup();
      let capturedBody: unknown;
      server.use(
        http.patch(`/api/v1/users/${REP_USER.id}/role`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ user: { ...REP_USER, role: 'admin' } });
        }),
      );

      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`user-actions-${REP_USER.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`user-actions-${REP_USER.id}`));
      await user.click(screen.getByTestId(`make-admin-${REP_USER.id}`));

      await waitFor(() => {
        expect(capturedBody).toEqual({ role: 'admin' });
      });
    });

    it('Set Password item toggles the inline password form', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`user-actions-${ADMIN_USER.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`user-actions-${ADMIN_USER.id}`));
      await user.click(screen.getByTestId(`set-password-toggle-${ADMIN_USER.id}`));

      expect(screen.getByTestId(`set-password-form-${ADMIN_USER.id}`)).toBeInTheDocument();
    });

    it('Deactivate item triggers the deactivate mutation', async () => {
      const user = userEvent.setup();
      let deactivateCalled = false;
      server.use(
        http.patch(`/api/v1/users/${ADMIN_USER.id}/deactivate`, () => {
          deactivateCalled = true;
          return HttpResponse.json({ user: { ...ADMIN_USER, status: 'inactive' } });
        }),
      );

      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`user-actions-${ADMIN_USER.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`user-actions-${ADMIN_USER.id}`));
      await user.click(screen.getByTestId(`deactivate-${ADMIN_USER.id}`));

      await waitFor(() => {
        expect(deactivateCalled).toBe(true);
      });
    });

    it('Reactivate item triggers the reactivate mutation for inactive users', async () => {
      const INACTIVE_USER = { ...ADMIN_USER, status: 'inactive' as const };
      server.use(
        http.get('/api/v1/users', () =>
          HttpResponse.json({ data: [INACTIVE_USER], total: 1, page: 1, limit: 50 }),
        ),
      );

      let reactivateCalled = false;
      server.use(
        http.patch(`/api/v1/users/${INACTIVE_USER.id}/reactivate`, () => {
          reactivateCalled = true;
          return HttpResponse.json({ user: { ...INACTIVE_USER, status: 'active' } });
        }),
      );

      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`user-actions-${INACTIVE_USER.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`user-actions-${INACTIVE_USER.id}`));
      await user.click(screen.getByTestId(`reactivate-${INACTIVE_USER.id}`));

      await waitFor(() => {
        expect(reactivateCalled).toBe(true);
      });
    });

    it('menu closes after an action is triggered', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`user-actions-${ADMIN_USER.id}`)).toBeInTheDocument();
      });

      await user.click(screen.getByTestId(`user-actions-${ADMIN_USER.id}`));
      expect(screen.getByTestId(`deactivate-${ADMIN_USER.id}`)).toBeInTheDocument();

      await user.click(screen.getByTestId(`deactivate-${ADMIN_USER.id}`));
      expect(screen.queryByTestId(`deactivate-${ADMIN_USER.id}`)).not.toBeInTheDocument();
    });
  });

  describe('user status badges', () => {
    it('shows the Inactive badge for inactive users', async () => {
      const INACTIVE_USER = { ...ADMIN_USER, id: 'inactive-id', status: 'inactive' as const };
      server.use(
        http.get('/api/v1/users', () =>
          HttpResponse.json({ data: [INACTIVE_USER], total: 1, page: 1, limit: 50 }),
        ),
      );
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
      });
    });
  });

  describe('invite form — error state', () => {
    async function openInvitePanel(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByTestId('invite-form-toggle'));
    }

    it('shows an error alert when the invite API call fails', async () => {
      server.use(
        http.post('/api/v1/users/invite', () =>
          HttpResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: 'Email already in use' } },
            { status: 409 },
          ),
        ),
      );

      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await openInvitePanel(user);

      await user.type(screen.getByTestId('invite-name'), 'New User');
      await user.type(screen.getByTestId('invite-email'), 'existing@example.com');
      await user.click(screen.getByTestId('invite-submit'));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  describe('SetPasswordForm — validation branches', () => {
    async function openSetPasswordForm(user: ReturnType<typeof userEvent.setup>) {
      await waitFor(() => {
        expect(screen.getByTestId(`user-actions-${ADMIN_USER.id}`)).toBeInTheDocument();
      });
      await user.click(screen.getByTestId(`user-actions-${ADMIN_USER.id}`));
      await user.click(screen.getByTestId(`set-password-toggle-${ADMIN_USER.id}`));
      await waitFor(() => {
        expect(screen.getByTestId(`set-password-form-${ADMIN_USER.id}`)).toBeInTheDocument();
      });
    }

    it('shows a mismatch error when passwords do not match', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await openSetPasswordForm(user);

      await user.type(screen.getByTestId(`set-password-input-${ADMIN_USER.id}`), 'Password1');
      await user.type(screen.getByTestId(`set-password-confirm-${ADMIN_USER.id}`), 'Different1');
      await user.click(screen.getByTestId(`set-password-submit-${ADMIN_USER.id}`));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('shows a complexity error for a password that is too short', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await openSetPasswordForm(user);

      await user.type(screen.getByTestId(`set-password-input-${ADMIN_USER.id}`), 'Abc1');
      await user.type(screen.getByTestId(`set-password-confirm-${ADMIN_USER.id}`), 'Abc1');
      await user.click(screen.getByTestId(`set-password-submit-${ADMIN_USER.id}`));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('shows a complexity error when the password has no digit', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await openSetPasswordForm(user);

      await user.type(screen.getByTestId(`set-password-input-${ADMIN_USER.id}`), 'PasswordNoDigit');
      await user.type(
        screen.getByTestId(`set-password-confirm-${ADMIN_USER.id}`),
        'PasswordNoDigit',
      );
      await user.click(screen.getByTestId(`set-password-submit-${ADMIN_USER.id}`));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('shows a complexity error when the password has no letter', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await openSetPasswordForm(user);

      await user.type(screen.getByTestId(`set-password-input-${ADMIN_USER.id}`), '1234567890');
      await user.type(screen.getByTestId(`set-password-confirm-${ADMIN_USER.id}`), '1234567890');
      await user.click(screen.getByTestId(`set-password-submit-${ADMIN_USER.id}`));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('shows a complexity error when the password has no special character', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await openSetPasswordForm(user);

      await user.type(screen.getByTestId(`set-password-input-${ADMIN_USER.id}`), 'ValidPass1234');
      await user.type(screen.getByTestId(`set-password-confirm-${ADMIN_USER.id}`), 'ValidPass1234');
      await user.click(screen.getByTestId(`set-password-submit-${ADMIN_USER.id}`));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('submits successfully with a valid password and shows the success banner', async () => {
      server.use(
        http.post(`/api/v1/users/${ADMIN_USER.id}/admin-set-password`, () =>
          HttpResponse.json({ user: ADMIN_USER }),
        ),
      );

      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await openSetPasswordForm(user);

      await user.type(screen.getByTestId(`set-password-input-${ADMIN_USER.id}`), 'ValidP@ss1234!');
      await user.type(
        screen.getByTestId(`set-password-confirm-${ADMIN_USER.id}`),
        'ValidP@ss1234!',
      );
      await user.click(screen.getByTestId(`set-password-submit-${ADMIN_USER.id}`));

      await waitFor(() => {
        expect(screen.getByRole('status')).toBeInTheDocument();
      });
    });

    it('closes the set-password form when cancel is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await openSetPasswordForm(user);

      await user.click(screen.getByTestId(`set-password-cancel-${ADMIN_USER.id}`));

      await waitFor(() => {
        expect(screen.queryByTestId(`set-password-form-${ADMIN_USER.id}`)).not.toBeInTheDocument();
      });
    });
  });
});
