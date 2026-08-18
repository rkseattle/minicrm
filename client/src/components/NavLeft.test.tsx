/**
 * Tests for the NavLeft component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import NavLeft from './NavLeft.js';
import { NavLayoutProvider } from './NavLayoutContext.js';
import { server } from '../test/setup.js';
import { ADMIN_USER, REP_USER } from '../test/msw/handlers.js';

/**
 * Renders NavLeft with all required providers.
 *
 * @param children - Content to render inside the sidebar layout.
 */
function renderNavLeft(children: React.ReactNode = <div data-testid="page-content">Content</div>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <NavLayoutProvider>
          <NavLeft>{children}</NavLeft>
        </NavLayoutProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NavLeft', () => {
  it('renders the MiniCRM brand name in the header', async () => {
    renderNavLeft();
    await waitFor(() => {
      expect(screen.getByText('MiniCRM')).toBeInTheDocument();
    });
  });

  it('renders nav links with nav-left-{destination} testids', async () => {
    renderNavLeft();
    await waitFor(() => {
      expect(screen.getByTestId('nav-left-dashboard')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-left-contacts')).toBeInTheDocument();
    expect(screen.getByTestId('nav-left-accounts')).toBeInTheDocument();
    expect(screen.getByTestId('nav-left-deals')).toBeInTheDocument();
    expect(screen.getByTestId('nav-left-tasks')).toBeInTheDocument();
  });

  it('shows admin links for admin users', async () => {
    renderNavLeft();
    await waitFor(() => {
      expect(screen.getByTestId('nav-left-users')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-left-settings')).toBeInTheDocument();
    expect(screen.getByTestId('nav-left-automation')).toBeInTheDocument();
    expect(screen.getByTestId('nav-left-reports')).toBeInTheDocument();
  });

  it('hides admin links for rep users', async () => {
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })));
    renderNavLeft();
    await waitFor(() => {
      expect(screen.getByTestId('nav-left-dashboard')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('nav-left-users')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-left-settings')).not.toBeInTheDocument();
  });

  it('renders the collapse toggle button', async () => {
    renderNavLeft();
    await waitFor(() => {
      expect(screen.getByTestId('nav-left-collapse-toggle')).toBeInTheDocument();
    });
  });

  it('renders the logout button', async () => {
    renderNavLeft();
    await waitFor(() => {
      expect(screen.getByTestId('nav-logout')).toBeInTheDocument();
    });
  });

  it('renders the language selector', async () => {
    renderNavLeft();
    await waitFor(() => {
      expect(screen.getByTestId('nav-language-select')).toBeInTheDocument();
    });
  });

  it('renders the global search input in the header', async () => {
    renderNavLeft();
    await waitFor(() => {
      expect(screen.getByTestId('global-search-input')).toBeInTheDocument();
    });
  });

  it('renders children in the main content area', async () => {
    renderNavLeft(<div data-testid="page-content">Page content</div>);
    await waitFor(() => {
      expect(screen.getByTestId('page-content')).toBeInTheDocument();
    });
  });

  it('shows user name', async () => {
    renderNavLeft();
    await waitFor(() => {
      expect(screen.getByText(ADMIN_USER.name)).toBeInTheDocument();
    });
  });

  describe('collapse toggle', () => {
    it('clicking collapse toggle hides the nav link labels', async () => {
      const user = userEvent.setup();
      renderNavLeft();
      await waitFor(() => {
        expect(screen.getByTestId('nav-left-collapse-toggle')).toBeInTheDocument();
      });
      // Nav link text is visible when expanded
      expect(screen.getByTestId('nav-left-contacts')).toHaveTextContent(/contacts/i);
      await user.click(screen.getByTestId('nav-left-collapse-toggle'));
      // After collapse, link shows only a single-letter abbreviation
      expect(screen.getByTestId('nav-left-contacts')).not.toHaveTextContent(/contacts/i);
    });

    it('clicking collapse toggle twice restores the nav link labels', async () => {
      const user = userEvent.setup();
      renderNavLeft();
      await waitFor(() => {
        expect(screen.getByTestId('nav-left-collapse-toggle')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('nav-left-collapse-toggle'));
      await user.click(screen.getByTestId('nav-left-collapse-toggle'));
      expect(screen.getByTestId('nav-left-contacts')).toHaveTextContent(/contacts/i);
    });
  });
});
