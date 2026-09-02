/**
 * Tests for the NavHamburger component.
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import NavHamburger from './NavHamburger.js';
import { installLocationHrefStub } from '../test/stubLocationHref.js';
import { server } from '../test/setup.js';
import { openUserMenu } from '../test/openUserMenu.js';
import { ADMIN_USER, REP_USER } from '../test/msw/handlers.js';

/**
 * Renders NavHamburger with all required providers.
 */
function renderNavHamburger() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <NavHamburger />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NavHamburger', () => {
  const assignedHref = installLocationHrefStub();

  it('renders the MiniCRM brand name', async () => {
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByText('MiniCRM')).toBeInTheDocument();
    });
  });

  it('renders the hamburger toggle button', async () => {
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
  });

  it('popover is closed by default', async () => {
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('nav-hamburger-drawer')).not.toBeInTheDocument();
  });

  it('clicking the toggle opens the popover', async () => {
    const user = userEvent.setup();
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('nav-menu-toggle'));
    expect(screen.getByTestId('nav-hamburger-drawer')).toBeInTheDocument();
  });

  it('drawer contains nav-hamburger-{destination} testids', async () => {
    const user = userEvent.setup();
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('nav-menu-toggle'));
    expect(screen.getByTestId('nav-hamburger-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('nav-hamburger-contacts')).toBeInTheDocument();
    expect(screen.getByTestId('nav-hamburger-accounts')).toBeInTheDocument();
    expect(screen.getByTestId('nav-hamburger-deals')).toBeInTheDocument();
    expect(screen.getByTestId('nav-hamburger-tasks')).toBeInTheDocument();
  });

  it('shows admin links in the drawer for admin users', async () => {
    const user = userEvent.setup();
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('nav-menu-toggle'));
    expect(screen.getByTestId('nav-hamburger-users')).toBeInTheDocument();
    expect(screen.getByTestId('nav-hamburger-settings')).toBeInTheDocument();
  });

  it('hides admin links in the drawer for rep users', async () => {
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })));
    const user = userEvent.setup();
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('nav-menu-toggle'));
    expect(screen.queryByTestId('nav-hamburger-users')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-hamburger-settings')).not.toBeInTheDocument();
  });

  it('renders no Profile Settings nav link for either role — it moved to the user menu', async () => {
    const user = userEvent.setup();
    // Anchored on the admin-only Users link, which cannot render until /auth/me has
    // resolved for this actor. Asserting absence against an unresolved query would
    // pass for the wrong reason.
    for (const actor of [ADMIN_USER, REP_USER]) {
      server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: actor })));
      const { unmount } = renderNavHamburger();
      await waitFor(() => {
        expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('nav-menu-toggle'));
      if (actor.role === 'admin') {
        await screen.findByTestId('nav-hamburger-users');
      } else {
        await waitFor(() => {
          expect(screen.queryByTestId('nav-hamburger-users')).not.toBeInTheDocument();
        });
        await screen.findByTestId('nav-hamburger-dashboard');
      }
      expect(screen.queryByTestId('nav-hamburger-profile')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('clicking the close button closes the popover', async () => {
    const user = userEvent.setup();
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('nav-menu-toggle'));
    expect(screen.getByTestId('nav-hamburger-drawer')).toBeInTheDocument();
    await user.click(screen.getByTestId('nav-hamburger-close'));
    expect(screen.queryByTestId('nav-hamburger-drawer')).not.toBeInTheDocument();
  });

  it('clicking a nav link closes the popover', async () => {
    const user = userEvent.setup();
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('nav-menu-toggle'));
    expect(screen.getByTestId('nav-hamburger-drawer')).toBeInTheDocument();
    await user.click(screen.getByTestId('nav-hamburger-contacts'));
    expect(screen.queryByTestId('nav-hamburger-drawer')).not.toBeInTheDocument();
  });

  it('pressing Escape closes the popover', async () => {
    const user = userEvent.setup();
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('nav-menu-toggle'));
    expect(screen.getByTestId('nav-hamburger-drawer')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('nav-hamburger-drawer')).not.toBeInTheDocument();
  });

  it('renders the language selector in the user menu', async () => {
    renderNavHamburger();
    await openUserMenu();
    expect(screen.getByTestId('nav-language-select')).toBeInTheDocument();
  });

  it('renders the logout item in the user menu', async () => {
    renderNavHamburger();
    await openUserMenu();
    expect(screen.getByTestId('nav-logout')).toBeInTheDocument();
  });

  it('reaches Profile Settings through the user menu', async () => {
    renderNavHamburger();
    await openUserMenu();
    expect(screen.getByTestId('nav-user-menu-profile')).toBeInTheDocument();
  });

  it('renders the global search input in the top bar', async () => {
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('global-search-input')).toBeInTheDocument();
    });
  });

  it('shows the logged-in user name on the menu trigger', async () => {
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('nav-user-menu-button')).toHaveTextContent(ADMIN_USER.name);
    });
  });

  it('Escape inside the user menu closes it and leaves the drawer open', async () => {
    renderNavHamburger();

    fireEvent.click(await screen.findByTestId('nav-menu-toggle'));
    expect(screen.getByTestId('nav-hamburger-drawer')).toBeInTheDocument();

    await openUserMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    // The drawer's own Escape is a document-level listener; the menu stops propagation
    // so the first Escape closes only the menu.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('nav-hamburger-drawer')).toBeInTheDocument();
  });

  it('navigates to /login after logout is clicked', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<NavHamburger />} />
            <Route path="/login" element={<div>Login page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
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
