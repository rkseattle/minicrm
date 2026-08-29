/**
 * Tests for UserMenu — the header's consolidated per-user control.
 *
 * Verifies the WAI-ARIA menu button contract (aria attributes, focus on open,
 * roving keys, Escape and outside click), that each item does what it says, and
 * the two interactions the language select introduces: its own arrow keys must
 * survive the roving handler, and touching it must not close the menu.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import { UserMenu } from './UserMenu.js';

const USER_NAME = 'Ada Lovelace';

function renderMenu() {
  return renderWithProviders(<UserMenu userName={USER_NAME} />);
}

/**
 * Renders the menu at "/" alongside a destination route, so a navigation assertion
 * reads the rendered route rather than window.location, which MemoryRouter never sets.
 */
function renderMenuWithRoute(path: string, marker: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<UserMenu userName={USER_NAME} />} />
          <Route path={path} element={<div>{marker}</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByTestId('nav-user-menu-button'));
}

describe('UserMenu', () => {
  it('renders the user name on the trigger', () => {
    renderMenu();

    expect(screen.getByTestId('nav-user-menu-button')).toHaveTextContent(USER_NAME);
  });

  it('trigger carries the menu button aria contract', () => {
    renderMenu();

    const trigger = screen.getByTestId('nav-user-menu-button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not render menu contents until opened', () => {
    renderMenu();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-user-menu-profile')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-logout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-language-select')).not.toBeInTheDocument();
  });

  it('opens on click, exposing all three controls', () => {
    renderMenu();
    openMenu();

    expect(screen.getByTestId('nav-user-menu-button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByTestId('nav-user-menu-profile')).toBeInTheDocument();
    expect(screen.getByTestId('nav-logout')).toBeInTheDocument();
    expect(screen.getByTestId('nav-language-select')).toBeInTheDocument();
  });

  it('closes on a second trigger click', () => {
    renderMenu();
    openMenu();
    openMenu();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('moves focus onto the first item when opened', async () => {
    renderMenu();
    openMenu();

    await waitFor(() => {
      expect(screen.getByTestId('nav-user-menu-profile')).toHaveFocus();
    });
  });

  it('closes on an outside click', () => {
    renderMenu();
    openMenu();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Escape closes the menu and restores focus to the trigger', () => {
    renderMenu();
    openMenu();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('nav-user-menu-button')).toHaveFocus();
  });

  it('Escape from inside the language select also closes the menu', () => {
    renderMenu();
    openMenu();

    fireEvent.keyDown(screen.getByTestId('nav-language-select'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('ArrowDown moves focus to the next item', async () => {
    renderMenu();
    openMenu();
    await waitFor(() => expect(screen.getByTestId('nav-user-menu-profile')).toHaveFocus());

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });

    expect(screen.getByTestId('nav-logout')).toHaveFocus();
  });

  it('ArrowUp from the first item wraps to the last', async () => {
    renderMenu();
    openMenu();
    await waitFor(() => expect(screen.getByTestId('nav-user-menu-profile')).toHaveFocus());

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });

    expect(screen.getByTestId('nav-logout')).toHaveFocus();
  });

  it('End then Home moves to the last item and back to the first', async () => {
    renderMenu();
    openMenu();
    await waitFor(() => expect(screen.getByTestId('nav-user-menu-profile')).toHaveFocus());

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(screen.getByTestId('nav-logout')).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
    expect(screen.getByTestId('nav-user-menu-profile')).toHaveFocus();
  });

  it('Tab closes the menu without restoring focus to the trigger', () => {
    renderMenu();
    openMenu();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('nav-user-menu-button')).not.toHaveFocus();
  });

  it('arrow keys inside the language select do not move menu focus', () => {
    renderMenu();
    openMenu();

    const languageSelect = screen.getByTestId('nav-language-select');
    languageSelect.focus();
    fireEvent.keyDown(languageSelect, { key: 'ArrowDown' });

    // Binding the roving handler any higher than the item list would move focus onto
    // a menu item here, costing the select its own native arrow behavior.
    expect(screen.getByTestId('nav-user-menu-profile')).not.toHaveFocus();
    expect(screen.getByTestId('nav-logout')).not.toHaveFocus();
    expect(languageSelect).toHaveFocus();
  });

  it('Tab out of the language select closes the menu', () => {
    renderMenu();
    openMenu();

    fireEvent.keyDown(screen.getByTestId('nav-language-select'), { key: 'Tab' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('names the menu itself, not only its wrapper', () => {
    renderMenu();
    openMenu();

    // A role="group" does not lend its name to a nested menu, so an unnamed menu
    // is announced without context.
    expect(screen.getByRole('menu')).toHaveAttribute('aria-label');
  });

  it('interacting with the language select leaves the menu open', async () => {
    server.use(
      http.patch('/api/v1/users/me/language', () => HttpResponse.json({ language: 'fr' })),
    );

    renderMenu();
    openMenu();

    fireEvent.mouseDown(screen.getByTestId('nav-language-select'));

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('selecting a language sends the preference to the API', async () => {
    let calledWith: string | null = null;
    server.use(
      http.patch('/api/v1/users/me/language', async ({ request }) => {
        const body = (await request.json()) as { language: string };
        calledWith = body.language;
        return HttpResponse.json({ language: body.language });
      }),
    );

    renderMenu();
    openMenu();

    fireEvent.change(screen.getByTestId('nav-language-select'), { target: { value: 'fr' } });

    await waitFor(() => expect(calledWith).toBe('fr'));
  });

  it('does not throw when the language API fails', async () => {
    server.use(
      http.patch('/api/v1/users/me/language', () =>
        HttpResponse.json({ error: { code: 'SERVER_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );

    renderMenu();
    openMenu();

    fireEvent.change(screen.getByTestId('nav-language-select'), { target: { value: 'fr' } });

    await waitFor(() => {
      expect(screen.getByTestId('nav-language-select')).toBeInTheDocument();
    });
  });

  it('Profile Settings navigates to /profile and closes the menu', async () => {
    renderMenuWithRoute('/profile', 'Profile page');
    openMenu();

    fireEvent.click(screen.getByTestId('nav-user-menu-profile'));

    await waitFor(() => expect(screen.getByText('Profile page')).toBeInTheDocument());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Log out calls POST /api/v1/auth/logout', async () => {
    let logoutCalled = false;
    server.use(
      http.post('/api/v1/auth/logout', () => {
        logoutCalled = true;
        return HttpResponse.json({ message: 'Logged out' });
      }),
    );

    renderMenu();
    openMenu();

    fireEvent.click(screen.getByTestId('nav-logout'));

    await waitFor(() => expect(logoutCalled).toBe(true));
  });

  it('navigates to /login after a successful logout', async () => {
    server.use(
      http.post('/api/v1/auth/logout', () => HttpResponse.json({ message: 'Logged out' })),
    );

    renderMenuWithRoute('/login', 'Login page');
    openMenu();

    fireEvent.click(screen.getByTestId('nav-logout'));

    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument());
  });

  it('renders a labeled language select', () => {
    renderMenu();
    openMenu();

    // The accessible name comes from a <label for> pairing, not aria-label — without
    // the id, axe reports select-name at serious.
    const languageSelect = screen.getByTestId('nav-language-select');
    const label = document.querySelector<HTMLLabelElement>('label[for="nav-user-menu-language"]');
    expect(label).not.toBeNull();
    // Asserted as non-empty rather than "Language": earlier cases in this file switch
    // the running locale, and the pairing is what carries the accessible name.
    expect(label?.textContent).not.toBe('');
    expect(languageSelect).toHaveAttribute('id', 'nav-user-menu-language');
  });

  it('ignores unhandled keys', () => {
    renderMenu();
    openMenu();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'a' });

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('returns focus to the trigger when an item closes the menu in place', () => {
    // Rendered without a destination route, so the menu survives the click and the
    // focus restore is observable — a keyboard user would otherwise land on <body>.
    renderMenu();
    openMenu();

    fireEvent.click(screen.getByTestId('nav-user-menu-profile'));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('nav-user-menu-button')).toHaveFocus();
  });
});
