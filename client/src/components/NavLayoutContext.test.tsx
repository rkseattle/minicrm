/**
 * Tests for NavLayoutContext — NavLayoutProvider and useNavLayout hook.
 *
 * Verifies:
 * - Provider fetches the layout and exposes it to consumers
 * - Defaults to 'top' before the fetch resolves
 * - saveLayout calls the PATCH API and updates context value
 * - useNavLayout throws when called outside a NavLayoutProvider
 */

import { screen, fireEvent, waitFor, render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BreakpointProvider } from '@/context/BreakpointContext.js';
import { server } from '../test/setup.js';
import { NavLayoutProvider, useNavLayout } from './NavLayoutContext.js';
import { useNavLayoutPreference } from '@/hooks/useNavLayoutPreference.js';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderInProvider(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>
        <BreakpointProvider>
          <NavLayoutProvider>{ui}</NavLayoutProvider>
        </BreakpointProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LayoutConsumer() {
  const { layout, workspaceLayout, saveLayout } = useNavLayout();
  return (
    <div>
      <span data-testid="current-layout">{layout}</span>
      <span data-testid="workspace-layout">{workspaceLayout}</span>
      <button data-testid="save-left" onClick={() => void saveLayout('left')}>
        Set left
      </button>
    </div>
  );
}

/** Reads the resolved layout and clears the personal preference through the real hook. */
function ClearingConsumer() {
  const { layout } = useNavLayout();
  const { save } = useNavLayoutPreference();
  return (
    <div>
      <span data-testid="current-layout">{layout}</span>
      <button data-testid="clear-layout" onClick={() => save(null)}>
        Clear
      </button>
    </div>
  );
}

/** Pins both endpoints for one test: the workspace default and the personal value. */
function mockLayouts(workspace: string, personal: string | null) {
  server.use(
    http.get('/api/v1/settings/nav-layout', () => HttpResponse.json({ layout: workspace })),
    http.get('/api/v1/users/me/nav-layout', () => HttpResponse.json({ layout: personal })),
  );
}

describe('NavLayoutContext', () => {
  it('defaults to "top" before the fetch resolves', () => {
    renderInProvider(<LayoutConsumer />);

    expect(screen.getByTestId('current-layout').textContent).toBe('top');
  });

  it('exposes the layout fetched from the server', async () => {
    server.use(
      http.get('/api/v1/settings/nav-layout', () => HttpResponse.json({ layout: 'left' })),
    );

    renderInProvider(<LayoutConsumer />);

    await waitFor(() => {
      expect(screen.getByTestId('current-layout').textContent).toBe('left');
    });
  });

  it('saveLayout calls PATCH and updates the displayed layout', async () => {
    let patched = false;
    server.use(
      http.patch('/api/v1/settings/nav-layout', async ({ request }) => {
        const body = (await request.json()) as { layout: string };
        patched = true;
        return HttpResponse.json({ layout: body.layout });
      }),
    );

    renderInProvider(<LayoutConsumer />);

    await waitFor(() => expect(screen.getByTestId('current-layout')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('save-left'));

    await waitFor(() => {
      expect(patched).toBe(true);
      expect(screen.getByTestId('current-layout').textContent).toBe('left');
    });
  });

  it('useNavLayout throws when called outside NavLayoutProvider', () => {
    const consoleError = console.error;
    console.error = () => {};

    function Bare() {
      useNavLayout();
      return null;
    }

    expect(() => {
      render(
        <QueryClientProvider client={makeQueryClient()}>
          <MemoryRouter>
            <Bare />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    }).toThrow('useNavLayout must be used within a NavLayoutProvider');

    console.error = consoleError;
  });
});

describe('NavLayoutContext — resolving a personal preference', () => {
  it('prefers the user value over the workspace value', async () => {
    mockLayouts('top', 'left');
    renderInProvider(<LayoutConsumer />);

    await waitFor(() => expect(screen.getByTestId('current-layout').textContent).toBe('left'));
    expect(screen.getByTestId('workspace-layout').textContent).toBe('top');
  });

  it('falls back to the workspace value when the user has no preference', async () => {
    mockLayouts('hamburger', null);
    renderInProvider(<LayoutConsumer />);

    await waitFor(() => expect(screen.getByTestId('current-layout').textContent).toBe('hamburger'));
  });

  it('restores the workspace value when the preference is cleared in place', async () => {
    mockLayouts('hamburger', 'left');
    let stored: string | null = 'left';
    server.use(
      http.get('/api/v1/users/me/nav-layout', () => HttpResponse.json({ layout: stored })),
      http.patch('/api/v1/users/me/nav-layout', async ({ request }) => {
        const body = (await request.json()) as { layout: string | null };
        stored = body.layout;
        return HttpResponse.json({ layout: stored });
      }),
    );

    renderInProvider(<ClearingConsumer />);
    await waitFor(() => expect(screen.getByTestId('current-layout').textContent).toBe('left'));

    // Drive the real mutation in the mounted tree, rather than remounting with a
    // different mock — the fallback has to return through the cache, not a fresh read.
    fireEvent.click(screen.getByTestId('clear-layout'));

    await waitFor(() => expect(screen.getByTestId('current-layout').textContent).toBe('hamburger'));
  });

  it('falls back to "top" when neither value is set', async () => {
    mockLayouts('top', null);
    renderInProvider(<LayoutConsumer />);

    await waitFor(() => expect(screen.getByTestId('current-layout').textContent).toBe('top'));
  });
});
