/**
 * Tests for the usePermissions hook.
 */

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePermissions } from './usePermissions.js';

vi.mock('./useAuth.js');

import { useAuth } from './useAuth.js';
const mockUseAuth = vi.mocked(useAuth);

describe('usePermissions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns canWrite=true for admin', () => {
    mockUseAuth.mockReturnValue({ user: { role: 'admin' } } as ReturnType<typeof useAuth>);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.canWrite).toBe(true);
  });

  it('returns canWrite=true for rep', () => {
    mockUseAuth.mockReturnValue({ user: { role: 'rep' } } as ReturnType<typeof useAuth>);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.canWrite).toBe(true);
  });

  it('returns canWrite=true for manager', () => {
    mockUseAuth.mockReturnValue({ user: { role: 'manager' } } as ReturnType<typeof useAuth>);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.canWrite).toBe(true);
  });

  it('returns canWrite=false for viewer', () => {
    mockUseAuth.mockReturnValue({ user: { role: 'viewer' } } as ReturnType<typeof useAuth>);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.canWrite).toBe(false);
  });

  it('returns canWrite=false for service_account', () => {
    mockUseAuth.mockReturnValue({ user: { role: 'service_account' } } as ReturnType<
      typeof useAuth
    >);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.canWrite).toBe(false);
  });

  it('returns canWrite=true when user is null', () => {
    mockUseAuth.mockReturnValue({ user: null } as ReturnType<typeof useAuth>);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.canWrite).toBe(true);
  });
});

describe('usePermissions — can()', () => {
  it('reads the server-resolved capability set, not the role name', () => {
    mockUseAuth.mockReturnValue({
      user: { role: 'rep' } as never,
      capabilities: ['reports:view', 'reports:create'],
      isLoading: false,
      isAuthenticated: true,
    });

    const { result } = renderHook(() => usePermissions());
    expect(result.current.can('reports:create')).toBe(true);
    expect(result.current.can('reports:delete')).toBe(false);
  });

  it('falls back to the built-in grants when the response carries no capabilities', () => {
    // An older cached /auth/me predates the field; hiding every gated control would be worse
    // than deferring to the role's defaults until it refreshes.
    mockUseAuth.mockReturnValue({
      user: { role: 'admin' } as never,
      capabilities: [],
      isLoading: false,
      isAuthenticated: true,
    });

    const { result } = renderHook(() => usePermissions());
    expect(result.current.can('reports:delete')).toBe(true);
  });
});
