/**
 * Tests for the NavBar dispatcher component.
 *
 * NavBar reads the active layout from NavLayoutContext and renders the
 * appropriate layout component. These tests verify that the dispatch logic
 * works correctly for each layout value, and that mobile viewports always
 * render NavTop regardless of the stored layout setting.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import NavBar from './NavBar.js';
import { NavLayoutProvider } from './NavLayoutContext.js';
import { server } from '../test/setup.js';

/**
 * Renders NavBar with NavLayoutProvider, overriding the server nav-layout response.
 *
 * @param layout - The nav layout to simulate ('top' | 'left' | 'hamburger').
 */
function renderNavBar(layout: 'top' | 'left' | 'hamburger') {
  server.use(http.get('/api/v1/settings/nav-layout', () => HttpResponse.json({ layout })));
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
          <NavBar />
        </NavLayoutProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Mocks window.matchMedia to simulate a given viewport state.
 * jsdom does not implement matchMedia, so we define it directly on window.
 *
 * @param matches - Whether the mobile media query should match.
 */
function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('NavBar dispatcher — desktop viewport', () => {
  beforeEach(() => {
    // Desktop: mobile query does not match.
    mockMatchMedia(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders NavTop when layout is "top"', async () => {
    renderNavBar('top');
    await waitFor(() => {
      expect(screen.getByTestId('nav-top-dashboard')).toBeInTheDocument();
    });
  });

  it('renders NavHamburger when layout is "hamburger"', async () => {
    renderNavBar('hamburger');
    // Wait until the layout query resolves and NavTop desktop links are gone —
    // NavHamburger omits desktop nav links (they live only inside the overlay drawer)
    await waitFor(() => {
      expect(screen.queryByTestId('nav-top-dashboard')).not.toBeInTheDocument();
    });
    // The hamburger toggle is the only interactive element visible without opening the overlay
    expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-left-dashboard')).not.toBeInTheDocument();
  });

  it('renders null (no nav element) when layout is "left"', async () => {
    renderNavBar('left');
    // NavBar returns null for left layout; sidebar is injected by LayoutShell in App.tsx
    // We just verify no top-nav or hamburger elements appear
    await waitFor(() => {
      // Give the query time to resolve
      expect(screen.queryByTestId('nav-top-dashboard')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('nav-menu-toggle')).not.toBeInTheDocument();
  });
});

describe('NavBar dispatcher — mobile viewport', () => {
  beforeEach(() => {
    // Mobile: mobile query matches regardless of stored layout.
    mockMatchMedia(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders NavTop when layout is "top"', async () => {
    renderNavBar('top');
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
  });

  it('renders NavTop (not NavHamburger) when layout is "hamburger"', async () => {
    renderNavBar('hamburger');
    // Mobile always renders NavTop — the stored layout setting is ignored.
    // NavTop's mobile drawer has the canonical mobile nav (logout, language selector).
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
    // NavHamburger-specific elements should not be present.
    expect(screen.queryByTestId('nav-hamburger-drawer')).not.toBeInTheDocument();
  });

  it('renders NavTop (not null) when layout is "left"', async () => {
    renderNavBar('left');
    // On mobile the left sidebar setting is ignored — NavTop renders instead.
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('nav-left-dashboard')).not.toBeInTheDocument();
  });
});
