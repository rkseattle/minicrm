/**
 * Tests for the NavHamburger component. (MINCRM-133, MINCRM-265)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import NavHamburger from './NavHamburger.js';
import { server } from '../test/setup.js';
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

  it('renders the language selector in the top bar', async () => {
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('nav-language-select')).toBeInTheDocument();
    });
  });

  it('renders the logout button in the top bar', async () => {
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('nav-logout')).toBeInTheDocument();
    });
  });

  it('renders the global search input in the top bar', async () => {
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByTestId('global-search-input')).toBeInTheDocument();
    });
  });

  it('shows the logged-in user name in the top bar', async () => {
    renderNavHamburger();
    await waitFor(() => {
      expect(screen.getByText(ADMIN_USER.name)).toBeInTheDocument();
    });
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
    await waitFor(() => {
      expect(screen.getByTestId('nav-logout')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('nav-logout'));
    await waitFor(() => {
      expect(screen.getByText('Login page')).toBeInTheDocument();
    });
  });
});
