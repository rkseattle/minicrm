/**
 * Unit tests for BreakpointContext / useBreakpoint.
 */

import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BreakpointProvider, useBreakpoint } from './BreakpointContext.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function TestComponent() {
  const { isMobile, isDesktop } = useBreakpoint();
  return (
    <div>
      <span data-testid="is-desktop">{String(isDesktop)}</span>
      <span data-testid="is-mobile">{String(isMobile)}</span>
    </div>
  );
}

function makeMatchMedia(matches: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  const mql = {
    matches,
    addEventListener: vi.fn((_: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.push(cb);
    }),
    removeEventListener: vi.fn(),
  };
  return { mql, listeners };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBreakpoint', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: originalMatchMedia,
    });
  });

  it('returns isDesktop: true when matchMedia matches (viewport >= 768px)', async () => {
    const { mql } = makeMatchMedia(true);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    await act(async () => {
      render(
        <BreakpointProvider>
          <TestComponent />
        </BreakpointProvider>,
      );
    });

    expect(screen.getByTestId('is-desktop').textContent).toBe('true');
    expect(screen.getByTestId('is-mobile').textContent).toBe('false');
  });

  it('returns isDesktop: false when matchMedia does not match (viewport < 768px)', async () => {
    const { mql } = makeMatchMedia(false);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    await act(async () => {
      render(
        <BreakpointProvider>
          <TestComponent />
        </BreakpointProvider>,
      );
    });

    expect(screen.getByTestId('is-desktop').textContent).toBe('false');
    expect(screen.getByTestId('is-mobile').textContent).toBe('true');
  });

  it('updates when the matchMedia change event fires', async () => {
    const { mql, listeners } = makeMatchMedia(false);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    await act(async () => {
      render(
        <BreakpointProvider>
          <TestComponent />
        </BreakpointProvider>,
      );
    });

    expect(screen.getByTestId('is-desktop').textContent).toBe('false');

    await act(async () => {
      listeners.forEach((cb) => cb({ matches: true } as MediaQueryListEvent));
    });

    expect(screen.getByTestId('is-desktop').textContent).toBe('true');
  });

  it('defaults to isDesktop: false before the useEffect fires (mobile-first SSR safety)', () => {
    // matchMedia unavailable — the effect guard exits early and state stays at
    // the useState(false) initial value, which is the correct mobile-first default.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: undefined,
    });

    render(
      <BreakpointProvider>
        <TestComponent />
      </BreakpointProvider>,
    );

    expect(screen.getByTestId('is-desktop').textContent).toBe('false');
    expect(screen.getByTestId('is-mobile').textContent).toBe('true');
  });
});
