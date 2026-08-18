import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useReportFilters } from './useReportFilters.js';
import type { DatePreset } from './useReportFilters.js';

const mockUser = { id: 'admin-1', role: 'admin', name: 'Admin' };

vi.mock('@/hooks/useAuth.js', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: { users: [{ id: 'rep-1', name: 'Rep One' }] } })),
}));

describe('useReportFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to currentMonth preset', () => {
    const { result } = renderHook(() => useReportFilters());
    expect(result.current.preset).toBe('currentMonth');
  });

  it('accepts a custom initial preset', () => {
    const { result } = renderHook(() => useReportFilters('currentQuarter'));
    expect(result.current.preset).toBe('currentQuarter');
  });

  it('resolvedStart and resolvedEnd are ISO date strings', () => {
    const { result } = renderHook(() => useReportFilters());
    expect(result.current.resolvedStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.current.resolvedEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('resolvedStart <= resolvedEnd for all built-in presets', () => {
    const presets = ['thisWeek', 'currentMonth', 'currentQuarter'] as const;
    for (const preset of presets) {
      const { result } = renderHook(() => useReportFilters(preset));
      expect(result.current.resolvedStart <= result.current.resolvedEnd).toBe(true);
    }
  });

  it('effectiveOwnerId is admin userId in My View', () => {
    const { result } = renderHook(() => useReportFilters());
    act(() => {
      result.current.setViewMode('my');
    });
    expect(result.current.effectiveOwnerId).toBe(mockUser.id);
  });

  it('effectiveOwnerId is selectedOwnerId in Team View when set', () => {
    const { result } = renderHook(() => useReportFilters());
    act(() => {
      result.current.setViewMode('team');
      result.current.setSelectedOwnerId('rep-1');
    });
    expect(result.current.effectiveOwnerId).toBe('rep-1');
  });

  it('effectiveOwnerId is undefined in Team View with no selection', () => {
    const { result } = renderHook(() => useReportFilters());
    act(() => {
      result.current.setViewMode('team');
      result.current.setSelectedOwnerId('');
    });
    expect(result.current.effectiveOwnerId).toBeUndefined();
  });

  it('resolves every built-in preset to a UTC range at a month-end instant', () => {
    // The hook seeds one `now` per mount and threads it through every boundary,
    // so pinning the system clock here pins the whole hook — not just the
    // primitives utcDate.test.ts covers. 23:30 UTC on the last day of August is
    // already September for a viewer in UTC+13, which is where the old
    // local-calendar helpers diverged: endOfCurrentMonth returned 2026-09-29,
    // a month late. Fake timers are safe in this file — it does no DB or
    // network I/O, and the hook reads the clock once at mount.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-31T23:30:00.000Z'));

      const expected = {
        thisWeek: ['2026-08-31', '2026-08-31'],
        currentMonth: ['2026-08-01', '2026-08-31'],
        lastMonth: ['2026-07-01', '2026-07-31'],
        currentQuarter: ['2026-07-01', '2026-09-30'],
        lastQuarter: ['2026-04-01', '2026-06-30'],
      } as const;

      for (const [preset, [start, end]] of Object.entries(expected)) {
        const { result } = renderHook(() => useReportFilters(preset as DatePreset));
        expect(result.current.resolvedStart, `${preset} start`).toBe(start);
        expect(result.current.resolvedEnd, `${preset} end`).toBe(end);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-resolves across UTC midnight on a plain rerender, with no preset change', () => {
    // Regression test for the Greptile P1 on #371. The reported scenario is a
    // report that stays MOUNTED across a UTC calendar boundary — so the test
    // must not change the preset, which would mask the bug by forcing a
    // dependency change. Two earlier revisions both failed this: capturing
    // `now` in a useState initializer, and moving it into a useMemo whose
    // dependency array holds no time-varying value.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-31T23:30:00.000Z'));
      const { result, rerender } = renderHook(() => useReportFilters('currentMonth'));
      expect(result.current.resolvedStart).toBe('2026-08-01');
      expect(result.current.resolvedEnd).toBe('2026-08-31');

      vi.setSystemTime(new Date('2026-09-01T00:30:00.000Z'));

      // A plain rerender — no preset change, no dependency change.
      rerender();
      expect(result.current.resolvedStart).toBe('2026-09-01');
      expect(result.current.resolvedEnd).toBe('2026-09-30');

      // And an unrelated state change must not resurrect the stale range.
      act(() => {
        result.current.setViewMode('my');
      });
      expect(result.current.resolvedStart).toBe('2026-09-01');
      expect(result.current.resolvedEnd).toBe('2026-09-30');
    } finally {
      vi.useRealTimers();
    }
  });

  it('advances an idle report at UTC midnight without any user interaction', () => {
    // Second Greptile P1 on #371. Reading the clock during render is necessary
    // but not sufficient: an idle, focused report never re-renders on its own,
    // so it would sit on the previous month and — because its React Query key
    // carries the dates — never refetch either. A timer aimed at the next UTC
    // midnight forces the render. No rerender(), no setState, no clicks here:
    // only the clock and the timer.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-31T23:59:30.000Z'));
      const { result } = renderHook(() => useReportFilters('currentMonth'));
      expect(result.current.resolvedStart).toBe('2026-08-01');
      expect(result.current.resolvedEnd).toBe('2026-08-31');

      // Cross midnight by advancing timers, exactly as an untouched tab would.
      act(() => {
        vi.advanceTimersByTime(31_000);
      });

      expect(result.current.resolvedStart).toBe('2026-09-01');
      expect(result.current.resolvedEnd).toBe('2026-09-30');
    } finally {
      vi.useRealTimers();
    }
  });

  it('custom preset uses customStart/customEnd for resolved dates', () => {
    const { result } = renderHook(() => useReportFilters());
    act(() => {
      result.current.setPreset('custom');
      result.current.setCustomStart('2025-01-01');
      result.current.setCustomEnd('2025-01-31');
    });
    expect(result.current.resolvedStart).toBe('2025-01-01');
    expect(result.current.resolvedEnd).toBe('2025-01-31');
  });
});
