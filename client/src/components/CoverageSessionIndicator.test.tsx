/**
 * Tests for CoverageSessionIndicator (MINCRM-663).
 *
 * Verifies:
 * - Renders nothing when no coverage correlation ID is persisted
 * - Renders the indicator once a correlation ID appears (polled from localStorage)
 * - Check-out button submits window.__coverage__ (if present), ends the server
 *   session, and clears the indicator
 * - Check-out still clears the indicator when the dump submission fails
 * - Check-out still clears the indicator when the session was already ended
 *   server-side (e.g. from the dashboard)
 * - Server reconciliation: hides itself and clears the correlation ID once a
 *   background poll confirms the session is no longer active
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import CoverageSessionIndicator from './CoverageSessionIndicator.js';

const CORRELATION_ID_STORAGE_KEY = 'coverageCorrelationId';

const ACTIVE_SESSION = {
  id: 'session-1',
  label: 'Exploring the deals pipeline',
  source: 'manual' as const,
  status: 'active' as const,
  correlationId: 'corr-1',
  buildSha: 'abc123',
  environment: 'test',
  issueKey: null,
  startedById: 'user-1',
  startedAt: '2026-07-20T00:00:00.000Z',
  endedAt: null,
  version: 1,
};

/** In-memory localStorage substitute (same pattern as SetupChecklistWidget.test.tsx). */
function makeLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string): string | null => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => delete store[key]);
    }),
  };
}

let localStorageMock: ReturnType<typeof makeLocalStorageMock>;

/** Default: session is active and stays active — most tests override per-scenario. */
function mockActiveSession() {
  server.use(
    http.get('*/api/v1/admin/coverage/sessions/by-correlation/:correlationId', () =>
      HttpResponse.json({ session: ACTIVE_SESSION }),
    ),
  );
}

beforeEach(() => {
  localStorageMock = makeLocalStorageMock();
  vi.stubGlobal('localStorage', localStorageMock);
  mockActiveSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { __coverage__?: unknown }).__coverage__;
});

describe('CoverageSessionIndicator', () => {
  it('renders nothing when no coverage correlation ID is persisted', () => {
    renderWithProviders(<CoverageSessionIndicator />);
    expect(screen.queryByTestId('coverage-session-indicator')).not.toBeInTheDocument();
  });

  it('renders the indicator once a correlation ID is persisted', () => {
    localStorageMock.setItem(CORRELATION_ID_STORAGE_KEY, 'corr-1');
    renderWithProviders(<CoverageSessionIndicator />);
    expect(screen.getByTestId('coverage-session-indicator')).toBeInTheDocument();
  });

  it('checks out: no window.__coverage__ present, so no dump is submitted, ends the server session, and clears the indicator', async () => {
    localStorageMock.setItem(CORRELATION_ID_STORAGE_KEY, 'corr-1');
    let endCalled = false;
    server.use(
      http.post('*/api/v1/admin/coverage/dump', () => {
        throw new Error('dump must not be submitted when window.__coverage__ is absent');
      }),
      http.post('*/api/v1/admin/coverage/sessions/:sessionId/end', ({ params }) => {
        endCalled = true;
        expect(params['sessionId']).toBe(ACTIVE_SESSION.id);
        return HttpResponse.json({ session: { ...ACTIVE_SESSION, status: 'ended', version: 2 } });
      }),
    );
    renderWithProviders(<CoverageSessionIndicator />);
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-indicator')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('coverage-session-indicator-checkout-button'));

    await waitFor(() => {
      expect(screen.queryByTestId('coverage-session-indicator')).not.toBeInTheDocument();
    });
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(CORRELATION_ID_STORAGE_KEY);
    expect(endCalled).toBe(true);
  });

  it('checks out: submits window.__coverage__ as a browser-source dump when present', async () => {
    const coverageMap = { 'src/App.tsx': { path: 'src/App.tsx', s: { '0': 1 } } };
    (window as unknown as { __coverage__?: unknown }).__coverage__ = coverageMap;
    localStorageMock.setItem(CORRELATION_ID_STORAGE_KEY, 'corr-1');

    let capturedBody: unknown;
    server.use(
      http.post('*/api/v1/admin/coverage/dump', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ dump: { dumpId: 'dump-1' } }, { status: 201 });
      }),
      http.post('*/api/v1/admin/coverage/sessions/:sessionId/end', () =>
        HttpResponse.json({ session: { ...ACTIVE_SESSION, status: 'ended', version: 2 } }),
      ),
    );
    renderWithProviders(<CoverageSessionIndicator />);
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-indicator')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('coverage-session-indicator-checkout-button'));

    await waitFor(() => {
      expect(screen.queryByTestId('coverage-session-indicator')).not.toBeInTheDocument();
    });
    expect(capturedBody).toMatchObject({ source: 'browser', payload: coverageMap });
  });

  it('still clears the indicator on check-out even when the dump request fails', async () => {
    const coverageMap = { 'src/App.tsx': { path: 'src/App.tsx', s: { '0': 1 } } };
    (window as unknown as { __coverage__?: unknown }).__coverage__ = coverageMap;
    localStorageMock.setItem(CORRELATION_ID_STORAGE_KEY, 'corr-1');

    server.use(
      http.post('*/api/v1/admin/coverage/dump', () => new HttpResponse(null, { status: 409 })),
      http.post('*/api/v1/admin/coverage/sessions/:sessionId/end', () =>
        HttpResponse.json({ session: { ...ACTIVE_SESSION, status: 'ended', version: 2 } }),
      ),
    );
    renderWithProviders(<CoverageSessionIndicator />);
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-indicator')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('coverage-session-indicator-checkout-button'));

    await waitFor(() => {
      expect(screen.queryByTestId('coverage-session-indicator')).not.toBeInTheDocument();
    });
  });

  it('still clears the indicator on check-out when the session was already ended elsewhere', async () => {
    localStorageMock.setItem(CORRELATION_ID_STORAGE_KEY, 'corr-1');
    server.use(
      http.get('*/api/v1/admin/coverage/sessions/by-correlation/:correlationId', () =>
        HttpResponse.json({ error: { code: 'COVERAGE_SESSION_NOT_FOUND' } }, { status: 404 }),
      ),
    );
    renderWithProviders(<CoverageSessionIndicator />);
    await waitFor(() => {
      expect(screen.queryByTestId('coverage-session-indicator')).not.toBeInTheDocument();
    });
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(CORRELATION_ID_STORAGE_KEY);
  });

  it('reconciliation: clears the indicator once the background poll finds the session is no longer active', async () => {
    localStorageMock.setItem(CORRELATION_ID_STORAGE_KEY, 'corr-1');
    // Starts active — the indicator should render — then a later poll finds it gone.
    let callCount = 0;
    server.use(
      http.get('*/api/v1/admin/coverage/sessions/by-correlation/:correlationId', () => {
        callCount += 1;
        if (callCount === 1) {
          return HttpResponse.json({ session: ACTIVE_SESSION });
        }
        return HttpResponse.json(
          { error: { code: 'COVERAGE_SESSION_NOT_FOUND' } },
          { status: 404 },
        );
      }),
    );
    const queryClient = new (await import('@tanstack/react-query')).QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    renderWithProviders(<CoverageSessionIndicator />, { queryClient });
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-indicator')).toBeInTheDocument();
    });

    // Force the next reconciliation poll rather than waiting out the real interval.
    await queryClient.refetchQueries({ queryKey: ['coverage-session-reconcile'] });

    await waitFor(() => {
      expect(screen.queryByTestId('coverage-session-indicator')).not.toBeInTheDocument();
    });
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(CORRELATION_ID_STORAGE_KEY);
  });
});
