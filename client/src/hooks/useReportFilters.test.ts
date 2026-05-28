import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useReportFilters } from './useReportFilters.js';

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
