import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEntityConflictHandler } from './useEntityConflictHandler.js';

// Mock @tanstack/react-query
const mockGetQueryData = vi.fn();
const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: mockGetQueryData,
    invalidateQueries: mockInvalidateQueries,
  }),
}));

const QUERY_KEY = ['contacts', 'abc'] as const;

function renderConflictHook() {
  return renderHook(() =>
    useEntityConflictHandler({ entityCacheKey: 'contact', entityQueryKey: QUERY_KEY }),
  );
}

describe('useEntityConflictHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initialises all conflict state to null', () => {
    const { result } = renderConflictHook();
    expect(result.current.conflictBase).toBeNull();
    expect(result.current.conflictTheirs).toBeNull();
    expect(result.current.conflictPendingValues).toBeNull();
  });

  it('returns false and does not set state for non-conflict errors', () => {
    mockGetQueryData.mockReturnValue({ contact: { id: '1', name: 'Alice' } });

    const { result } = renderConflictHook();
    const error = { response: { data: { error: { code: 'SOME_OTHER_ERROR' } } } };

    let handled: boolean;
    act(() => {
      handled = result.current.handleConflict(error, { values: { name: 'Bob' } });
    });

    // @ts-expect-error — assigned in act
    expect(handled).toBe(false);
    expect(result.current.conflictBase).toBeNull();
    expect(result.current.conflictPendingValues).toBeNull();
  });

  it('sets conflict state and invalidates query on OPTIMISTIC_LOCK_CONFLICT', () => {
    const cachedContact = { id: '1', name: 'Alice', version: 3 };
    mockGetQueryData.mockReturnValue({ contact: cachedContact });

    const theirsCurrent = { id: '1', name: 'Charlie', version: 4 };
    const error = {
      response: {
        data: { error: { code: 'OPTIMISTIC_LOCK_CONFLICT', current: theirsCurrent } },
      },
    };
    const pending = { name: 'Bob', version: 3 };

    const { result } = renderConflictHook();

    let handled: boolean;
    act(() => {
      handled = result.current.handleConflict(error, { values: pending });
    });

    // @ts-expect-error — assigned in act
    expect(handled).toBe(true);
    expect(result.current.conflictBase).toEqual(cachedContact);
    expect(result.current.conflictPendingValues).toEqual(pending);
    expect(result.current.conflictTheirs).toEqual(theirsCurrent);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: QUERY_KEY });
  });

  it('falls back to empty object when cache entry is absent', () => {
    mockGetQueryData.mockReturnValue(undefined);

    const error = {
      response: { data: { error: { code: 'OPTIMISTIC_LOCK_CONFLICT', current: null } } },
    };

    const { result } = renderConflictHook();
    act(() => {
      result.current.handleConflict(error, { values: {} });
    });

    expect(result.current.conflictBase).toEqual({});
    expect(result.current.conflictTheirs).toBeNull();
  });

  it('clearConflict resets all three state vars to null', () => {
    mockGetQueryData.mockReturnValue({ contact: { id: '1' } });
    const error = {
      response: { data: { error: { code: 'OPTIMISTIC_LOCK_CONFLICT', current: { id: '1' } } } },
    };

    const { result } = renderConflictHook();
    act(() => {
      result.current.handleConflict(error, { values: { name: 'Bob' } });
    });

    act(() => {
      result.current.clearConflict();
    });

    expect(result.current.conflictBase).toBeNull();
    expect(result.current.conflictTheirs).toBeNull();
    expect(result.current.conflictPendingValues).toBeNull();
  });
});
