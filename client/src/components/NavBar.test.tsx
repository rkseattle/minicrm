/**
 * Tests for the NavBar component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import NavBar from './NavBar.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { ADMIN_USER, REP_USER } from '../test/msw/handlers.js';

describe('NavBar', () => {
  it('renders the MiniCRM brand name', async () => {
    renderWithProviders(<NavBar />);
    await waitFor(() => {
      expect(screen.getByText('MiniCRM')).toBeInTheDocument();
    });
  });

  it('renders the Dashboard nav link', async () => {
    renderWithProviders(<NavBar />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-dashboard')).toBeInTheDocument();
    });
  });

  it('renders the Users nav link for admin users', async () => {
    // Default handler returns ADMIN_USER
    renderWithProviders(<NavBar />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-users')).toBeInTheDocument();
    });
  });

  it('hides the Users nav link for rep users', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ user: REP_USER })));
    renderWithProviders(<NavBar />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-dashboard')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('nav-users')).not.toBeInTheDocument();
  });

  it('shows the logged-in user name', async () => {
    renderWithProviders(<NavBar />);
    await waitFor(() => {
      expect(screen.getByText(ADMIN_USER.name)).toBeInTheDocument();
    });
  });

  it('renders a logout button', async () => {
    renderWithProviders(<NavBar />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-logout')).toBeInTheDocument();
    });
  });

  it('navigates to /login after logout is clicked', async () => {
    const user = userEvent.setup();

    // Render NavBar inside a route tree so MemoryRouter can handle the redirect
    renderWithProviders(
      <Routes>
        <Route path="/" element={<NavBar />} />
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
