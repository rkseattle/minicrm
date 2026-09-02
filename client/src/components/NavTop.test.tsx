/**
 * Tests for the NavTop component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import NavTop from './NavTop.js';
import { installLocationHrefStub } from '../test/stubLocationHref.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { openUserMenu } from '../test/openUserMenu.js';
import { server } from '../test/setup.js';
import { ADMIN_USER, REP_USER } from '../test/msw/handlers.js';

describe('NavTop', () => {
  const assignedHref = installLocationHrefStub();

  it('renders the MiniCRM brand name', async () => {
    renderWithProviders(<NavTop />);
    await waitFor(() => {
      expect(screen.getByText('MiniCRM')).toBeInTheDocument();
    });
  });

  it('renders desktop nav links with nav-top-{destination} testids', async () => {
    renderWithProviders(<NavTop />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-top-dashboard')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-top-contacts')).toBeInTheDocument();
    expect(screen.getByTestId('nav-top-accounts')).toBeInTheDocument();
    expect(screen.getByTestId('nav-top-deals')).toBeInTheDocument();
    expect(screen.getByTestId('nav-top-tasks')).toBeInTheDocument();
  });

  it('shows admin links for admin users', async () => {
    renderWithProviders(<NavTop />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-top-users')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-top-settings')).toBeInTheDocument();
    expect(screen.getByTestId('nav-top-automation')).toBeInTheDocument();
    expect(screen.getByTestId('nav-top-reports')).toBeInTheDocument();
  });

  it('hides admin links for rep users', async () => {
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })));
    renderWithProviders(<NavTop />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-top-dashboard')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('nav-top-users')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-top-settings')).not.toBeInTheDocument();
  });

  it('renders no Profile Settings nav link for either role — it moved to the user menu', async () => {
    // Anchored on the admin-only Users link, which cannot render until /auth/me has
    // resolved for this actor. Asserting absence against an unresolved query would
    // pass for the wrong reason.
    for (const actor of [ADMIN_USER, REP_USER]) {
      server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: actor })));
      const { unmount } = renderWithProviders(<NavTop />);
      if (actor.role === 'admin') {
        await screen.findByTestId('nav-top-users');
      } else {
        await waitFor(() => {
          expect(screen.queryByTestId('nav-top-users')).not.toBeInTheDocument();
        });
        await screen.findByTestId('nav-top-dashboard');
      }
      expect(screen.queryByTestId('nav-top-profile')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('lets the desktop tab row scroll, so overflowing tabs stay reachable', async () => {
    renderWithProviders(<NavTop />);
    await screen.findByTestId('nav-top-dashboard');

    // An admin's tab set exceeds the lg breakpoint, and without this the last tabs are
    // pushed off-screen and the whole page scrolls sideways instead.
    const tabRow = screen.getByTestId('nav-top-dashboard').closest('nav');
    expect(tabRow).toHaveClass('overflow-x-auto');
  });

  it('renders the logout item in the user menu', async () => {
    renderWithProviders(<NavTop />);
    await openUserMenu();
    expect(screen.getByTestId('nav-logout')).toBeInTheDocument();
  });

  it('reaches Profile Settings through the user menu', async () => {
    renderWithProviders(<NavTop />);
    await openUserMenu();
    expect(screen.getByTestId('nav-user-menu-profile')).toBeInTheDocument();
  });

  it('renders the language selector in the user menu', async () => {
    renderWithProviders(<NavTop />);
    await openUserMenu();
    expect(screen.getByTestId('nav-language-select')).toBeInTheDocument();
  });

  it('renders the global search input', async () => {
    renderWithProviders(<NavTop />);
    await waitFor(() => {
      expect(screen.getByTestId('global-search-input')).toBeInTheDocument();
    });
  });

  it('shows the logged-in user name on the menu trigger', async () => {
    renderWithProviders(<NavTop />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-user-menu-button')).toHaveTextContent(ADMIN_USER.name);
    });
  });

  describe('mobile hamburger drawer', () => {
    it('renders the hamburger toggle', async () => {
      renderWithProviders(<NavTop />);
      await waitFor(() => {
        expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
      });
    });

    it('drawer is closed by default', async () => {
      renderWithProviders(<NavTop />);
      await waitFor(() => {
        expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('nav-top-dashboard-mobile')).not.toBeInTheDocument();
    });

    it('clicking the toggle opens the mobile drawer', async () => {
      const user = userEvent.setup();
      renderWithProviders(<NavTop />);
      await waitFor(() => {
        expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('nav-menu-toggle'));
      expect(screen.getByTestId('nav-top-dashboard-mobile')).toBeInTheDocument();
    });

    it('clicking the toggle again closes the drawer', async () => {
      const user = userEvent.setup();
      renderWithProviders(<NavTop />);
      await waitFor(() => {
        expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('nav-menu-toggle'));
      expect(screen.getByTestId('nav-top-dashboard-mobile')).toBeInTheDocument();
      await user.click(screen.getByTestId('nav-menu-toggle'));
      expect(screen.queryByTestId('nav-top-dashboard-mobile')).not.toBeInTheDocument();
    });

    it('mobile drawer has nav-top-{destination}-mobile testids', async () => {
      const user = userEvent.setup();
      renderWithProviders(<NavTop />);
      await waitFor(() => {
        expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('nav-menu-toggle'));
      expect(screen.getByTestId('nav-top-contacts-mobile')).toBeInTheDocument();
      expect(screen.getByTestId('nav-top-deals-mobile')).toBeInTheDocument();
    });
  });

  it('navigates to /login after logout is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/" element={<NavTop />} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>,
    );
    await user.click(await screen.findByTestId('nav-user-menu-button'));
    await user.click(screen.getByTestId('nav-logout'));
    // A full document load, not a route change — logout clears the query cache,
    // and a client-side navigation would leave root providers mounted to refetch
    // into the 401 interceptor. jsdom cannot navigate, so assert the assignment.
    await waitFor(() => {
      expect(assignedHref()).toBe('/login');
    });
  });
});
