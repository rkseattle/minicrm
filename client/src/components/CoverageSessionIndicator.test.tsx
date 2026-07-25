/**
 * Tests for CoverageSessionIndicator (MINCRM-663).
 *
 * Verifies:
 * - Renders nothing when no coverage correlation ID is persisted
 * - Renders the indicator once a correlation ID appears (polled from localStorage)
 * - Check-out button submits window.__coverage__ (if present) and clears the indicator
 * - Check-out still clears the indicator when the dump submission fails
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import CoverageSessionIndicator from './CoverageSessionIndicator.js';

const CORRELATION_ID_STORAGE_KEY = 'coverageCorrelationId';

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

beforeEach(() => {
  localStorageMock = makeLocalStorageMock();
  vi.stubGlobal('localStorage', localStorageMock);
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

  it('checks out: no window.__coverage__ present, so no dump is submitted, and the indicator clears', async () => {
    localStorageMock.setItem(CORRELATION_ID_STORAGE_KEY, 'corr-1');
    server.use(
      http.post('*/api/v1/admin/coverage/dump', () => {
        throw new Error('dump must not be submitted when window.__coverage__ is absent');
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
});
