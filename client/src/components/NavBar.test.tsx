/**
 * Tests for the NavBar dispatcher component. (MINCRM-133)
 *
 * NavBar reads the active layout from NavLayoutContext and renders the
 * appropriate layout component. These tests verify that the dispatch logic
 * works correctly for each layout value.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
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
  server.use(http.get('/api/settings/nav-layout', () => HttpResponse.json({ layout })));
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

describe('NavBar dispatcher', () => {
  it('renders NavTop when layout is "top"', async () => {
    renderNavBar('top');
    await waitFor(() => {
      expect(screen.getByTestId('nav-top-dashboard')).toBeInTheDocument();
    });
  });

  it('renders NavHamburger when layout is "hamburger"', async () => {
    renderNavBar('hamburger');
    await waitFor(() => {
      expect(screen.getByTestId('nav-menu-toggle')).toBeInTheDocument();
    });
    // NavHamburger does not show desktop links directly — only in the overlay
    expect(screen.queryByTestId('nav-top-dashboard')).not.toBeInTheDocument();
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
