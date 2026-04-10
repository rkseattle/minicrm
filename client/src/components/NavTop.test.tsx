/**
 * Tests for the NavTop component. (MINCRM-133)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import NavTop from './NavTop.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { ADMIN_USER, REP_USER } from '../test/msw/handlers.js';

describe('NavTop', () => {
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
    expect(screen.getByTestId('nav-top-win-loss')).toBeInTheDocument();
  });

  it('hides admin links for rep users', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ user: REP_USER })));
    renderWithProviders(<NavTop />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-top-dashboard')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('nav-top-users')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-top-settings')).not.toBeInTheDocument();
  });

  it('renders the logout button', async () => {
    renderWithProviders(<NavTop />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-logout')).toBeInTheDocument();
    });
  });

  it('renders the language selector', async () => {
    renderWithProviders(<NavTop />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-language-select')).toBeInTheDocument();
    });
  });

  it('renders the global search input', async () => {
    renderWithProviders(<NavTop />);
    await waitFor(() => {
      expect(screen.getByTestId('global-search-input')).toBeInTheDocument();
    });
  });

  it('shows the logged-in user name', async () => {
    renderWithProviders(<NavTop />);
    await waitFor(() => {
      expect(screen.getByText(ADMIN_USER.name)).toBeInTheDocument();
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

  it('navigates to /login after the mobile drawer logout button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/" element={<NavTop />} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('nav-menu-toggle'));
    await user.click(screen.getByTestId('nav-logout-mobile'));
    await waitFor(() => {
      expect(screen.getByText('Login page')).toBeInTheDocument();
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
    await waitFor(() => {
      expect(screen.getByTestId('nav-logout')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('nav-logout'));
    await waitFor(() => {
      expect(screen.getByText('Login page')).toBeInTheDocument();
    });
  });
});
