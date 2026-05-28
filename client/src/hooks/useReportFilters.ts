/**
 * useReportFilters — shared date range, view toggle, and owner filter state
 * for report pages that use the date-preset/team-view pattern. (MINCRM-407)
 *
 * Used by WinLossReportPage and ActivityVolumeReportPage.
 * StageTrendReportPage uses a different filter pattern (days: 30|60|90)
 * and does not use this hook.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY } from '@/api/users.js';
import type { ActiveUser } from '@/api/users.js';

/** Date range preset identifier */
export type DatePreset =
  | 'thisWeek'
  | 'currentMonth'
  | 'lastMonth'
  | 'currentQuarter'
  | 'lastQuarter'
  | 'custom';

/** View mode for the admin toggle */
export type ViewMode = 'team' | 'my';

// ── Date helper functions ────────────────────────────────────────────────────

function startOfCurrentWeek(): string {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return monday.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function endOfCurrentMonth(): string {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.toISOString().slice(0, 10);
}

function startOfLastMonth(): string {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return first.toISOString().slice(0, 10);
}

function endOfLastMonth(): string {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return last.toISOString().slice(0, 10);
}

function startOfCurrentQuarter(): string {
  const now = new Date();
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  return `${now.getFullYear()}-${String(quarterStartMonth + 1).padStart(2, '0')}-01`;
}

function endOfCurrentQuarter(): string {
  const now = new Date();
  const quarterEndMonth = Math.floor(now.getMonth() / 3) * 3 + 2;
  const lastDay = new Date(now.getFullYear(), quarterEndMonth + 1, 0);
  return lastDay.toISOString().slice(0, 10);
}

function startOfLastQuarter(): string {
  const now = new Date();
  const quarterStart = Math.floor(now.getMonth() / 3) * 3 - 3;
  const year = quarterStart < 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = ((quarterStart % 12) + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

function endOfLastQuarter(): string {
  const now = new Date();
  const quarterEndMonth = Math.floor(now.getMonth() / 3) * 3 - 1;
  const year = quarterEndMonth < 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = ((quarterEndMonth % 12) + 12) % 12;
  const lastDay = new Date(year, month + 1, 0);
  return lastDay.toISOString().slice(0, 10);
}

function resolvePresetDates(
  preset: DatePreset,
  customStart: string,
  customEnd: string,
): { start: string; end: string } {
  switch (preset) {
    case 'thisWeek':
      return { start: startOfCurrentWeek(), end: today() };
    case 'currentMonth':
      return { start: startOfCurrentMonth(), end: endOfCurrentMonth() };
    case 'lastMonth':
      return { start: startOfLastMonth(), end: endOfLastMonth() };
    case 'currentQuarter':
      return { start: startOfCurrentQuarter(), end: endOfCurrentQuarter() };
    case 'lastQuarter':
      return { start: startOfLastQuarter(), end: endOfLastQuarter() };
    case 'custom':
      return { start: customStart, end: customEnd };
  }
}

export interface ReportFilters {
  // Date range
  preset: DatePreset;
  setPreset: (p: DatePreset) => void;
  customStart: string;
  setCustomStart: (s: string) => void;
  customEnd: string;
  setCustomEnd: (s: string) => void;
  // Resolved ISO date strings for the query
  resolvedStart: string;
  resolvedEnd: string;
  // View toggle (admin only)
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  // Owner filter (admin only)
  selectedOwnerId: string;
  setSelectedOwnerId: (id: string) => void;
  // Active users for the owner dropdown
  activeUsers: ActiveUser[];
  // Derived owner id to pass to the report query
  effectiveOwnerId: string | undefined;
  // Whether the current user is an admin
  isAdmin: boolean;
}

/**
 * Initial preset for report pages — defaults to currentMonth.
 * Pages that need a different default can call setPreset in a useEffect or
 * pass the override as an argument if the hook is extended in future.
 */
export function useReportFilters(initialPreset: DatePreset = 'currentMonth'): ReportFilters {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [preset, setPreset] = useState<DatePreset>(initialPreset);
  const [customStart, setCustomStart] = useState<string>(startOfCurrentMonth);
  const [customEnd, setCustomEnd] = useState<string>(endOfCurrentMonth);
  const [viewMode, setViewMode] = useState<ViewMode>('team');
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');

  const { resolvedStart, resolvedEnd } = useMemo(() => {
    const { start, end } = resolvePresetDates(preset, customStart, customEnd);
    return { resolvedStart: start, resolvedEnd: end };
  }, [preset, customStart, customEnd]);

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
    enabled: isAdmin,
  });

  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];

  // For reps: no ownerId (server scopes to req.user.id).
  // For admin My View: admin's own user id.
  // For admin Team View: selectedOwnerId if set, else undefined (all-team).
  const effectiveOwnerId: string | undefined = isAdmin
    ? viewMode === 'my'
      ? (user?.id ?? undefined)
      : selectedOwnerId || undefined
    : undefined;

  return {
    preset,
    setPreset,
    customStart,
    setCustomStart,
    customEnd,
    setCustomEnd,
    resolvedStart,
    resolvedEnd,
    viewMode,
    setViewMode,
    selectedOwnerId,
    setSelectedOwnerId,
    activeUsers,
    effectiveOwnerId,
    isAdmin,
  };
}
