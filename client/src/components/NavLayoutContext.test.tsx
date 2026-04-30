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
  const { layout, saveLayout } = useNavLayout();
  return (
    <div>
      <span data-testid="current-layout">{layout}</span>
      <button data-testid="save-left" onClick={() => void saveLayout('left')}>
        Set left
      </button>
    </div>
  );
}

describe('NavLayoutContext', () => {
  it('defaults to "top" before the fetch resolves', () => {
    renderInProvider(<LayoutConsumer />);

    expect(screen.getByTestId('current-layout').textContent).toBe('top');
  });

  it('exposes the layout fetched from the server', async () => {
    server.use(
      http.get('/api/settings/nav-layout', () => HttpResponse.json({ layout: 'left' })),
    );

    renderInProvider(<LayoutConsumer />);

    await waitFor(() => {
      expect(screen.getByTestId('current-layout').textContent).toBe('left');
    });
  });

  it('saveLayout calls PATCH and updates the displayed layout', async () => {
    let patched = false;
    server.use(
      http.patch('/api/settings/nav-layout', async ({ request }) => {
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
