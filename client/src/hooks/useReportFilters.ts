/**
 * useReportFilters — shared date range, view toggle, and owner filter state
 * for report pages that use the date-preset/team-view pattern. (MINCRM-407)
 *
 * Used by WinLossReportPage and ActivityVolumeReportPage.
 * StageTrendReportPage uses a different filter pattern (days: 30|60|90)
 * and does not use this hook.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY } from '@/api/users.js';
import type { ActiveUser } from '@/api/users.js';
import {
  todayIso,
  monthStartIso,
  monthEndIso,
  quarterStartIso,
  quarterEndIso,
  weekStartIso,
} from '@/utils/utcDate.js';

/** Date range preset identifier */
export type DatePreset =
  'thisWeek' | 'currentMonth' | 'lastMonth' | 'currentQuarter' | 'lastQuarter' | 'custom';

/** View mode for the admin toggle */
export type ViewMode = 'team' | 'my';

// ── Date helper functions ────────────────────────────────────────────────────

/**
 * Every boundary below resolves in UTC.
 *
 * These strings are sent to the reports API, which filters `deals.close_date` —
 * a timezone-naive `date` column written under a UTC Postgres session. Deriving
 * a boundary from the browser's LOCAL calendar fields and then serializing with
 * `toISOString()` names a different day than the server does for any viewer not
 * in UTC. It was worst for viewers ahead of UTC: `new Date(y, m + 1, 0)` at
 * local midnight serialized into the *following* month, so "this month" reported
 * a range ending a month late. (MINCRM-700)
 *
 * `now` is threaded through rather than read per-helper so every boundary in one
 * render resolves from a single instant. See docs/dev/dates-and-timezones.md.
 */
function resolvePresetDates(
  preset: DatePreset,
  customStart: string,
  customEnd: string,
  now: Date = new Date(),
): { start: string; end: string } {
  switch (preset) {
    case 'thisWeek':
      return { start: weekStartIso(now), end: todayIso(now) };
    case 'currentMonth':
      return { start: monthStartIso(now), end: monthEndIso(now) };
    case 'lastMonth':
      return { start: monthStartIso(now, -1), end: monthEndIso(now, -1) };
    case 'currentQuarter':
      return { start: quarterStartIso(now), end: quarterEndIso(now) };
    case 'lastQuarter':
      return { start: quarterStartIso(now, -1), end: quarterEndIso(now, -1) };
    case 'custom':
      return { start: customStart, end: customEnd };
    default:
      return { start: monthStartIso(now), end: monthEndIso(now) };
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
  const [customStart, setCustomStart] = useState<string>(() => monthStartIso());
  const [customEnd, setCustomEnd] = useState<string>(() => monthEndIso());
  const [viewMode, setViewMode] = useState<ViewMode>('team');
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');

  // Forces a render when the UTC calendar day rolls over.
  //
  // Reading the clock during render is necessary but not sufficient: an idle,
  // focused report never re-renders on its own, so without this it would sit on
  // the previous day/week/month/quarter — and its date-bearing React Query key
  // would not change either, so nothing would refetch. Reported as a P1 on #371.
  //
  // A timer aimed at the next UTC midnight, rather than an interval: one wakeup
  // per day, and it re-arms itself off the new day's boundary. `visibilitychange`
  // covers the case where the tab was backgrounded — browsers throttle or defer
  // long timers in hidden tabs, so the timer alone cannot be trusted to fire on
  // time. (MINCRM-700)
  const [utcDay, setUtcDay] = useState<string>(() => todayIso());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const syncToCurrentUtcDay = (): void => {
      setUtcDay((previous) => {
        const current = todayIso();
        return previous === current ? previous : current;
      });
    };

    const scheduleNextBoundary = (): void => {
      const now = new Date();
      const nextMidnightUtc = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      );
      timer = setTimeout(() => {
        syncToCurrentUtcDay();
        scheduleNextBoundary();
      }, nextMidnightUtc - now.getTime());
    };

    scheduleNextBoundary();
    document.addEventListener('visibilitychange', syncToCurrentUtcDay);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', syncToCurrentUtcDay);
    };
  }, []);

  // Resolved on every render from a freshly read clock, deliberately NOT
  // memoized and NOT captured in state.
  //
  // Both of those would freeze the calendar. A useMemo does not help either —
  // its dependency array holds no time-varying value, so it would simply move
  // the freeze from the state initializer into the memo cache. Reproduced
  // directly: after advancing past midnight, a plain rerender and an unrelated
  // setState both still returned the prior month.
  //
  // Recomputing unconditionally is cheap — six integer reads and a string
  // format, no allocation worth memoizing — and `resolvePresetDates` takes one
  // `now` so start and end always agree with each other.
  //
  // `utcDay` is deliberately NOT the resolution anchor — it exists only to
  // guarantee a render happens at the boundary. Anchoring to it would
  // reintroduce the very freeze this comment describes, because state does not
  // change on a plain rerender. Verified by test: anchoring to `utcDay` fails
  // "re-resolves across UTC midnight on a plain rerender".
  // (MINCRM-700, Greptile P1s on #371)
  void utcDay;
  const { start: resolvedStart, end: resolvedEnd } = resolvePresetDates(
    preset,
    customStart,
    customEnd,
    new Date(),
  );

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
