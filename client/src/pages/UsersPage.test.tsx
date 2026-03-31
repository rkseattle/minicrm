/**
 * Tests for the UsersPage component.
 * Covers: loading state, user list rendering, empty state, invite form,
 * and UserActionsMenu open/close and action behaviour.
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
        http.get('/api/users', async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return HttpResponse.json({ users: [] });
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
        // ADMIN_USER.name also appears in NavBar, so use getAllByText
        expect(screen.getAllByText(ADMIN_USER.name).length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText(REP_USER.name)).toBeInTheDocument();
        expect(screen.getByText(INVITED_USER.name)).toBeInTheDocument();
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
        expect(screen.getByText('Invited')).toBeInTheDocument();
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
      server.use(http.get('/api/users', () => HttpResponse.json({ users: [] })));
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByText('No users yet.')).toBeInTheDocument();
      });
    });
  });

  describe('error state', () => {
    it('shows generic error alert when the users API fails', async () => {
      server.use(
        http.get('/api/users', () =>
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
    it('renders invite form fields', async () => {
      renderWithProviders(<UsersPage />);
      await waitFor(() => {
        expect(screen.getByTestId('invite-name')).toBeInTheDocument();
        expect(screen.getByTestId('invite-email')).toBeInTheDocument();
        expect(screen.getByTestId('invite-role')).toBeInTheDocument();
        expect(screen.getByTestId('invite-submit')).toBeInTheDocument();
      });
    });

    it('shows success message and set-password link after a successful invite', async () => {
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);

      await waitFor(() => {
        expect(screen.getByTestId('invite-name')).toBeInTheDocument();
      });

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

      await waitFor(() => {
        expect(screen.getByTestId('invite-name')).toBeInTheDocument();
      });

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
        http.patch(`/api/users/${ADMIN_USER.id}/role`, async ({ request }) => {
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
        http.patch(`/api/users/${REP_USER.id}/role`, async ({ request }) => {
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
        http.patch(`/api/users/${ADMIN_USER.id}/deactivate`, () => {
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
      server.use(http.get('/api/users', () => HttpResponse.json({ users: [INACTIVE_USER] })));

      let reactivateCalled = false;
      server.use(
        http.patch(`/api/users/${INACTIVE_USER.id}/reactivate`, () => {
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
});
