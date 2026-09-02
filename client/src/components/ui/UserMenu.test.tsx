/**
 * Tests for UserMenu — the header's consolidated per-user control.
 *
 * Verifies the WAI-ARIA menu button contract (aria attributes, focus on open,
 * roving keys, Escape and outside click), that each item does what it says, and
 * the two interactions the language select introduces: its own arrow keys must
 * survive the roving handler, and touching it must not close the menu.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import { installLocationHrefStub } from '../../test/stubLocationHref.js';
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
  const assignedHref = installLocationHrefStub();

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

  it('ArrowUp from the first item wraps to the last target', async () => {
    renderMenu();
    openMenu();
    await waitFor(() => expect(screen.getByTestId('nav-user-menu-profile')).toHaveFocus());

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });

    // The language select is the third roving target, so it is what "last" means.
    expect(screen.getByTestId('nav-language-select')).toHaveFocus();
  });

  it('End then Home moves to the last item and back to the first', async () => {
    renderMenu();
    openMenu();
    await waitFor(() => expect(screen.getByTestId('nav-user-menu-profile')).toHaveFocus());

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(screen.getByTestId('nav-language-select')).toHaveFocus();

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

  it('arrow keys walk from the first item to the language select', async () => {
    const user = userEvent.setup();
    renderMenu();
    openMenu();
    await waitFor(() => expect(screen.getByTestId('nav-user-menu-profile')).toHaveFocus());

    // Traversed rather than focused directly: the select sits outside the role="menu"
    // list, so nothing but the roving handler can put focus on it, and a test that
    // calls .focus() itself would pass against a menu no keyboard user can escape.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('nav-logout')).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('nav-language-select')).toHaveFocus();
  });

  it('arrow keys inside the language select stay with the select', async () => {
    const user = userEvent.setup();
    renderMenu();
    openMenu();
    await waitFor(() => expect(screen.getByTestId('nav-user-menu-profile')).toHaveFocus());

    await user.keyboard('{ArrowDown}{ArrowDown}');
    const languageSelect = screen.getByTestId('nav-language-select');
    expect(languageSelect).toHaveFocus();

    // The select owns its arrows for choosing an option; stealing them back into the
    // roving handler would leave the value unchangeable by keyboard.
    await user.keyboard('{ArrowDown}');
    expect(languageSelect).toHaveFocus();
  });

  it('arrow keys skip past the logout item while it is disabled', async () => {
    // Never resolves, so logoutMutation.isPending keeps nav-logout disabled.
    server.use(http.post('/api/v1/auth/logout', () => new Promise(() => {})));

    renderMenu();
    openMenu();
    fireEvent.click(screen.getByTestId('nav-logout'));
    openMenu();

    await waitFor(() => expect(screen.getByTestId('nav-logout')).toBeDisabled());
    await waitFor(() => expect(screen.getByTestId('nav-user-menu-profile')).toHaveFocus());

    // A disabled button ignores .focus(), so landing on it would strand the user:
    // every further press retries the same index and the select is unreachable.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });

    expect(screen.getByTestId('nav-language-select')).toHaveFocus();
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

  it('leaves for /login by full document load after a successful logout', async () => {
    server.use(
      http.post('/api/v1/auth/logout', () => HttpResponse.json({ message: 'Logged out' })),
    );

    renderMenu();
    openMenu();

    fireEvent.click(screen.getByTestId('nav-logout'));

    // A document load, not a route change: providers above the router survive a
    // client-side navigation, so their observers would refetch after the cache
    // clear and 401 into the interceptor's session-expired redirect.
    await waitFor(() => expect(assignedHref()).toBe('/login'));
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

describe('UserMenu — cache isolation between accounts', () => {
  // Installed for its side effect: logout assigns location.href, which jsdom
  // refuses. This block asserts on the cache, not on where it navigated.
  installLocationHrefStub();

  it('clears cached per-user data on logout, not merely invalidating it', async () => {
    server.use(
      http.post('/api/v1/auth/logout', () => HttpResponse.json({ message: 'Logged out' })),
    );

    // gcTime must not be 0 here: both renderWithProviders and this file's own
    // renderMenuWithRoute default to it, which garbage-collects entries on
    // unmount and makes the assertion pass whether or not logout cleared them.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(['users', 'me', 'navLayout'], { layout: 'left' });
    queryClient.setQueryData(['users', 'me', 'language'], { language: 'fr' });
    queryClient.setQueryData(['users', 'me', 'notification-preferences'], { email: false });

    renderWithProviders(<UserMenu userName={USER_NAME} />, { queryClient });

    fireEvent.click(screen.getByTestId('nav-user-menu-button'));
    fireEvent.click(screen.getByTestId('nav-logout'));

    // Reading the cache is what distinguishes "cleared" from "stale but still
    // readable" — the whole bug. Rendered output cannot tell them apart.
    await waitFor(() =>
      expect(queryClient.getQueryData(['users', 'me', 'navLayout'])).toBeUndefined(),
    );
    expect(queryClient.getQueryData(['users', 'me', 'language'])).toBeUndefined();
    expect(queryClient.getQueryData(['users', 'me', 'notification-preferences'])).toBeUndefined();
  });
});
