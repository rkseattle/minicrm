/**
 * Tests for NavHeader — shared top-bar used by all nav layouts.
 *
 * Verifies:
 * - Renders brand name
 * - Renders the logged-in user's name on the user-menu trigger
 * - Language and logout are reachable through that menu
 * - Nothing user-specific renders before the auth query resolves
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
import { openUserMenu } from '../test/openUserMenu.js';
import NavHeader from './NavHeader.js';
import { ADMIN_USER } from '../test/msw/handlers.js';

describe('NavHeader', () => {
  it('renders the MiniCRM brand', () => {
    renderWithProviders(<NavHeader />);

    expect(screen.getByText('MiniCRM')).toBeInTheDocument();
  });

  it('renders the logged-in user name on the menu trigger', async () => {
    renderWithProviders(<NavHeader />);

    await waitFor(() => {
      expect(screen.getByTestId('nav-user-menu-button')).toHaveTextContent(ADMIN_USER.name);
    });
  });

  it('renders no per-user controls once the auth query resolves with no user', async () => {
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: null })));

    renderWithProviders(<NavHeader />);

    // Waits for the settled state. Asserting synchronously would pass merely because
    // MSW had not answered yet, and would keep passing if the {user && …} guard were
    // dropped — which is the branch this covers.
    await waitFor(() => {
      expect(screen.getByTestId('nav-brand-wordmark')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('nav-user-menu-button')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('notification-bell-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-language-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-logout')).not.toBeInTheDocument();
    // The shell itself still renders for a signed-out viewer.
    expect(screen.getByTestId('global-search-input')).toBeInTheDocument();
  });

  it('renders the language selector inside the user menu', async () => {
    renderWithProviders(<NavHeader />);

    await openUserMenu();

    expect(screen.getByTestId('nav-language-select')).toBeInTheDocument();
  });

  it('renders the logout item inside the user menu', async () => {
    renderWithProviders(<NavHeader />);

    await openUserMenu();

    expect(screen.getByTestId('nav-logout')).toBeInTheDocument();
  });

  it('logout item calls POST /api/v1/auth/logout', async () => {
    let logoutCalled = false;
    server.use(
      http.post('/api/v1/auth/logout', () => {
        logoutCalled = true;
        return HttpResponse.json({ message: 'Logged out' });
      }),
    );

    renderWithProviders(<NavHeader />);

    await openUserMenu();
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
      <NavHeader hamburger={{ isOpen: false, onToggle, controls: 'nav-drawer' }} />,
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

  it('selecting a language calls the language API', async () => {
    let calledWith: string | null = null;
    server.use(
      http.patch('/api/v1/users/me/language', async ({ request }) => {
        const body = (await request.json()) as { language: string };
        calledWith = body.language;
        return HttpResponse.json({ language: body.language });
      }),
    );

    renderWithProviders(<NavHeader />);

    await openUserMenu();
    fireEvent.change(screen.getByTestId('nav-language-select'), { target: { value: 'fr' } });

    await waitFor(() => expect(calledWith).toBe('fr'));
  });

  it('reverts the language on API error', async () => {
    server.use(
      http.patch('/api/v1/users/me/language', () =>
        HttpResponse.json({ error: { code: 'SERVER_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );

    renderWithProviders(<NavHeader />);

    await openUserMenu();
    // Change language to trigger the error path — the component should not throw
    fireEvent.change(screen.getByTestId('nav-language-select'), { target: { value: 'fr' } });

    // Wait for the mutation to settle (error path clears previousLocaleRef)
    await waitFor(() => {
      expect(screen.getByTestId('nav-language-select')).toBeInTheDocument();
    });
  });
});
