/**
 * Tests for NavHeader — shared top-bar used by all nav layouts.
 *
 * Verifies:
 * - Renders brand name
 * - Renders the logged-in user's name
 * - Language selector is present
 * - Logout button calls the logout API
 * - Hamburger toggle is rendered when hamburger prop is provided
 * - Hamburger shows correct aria-label based on isOpen
 * - Hamburger click calls onToggle
 * - No hamburger rendered when prop is omitted
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import NavHeader from './NavHeader.js';
import { ADMIN_USER } from '../test/msw/handlers.js';

describe('NavHeader', () => {
  it('renders the MiniCRM brand', () => {
    renderWithProviders(<NavHeader />);

    expect(screen.getByText('MiniCRM')).toBeInTheDocument();
  });

  it('renders the logged-in user name', async () => {
    renderWithProviders(<NavHeader />);

    await waitFor(() => {
      expect(screen.getByText(ADMIN_USER.name)).toBeInTheDocument();
    });
  });

  it('renders the language selector', () => {
    renderWithProviders(<NavHeader />);

    expect(screen.getByTestId('nav-language-select')).toBeInTheDocument();
  });

  it('renders the logout button', () => {
    renderWithProviders(<NavHeader />);

    expect(screen.getByTestId('nav-logout')).toBeInTheDocument();
  });

  it('logout button calls POST /api/auth/logout', async () => {
    let logoutCalled = false;
    server.use(
      http.post('/api/auth/logout', () => {
        logoutCalled = true;
        return HttpResponse.json({ message: 'Logged out' });
      }),
    );

    renderWithProviders(<NavHeader />);

    fireEvent.click(screen.getByTestId('nav-logout'));

    await waitFor(() => expect(logoutCalled).toBe(true));
  });

  it('does not render hamburger button when hamburger prop is omitted', () => {
    renderWithProviders(<NavHeader />);

    expect(screen.queryByTestId('nav-menu-toggle')).not.toBeInTheDocument();
  });

  it('renders hamburger button when hamburger prop is provided', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <NavHeader
        hamburger={{ isOpen: false, onToggle, controls: 'nav-drawer' }}
      />,
    );

    expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
  });

  it('hamburger has aria-expanded=false when closed', () => {
    renderWithProviders(
      <NavHeader hamburger={{ isOpen: false, onToggle: vi.fn(), controls: 'nav-drawer' }} />,
    );

    expect(screen.getByTestId('nav-menu-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  it('hamburger has aria-expanded=true when open', () => {
    renderWithProviders(
      <NavHeader hamburger={{ isOpen: true, onToggle: vi.fn(), controls: 'nav-drawer' }} />,
    );

    expect(screen.getByTestId('nav-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('clicking hamburger calls onToggle', () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <NavHeader hamburger={{ isOpen: false, onToggle, controls: 'nav-drawer' }} />,
    );

    fireEvent.click(screen.getByTestId('nav-menu-toggle'));

    expect(onToggle).toHaveBeenCalledOnce();
  });
});
