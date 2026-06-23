/**
 * FeatureFlagsSettings — Admin feature flag registry management.
 * Flags are grouped by category. Supports per-role override toggles for flags
 * listed in ROLE_OVERRIDE_FLAG_KEYS (reporting, csv_export, and all AI sub-features).
 * Supports scheduled auto-enable via enable_at (MINCRM-488).
 * Supports beta user enrollment for user-level targeting (MINCRM-489).
 * Changes require confirmation and write to the audit log.
 * (MINCRM-463, MINCRM-460, MINCRM-488, MINCRM-489, MINCRM-490, MINCRM-492)
 */

import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listFeatureFlags,
  updateFeatureFlag,
  getBetaUsers,
  enrollBetaUser,
  removeBetaUser,
  betaUsersQueryKey,
  FEATURE_FLAGS_QUERY_KEY,
  MY_FEATURE_FLAGS_QUERY_KEY,
  listUserOverrides,
  upsertUserOverride,
  deleteUserOverride,
  userOverridesQueryKey,
} from '@/api/featureFlags.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY } from '@/api/users.js';
import {
  FEATURE_FLAG_CATEGORIES,
  ROLE_OVERRIDE_FLAG_KEYS,
  OVERRIDE_DIRECTIONS,
} from '@shared/schemas/featureFlagSchema.js';
import type {
  FeatureFlagRow,
  FeatureFlagCategory,
  BetaUserEntry,
  UserOverrideEntry,
  OverrideDirection,
  RolloutStage,
} from '@shared/schemas/featureFlagSchema.js';

const ACTIVE_USER_WARNING_THRESHOLD = 1;

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatEnableAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Returns true when an ISO enable_at string is in the future relative to a given timestamp. */
function isEnableAtPending(enableAt: string, nowMs: number): boolean {
  return new Date(enableAt).getTime() > nowMs;
}

/** Converts a UTC ISO string to the local datetime-local input value (YYYY-MM-DDTHH:mm). */
function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converts a datetime-local value to a UTC ISO string. */
function datetimeLocalToIso(value: string): string {
  return new Date(value).toISOString();
}

interface ConfirmDialogProps {
  flagLabel: string;
  enabling: boolean;
  activeUsers: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  flagLabel,
  enabling,
  activeUsers,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feature-flag-confirm-title"
      data-testid="feature-flag-confirm-dialog"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 id="feature-flag-confirm-title" className="text-lg font-semibold text-gray-900 mb-2">
          {enabling
            ? t('featureFlags.confirmEnable', { label: flagLabel })
            : t('featureFlags.confirmDisable', { label: flagLabel })}
        </h2>

        {!enabling && activeUsers >= ACTIVE_USER_WARNING_THRESHOLD && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
            {t('featureFlags.activeUsersWarning', { count: activeUsers })}
          </p>
        )}

        <p className="text-sm text-gray-600 mb-6">
          {enabling
            ? t('featureFlags.confirmEnableBody', { label: flagLabel })
            : t('featureFlags.confirmDisableBody', { label: flagLabel })}
        </p>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onClick={onCancel}
            data-testid="feature-flag-confirm-cancel"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onClick={onConfirm}
            data-testid="feature-flag-confirm-ok"
          >
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Beta Users Panel ──────────────────────────────────────────────────────────

interface BetaUsersPanelProps {
  flagKey: string;
  flagLabel: string;
}

function BetaUsersPanel({ flagKey }: BetaUsersPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [enrollError, setEnrollError] = useState<string | null>(null);

  const { data: betaData } = useQuery({
    queryKey: betaUsersQueryKey(flagKey),
    queryFn: () => getBetaUsers(flagKey),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
    staleTime: 5 * 60 * 1000,
  });

  const enrolledIds = new Set((betaData?.users ?? []).map((u) => u.user_id));

  const filteredUsers = (activeUsersData?.users ?? []).filter(
    (u) =>
      !enrolledIds.has(u.id) &&
      (search.trim() === '' || u.name.toLowerCase().includes(search.toLowerCase())),
  );

  const enrollMutation = useMutation({
    mutationFn: (userId: string) => enrollBetaUser(flagKey, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: betaUsersQueryKey(flagKey) });
      void queryClient.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: MY_FEATURE_FLAGS_QUERY_KEY });
      setSearch('');
      setEnrollError(null);
    },
    onError: (err: unknown) => {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data
        ?.error?.code;
      if (code === 'BETA_USER_ALREADY_ENROLLED') {
        setEnrollError(t('featureFlags.betaUserAlreadyEnrolled'));
      } else {
        setEnrollError(t('featureFlags.saveError'));
      }
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeBetaUser(flagKey, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: betaUsersQueryKey(flagKey) });
      void queryClient.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: MY_FEATURE_FLAGS_QUERY_KEY });
    },
  });

  const enrolledUsers: BetaUserEntry[] = betaData?.users ?? [];

  return (
    <div
      className="mt-3 border-t border-gray-100 pt-3"
      data-testid={`feature-flag-beta-panel-${flagKey}`}
    >
      <p className="text-xs font-medium text-gray-700 mb-2">{t('featureFlags.betaUsers')}</p>

      {enrollError && (
        <p className="text-xs text-red-600 mb-2" role="alert">
          {enrollError}
        </p>
      )}

      {/* Enrolled users list */}
      {enrolledUsers.length === 0 ? (
        <p className="text-xs text-gray-400 mb-2">{t('featureFlags.betaUserEmpty')}</p>
      ) : (
        <ul className="mb-2 space-y-1" aria-label={t('featureFlags.betaUsers')}>
          {enrolledUsers.map((user) => (
            <li
              key={user.user_id}
              className="flex items-center justify-between gap-2 text-xs text-gray-700"
              data-testid={`beta-user-row-${flagKey}-${user.user_id}`}
            >
              <span className="min-w-0 truncate">
                {user.name}
                <span className="text-gray-400 ms-1">{user.email}</span>
              </span>
              <button
                type="button"
                className="shrink-0 text-xs text-red-600 hover:text-red-800 focus:outline-none focus:underline disabled:opacity-50"
                disabled={removeMutation.isPending}
                onClick={() => removeMutation.mutate(user.user_id)}
                data-testid={`beta-user-remove-${flagKey}-${user.user_id}`}
                aria-label={`${t('featureFlags.betaUserRemove')} ${user.name}`}
              >
                {t('featureFlags.betaUserRemove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* User picker */}
      <div className="relative">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('featureFlags.betaUserSearch')}
          className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          data-testid={`beta-user-search-${flagKey}`}
          aria-label={t('featureFlags.betaUserSearch')}
          aria-controls={`beta-user-picker-list-${flagKey}`}
        />
        {search.trim() !== '' && filteredUsers.length > 0 && (
          <ul
            id={`beta-user-picker-list-${flagKey}`}
            className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded shadow-md max-h-40 overflow-y-auto"
            role="listbox"
            aria-label={t('featureFlags.betaUserSearch')}
          >
            {filteredUsers.map((user) => (
              <li
                key={user.id}
                role="option"
                aria-selected={false}
                className="px-3 py-1.5 text-xs text-gray-800 hover:bg-indigo-50 cursor-pointer"
                onClick={() => enrollMutation.mutate(user.id)}
                onKeyDown={(e) => e.key === 'Enter' && enrollMutation.mutate(user.id)}
                data-testid={`beta-user-option-${flagKey}-${user.id}`}
                tabIndex={0}
              >
                {user.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── User Overrides Panel ──────────────────────────────────────────────────────

interface UserOverridesPanelProps {
  flagKey: string;
}

function UserOverridesPanel({ flagKey }: UserOverridesPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [overrideError, setOverrideError] = useState<string | null>(null);

  // Search state per direction
  const [searchForceEnabled, setSearchForceEnabled] = useState('');
  const [searchForceDisabled, setSearchForceDisabled] = useState('');

  // Which user is being added (per direction): userId -> show reason input
  const [pendingAddForceEnabled, setPendingAddForceEnabled] = useState<string | null>(null);
  const [pendingAddForceDisabled, setPendingAddForceDisabled] = useState<string | null>(null);

  // useRef for reason inputs to avoid re-renders on every keystroke
  const reasonForceEnabledRef = useRef<HTMLInputElement>(null);
  const reasonForceDisabledRef = useRef<HTMLInputElement>(null);

  const { data: overridesData } = useQuery({
    queryKey: userOverridesQueryKey(flagKey),
    queryFn: () => listUserOverrides(flagKey),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
    staleTime: 5 * 60 * 1000,
  });

  const overrides: UserOverrideEntry[] = overridesData?.overrides ?? [];
  const overrideUserIds = new Set(overrides.map((o) => o.user_id));

  const allActiveUsers = activeUsersData?.users ?? [];

  const invalidateOverrides = () => {
    void queryClient.invalidateQueries({ queryKey: userOverridesQueryKey(flagKey) });
    void queryClient.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
  };

  const upsertMutation = useMutation({
    mutationFn: ({
      userId,
      direction,
      reason,
    }: {
      userId: string;
      direction: OverrideDirection;
      reason: string | undefined;
    }) => upsertUserOverride(flagKey, userId, { override: direction, reason }),
    onSuccess: () => {
      setOverrideError(null);
      invalidateOverrides();
      setPendingAddForceEnabled(null);
      setPendingAddForceDisabled(null);
      setSearchForceEnabled('');
      setSearchForceDisabled('');
    },
    onError: () => {
      setOverrideError(t('featureFlags.overrides.saveError'));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => deleteUserOverride(flagKey, userId),
    onSuccess: () => {
      setOverrideError(null);
      invalidateOverrides();
    },
    onError: () => {
      setOverrideError(t('featureFlags.overrides.saveError'));
    },
  });

  function handleAdd(direction: OverrideDirection, userId: string) {
    const reasonRef =
      direction === 'force_enabled' ? reasonForceEnabledRef : reasonForceDisabledRef;
    const reasonValue = reasonRef.current?.value.trim() || undefined;
    upsertMutation.mutate({ userId, direction, reason: reasonValue });
  }

  function renderDirectionSection(direction: OverrideDirection) {
    const isForceEnabled = direction === 'force_enabled';
    const sectionLabel = isForceEnabled
      ? t('featureFlags.overrides.forcedOn')
      : t('featureFlags.overrides.forcedOff');
    const search = isForceEnabled ? searchForceEnabled : searchForceDisabled;
    const setSearch = isForceEnabled ? setSearchForceEnabled : setSearchForceDisabled;
    const pendingAdd = isForceEnabled ? pendingAddForceEnabled : pendingAddForceDisabled;
    const setPendingAdd = isForceEnabled ? setPendingAddForceEnabled : setPendingAddForceDisabled;
    const reasonRef = isForceEnabled ? reasonForceEnabledRef : reasonForceDisabledRef;

    const sectionOverrides = overrides.filter((o) => o.override === direction);

    // Active users not yet overridden in any direction, filtered by search
    const filteredUsers = allActiveUsers.filter(
      (u) =>
        !overrideUserIds.has(u.id) &&
        (search.trim() === '' || u.name.toLowerCase().includes(search.toLowerCase())),
    );

    return (
      <div className="mt-3">
        <p className="text-xs font-semibold text-gray-700 mb-1">{sectionLabel}</p>

        {sectionOverrides.length === 0 ? (
          <p className="text-xs text-gray-400 mb-2">{t('featureFlags.overrides.noOverrides')}</p>
        ) : (
          <ul className="mb-2 space-y-1">
            {sectionOverrides.map((entry) => (
              <li
                key={entry.user_id}
                className="flex items-center justify-between gap-2 text-xs text-gray-700"
                data-testid={`override-row-${flagKey}-${entry.user_id}`}
              >
                <span className="min-w-0">
                  <span className="truncate">{entry.name}</span>
                  {entry.reason && (
                    <span className="text-gray-400 ms-1 italic">{entry.reason}</span>
                  )}
                  <span className="text-gray-400 ms-1">{formatDate(entry.added_at)}</span>
                </span>
                <button
                  type="button"
                  className="shrink-0 text-xs text-red-600 hover:text-red-800 focus:outline-none focus:underline disabled:opacity-50"
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate(entry.user_id)}
                  data-testid={`override-remove-${flagKey}-${entry.user_id}`}
                  aria-label={`${t('featureFlags.overrides.removeOverride')} ${entry.name}`}
                >
                  {t('featureFlags.overrides.removeOverride')}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* User picker */}
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('featureFlags.overrides.addUser')}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid={`override-search-${direction}-${flagKey}`}
            aria-label={t('featureFlags.overrides.addUser')}
          />
          {search.trim() !== '' && filteredUsers.length > 0 && pendingAdd === null && (
            <ul
              className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded shadow-md max-h-40 overflow-y-auto"
              role="listbox"
              aria-label={t('featureFlags.overrides.addUser')}
            >
              {filteredUsers.map((user) => (
                <li
                  key={user.id}
                  role="option"
                  aria-selected={false}
                  className="px-3 py-1.5 text-xs text-gray-800 hover:bg-indigo-50 cursor-pointer"
                  onClick={() => {
                    setPendingAdd(user.id);
                    setSearch(user.name);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setPendingAdd(user.id);
                      setSearch(user.name);
                    }
                  }}
                  tabIndex={0}
                >
                  {user.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Inline reason input + Add button */}
        {pendingAdd !== null && (
          <div className="mt-1 flex items-center gap-2">
            <input
              ref={reasonRef}
              type="text"
              placeholder={t('featureFlags.overrides.reasonPlaceholder')}
              className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              defaultValue=""
              data-testid={`override-reason-${direction}-${flagKey}`}
            />
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-white bg-indigo-600 rounded px-2 py-1.5 hover:bg-indigo-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              disabled={upsertMutation.isPending}
              onClick={() => handleAdd(direction, pendingAdd)}
              data-testid={`override-add-confirm-${direction}-${flagKey}`}
            >
              {t('featureFlags.overrides.addUser')}
            </button>
            <button
              type="button"
              className="shrink-0 text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:underline"
              onClick={() => {
                setPendingAdd(null);
                setSearch('');
              }}
              data-testid={`override-add-cancel-${direction}-${flagKey}`}
            >
              {t('common.cancel')}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="mt-3 border-t border-gray-100 pt-3"
      data-testid={`feature-flag-overrides-panel-${flagKey}`}
    >
      <p className="text-xs font-medium text-gray-700 mb-1">{t('featureFlags.overrides.title')}</p>
      <p className="text-xs text-amber-600 mb-2">{t('featureFlags.overrides.absoluteWarning')}</p>

      {overrideError && (
        <p className="text-xs text-red-600 mb-2" data-testid={`override-error-${flagKey}`}>
          {overrideError}
        </p>
      )}

      {OVERRIDE_DIRECTIONS.map((direction) => (
        <div key={direction}>{renderDirectionSection(direction)}</div>
      ))}
    </div>
  );
}

// ── Flag Row ──────────────────────────────────────────────────────────────────

interface FlagRowProps {
  flag: FeatureFlagRow;
  onToggle: (flag: FeatureFlagRow, newEnabled: boolean) => void;
  onRoleOverride: (flag: FeatureFlagRow, role: 'admin' | 'rep', value: boolean) => void;
  onEnableAtChange: (flag: FeatureFlagRow, isoValue: string | null) => void;
  onRolloutChange: (flag: FeatureFlagRow, percentage: number | null) => void;
  onRolloutStagesChange: (flag: FeatureFlagRow, stages: RolloutStage[] | null) => void;
  isPending: boolean;
  nowMs: number;
}

function FlagRow({
  flag,
  onToggle,
  onRoleOverride,
  onEnableAtChange,
  onRolloutChange,
  onRolloutStagesChange,
  isPending,
  nowMs,
}: FlagRowProps) {
  const { t } = useTranslation();
  const [showBetaPanel, setShowBetaPanel] = useState(false);
  const [showRolloutStages, setShowRolloutStages] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const supportsRoleOverrides = (ROLE_OVERRIDE_FLAG_KEYS as readonly string[]).includes(
    flag.flag_key,
  );

  // isPendingSchedule: enable_at is set and still in the future — flag not yet live.
  // isScheduleFired: enable_at is set but already in the past — flag is effectively on
  //   (the server evaluates it as enabled once the cache refreshes). Show "On" so admins
  //   can tell the flag is already active. (MINCRM-488, fixes greptile P1)
  const isPendingSchedule =
    !flag.enabled && flag.enable_at !== null && isEnableAtPending(flag.enable_at, nowMs);
  const isScheduleFired =
    !flag.enabled && flag.enable_at !== null && !isEnableAtPending(flag.enable_at, nowMs);

  // Local state for rollout stages editing (MINCRM-490)
  const [localStages, setLocalStages] = useState<
    Array<{ percentage: number; scheduled_at: string }>
  >(() => flag.rollout_stages ?? []);

  // Keys that change when the server-confirmed values change, causing React to remount the
  // relevant inputs with fresh defaultValues. This avoids setState-in-effect while still
  // re-syncing after a scheduler advancement or React Query refetch. (MINCRM-490)
  const rolloutPctInputKey =
    flag.rollout_percentage === null ? 'null' : String(flag.rollout_percentage);
  const rolloutStagesKey = JSON.stringify(flag.rollout_stages);

  function handleStageChange(index: number, field: 'percentage' | 'scheduled_at', value: string) {
    const updated = localStages.map((stage, i) => {
      if (i !== index) return stage;
      if (field === 'percentage') {
        return { ...stage, percentage: Number(value) };
      }
      return { ...stage, scheduled_at: value ? datetimeLocalToIso(value) : '' };
    });
    setLocalStages(updated);
    // Only propagate valid (non-empty scheduled_at) stages
    const valid = updated.filter((s) => s.scheduled_at !== '');
    onRolloutStagesChange(flag, valid.length > 0 ? valid : null);
  }

  function handleStageRemove(index: number) {
    const updated = localStages.filter((_, i) => i !== index);
    setLocalStages(updated);
    const valid = updated.filter((s) => s.scheduled_at !== '');
    onRolloutStagesChange(flag, valid.length > 0 ? valid : null);
  }

  function handleStageAdd() {
    setLocalStages((prev) => [...prev, { percentage: 0, scheduled_at: '' }]);
    setShowRolloutStages(true);
  }

  return (
    <div
      className={`py-4 border-b border-gray-100 last:border-0 ${!flag.enabled && !isPendingSchedule && !isScheduleFired ? 'opacity-60' : ''}`}
      data-testid={`feature-flag-row-${flag.flag_key}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900">{flag.label}</span>

            {/* Beta user count badge */}
            {flag.beta_user_count > 0 && (
              <button
                type="button"
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                onClick={() => setShowBetaPanel((v) => !v)}
                data-testid={`feature-flag-beta-count-${flag.flag_key}`}
                aria-expanded={showBetaPanel}
                aria-controls={`feature-flag-beta-panel-${flag.flag_key}`}
              >
                {t('featureFlags.betaUserCount_other', { count: flag.beta_user_count })}
              </button>
            )}

            {/* Scheduled badge — future enable_at, flag not yet live */}
            {isPendingSchedule && flag.enable_at !== null && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700"
                data-testid={`feature-flag-badge-scheduled-${flag.flag_key}`}
                title={t('featureFlags.scheduledLabel', { date: formatEnableAt(flag.enable_at) })}
              >
                {t('featureFlags.scheduledBadge')}
              </span>
            )}

            {/* On badge — schedule already fired; cache will reflect this within 60s */}
            {isScheduleFired && flag.enable_at !== null && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700"
                data-testid={`feature-flag-badge-on-${flag.flag_key}`}
                title={t('featureFlags.scheduledFiredLabel', {
                  date: formatEnableAt(flag.enable_at),
                })}
              >
                {t('featureFlags.onBadge')}
              </span>
            )}

            {/* Off badge — only when not scheduled and not fired */}
            {!flag.enabled && !isPendingSchedule && !isScheduleFired && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500"
                data-testid={`feature-flag-badge-off-${flag.flag_key}`}
              >
                {t('featureFlags.offBadge')}
              </span>
            )}

            {/* Rollout percentage badge (MINCRM-490) */}
            {flag.rollout_percentage !== null && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700"
                data-testid={`rollout-percentage-badge-${flag.flag_key}`}
              >
                {t('featureFlags.rolloutBadge', { pct: flag.rollout_percentage })}
              </span>
            )}

            {/* Force-enabled count badge (MINCRM-492) */}
            {flag.override_count.force_enabled > 0 && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700"
                data-testid={`override-count-force_enabled-${flag.flag_key}`}
              >
                {t('featureFlags.overrides.forceEnabledBadge', {
                  count: flag.override_count.force_enabled,
                })}
              </span>
            )}

            {/* Force-disabled count badge (MINCRM-492) */}
            {flag.override_count.force_disabled > 0 && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700"
                data-testid={`override-count-force_disabled-${flag.flag_key}`}
              >
                {t('featureFlags.overrides.forceDisabledBadge', {
                  count: flag.override_count.force_disabled,
                })}
              </span>
            )}
          </div>

          <p className="text-xs text-gray-500 mt-0.5 break-words">{flag.description}</p>

          {/* Scheduled enable date/time display — future only */}
          {isPendingSchedule && flag.enable_at !== null && (
            <p className="text-xs text-amber-600 mt-0.5">
              {t('featureFlags.scheduledLabel', { date: formatEnableAt(flag.enable_at) })}
            </p>
          )}

          {/* Fired schedule display — past enable_at */}
          {isScheduleFired && flag.enable_at !== null && (
            <p className="text-xs text-green-600 mt-0.5">
              {t('featureFlags.scheduledFiredLabel', { date: formatEnableAt(flag.enable_at) })}
            </p>
          )}

          {flag.updated_by_name && (
            <p className="text-xs text-gray-400 mt-1">
              {t('featureFlags.lastChanged', {
                name: flag.updated_by_name,
                date: formatUpdatedAt(flag.updated_at),
              })}
            </p>
          )}
        </div>

        {/* Org-wide toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={flag.enabled}
            aria-label={t('featureFlags.toggleLabel', { label: flag.label })}
            disabled={isPending}
            onClick={() => onToggle(flag, !flag.enabled)}
            data-testid={`feature-flag-toggle-${flag.flag_key}`}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${
              flag.enabled ? 'bg-indigo-600' : 'bg-gray-300'
            } disabled:cursor-not-allowed`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                flag.enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Role override matrix — only for flags that support it */}
      {supportsRoleOverrides && (
        <div
          className="mt-2 ms-0 flex items-center gap-4"
          data-testid={`feature-flag-role-overrides-${flag.flag_key}`}
        >
          <span className="text-xs text-gray-500">{t('featureFlags.roleOverrides')}</span>
          {(['admin', 'rep'] as const).map((role) => {
            const overrideValue = flag.role_overrides?.[role];
            const effectiveValue = overrideValue !== undefined ? overrideValue : flag.enabled;
            return (
              <label key={role} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={effectiveValue}
                  disabled={isPending}
                  onChange={(e) => onRoleOverride(flag, role, e.target.checked)}
                  data-testid={`feature-flag-role-override-${flag.flag_key}-${role}`}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed"
                />
                <span className="text-xs text-gray-600">{t(`featureFlags.roles.${role}`)}</span>
              </label>
            );
          })}
        </div>
      )}

      {/* Schedule enable_at picker — only when the flag is currently disabled (MINCRM-488) */}
      {!flag.enabled && (
        <div
          className="mt-2 flex items-center gap-3 flex-wrap"
          data-testid={`feature-flag-enable-at-${flag.flag_key}`}
        >
          <label className="text-xs text-gray-500 shrink-0" htmlFor={`enable-at-${flag.flag_key}`}>
            {t('featureFlags.enableAt')}
          </label>
          <input
            id={`enable-at-${flag.flag_key}`}
            type="datetime-local"
            disabled={isPending}
            value={flag.enable_at ? isoToDatetimeLocal(flag.enable_at) : ''}
            onChange={(e) =>
              onEnableAtChange(flag, e.target.value ? datetimeLocalToIso(e.target.value) : null)
            }
            data-testid={`feature-flag-enable-at-input-${flag.flag_key}`}
            className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
          {flag.enable_at !== null && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => onEnableAtChange(flag, null)}
              data-testid={`feature-flag-enable-at-clear-${flag.flag_key}`}
              className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:underline disabled:opacity-50"
            >
              {t('featureFlags.enableAtClear')}
            </button>
          )}
        </div>
      )}

      {/* Advanced settings toggle (rollout, overrides, beta) — MINCRM-490, MINCRM-492 */}
      <div className="mt-2">
        <button
          type="button"
          className="text-xs text-indigo-600 hover:text-indigo-800 focus:outline-none focus:underline"
          onClick={() => setShowAdvanced((v) => !v)}
          data-testid={`feature-flag-advanced-toggle-${flag.flag_key}`}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? t('common.collapse') : t('common.expand')}
        </button>
      </div>

      {showAdvanced && (
        <>
          {/* Rollout percentage + stages (MINCRM-490) */}
          {flag.enabled && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              {/* Rollout percentage input */}
              <div className="flex items-center gap-3 flex-wrap">
                <label
                  className="text-xs text-gray-500 shrink-0"
                  htmlFor={`rollout-pct-${flag.flag_key}`}
                >
                  {t('featureFlags.rolloutPercentage')}
                </label>
                <input
                  id={`rollout-pct-${flag.flag_key}`}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  disabled={isPending}
                  key={rolloutPctInputKey}
                  defaultValue={flag.rollout_percentage === null ? '' : flag.rollout_percentage}
                  onBlur={(e) =>
                    onRolloutChange(flag, e.target.value === '' ? null : Number(e.target.value))
                  }
                  data-testid={`rollout-percentage-input-${flag.flag_key}`}
                  className="w-20 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {/* Progress bar */}
              {flag.rollout_percentage !== null && (
                <div className="mt-2 w-full bg-gray-200 rounded h-2">
                  <div
                    className="bg-indigo-500 h-2 rounded"
                    style={{ width: `${flag.rollout_percentage ?? 0}%` }}
                  />
                </div>
              )}

              {/* Rollout stages sub-section */}
              <div className="mt-3" data-testid={`rollout-stages-${flag.flag_key}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-gray-700">
                    {t('featureFlags.rolloutStages')}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-indigo-600 hover:text-indigo-800 focus:outline-none focus:underline"
                    onClick={() => setShowRolloutStages((v) => !v)}
                    data-testid={`rollout-stages-toggle-${flag.flag_key}`}
                  >
                    {showRolloutStages ? t('common.collapse') : t('common.expand')}
                  </button>
                </div>

                {showRolloutStages && (
                  <React.Fragment key={rolloutStagesKey}>
                    {localStages.length > 0 && (
                      <ul className="mb-2 space-y-2">
                        {localStages.map((stage, index) => (
                          <li key={index} className="flex items-center gap-2 flex-wrap">
                            <input
                              type="datetime-local"
                              value={
                                stage.scheduled_at ? isoToDatetimeLocal(stage.scheduled_at) : ''
                              }
                              onChange={(e) =>
                                handleStageChange(index, 'scheduled_at', e.target.value)
                              }
                              className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              disabled={isPending}
                              data-testid={`rollout-stage-scheduled-at-${flag.flag_key}-${index}`}
                            />
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={stage.percentage}
                              onChange={(e) =>
                                handleStageChange(index, 'percentage', e.target.value)
                              }
                              className="w-16 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              disabled={isPending}
                              data-testid={`rollout-stage-percentage-${flag.flag_key}-${index}`}
                            />
                            <button
                              type="button"
                              className="text-xs text-red-600 hover:text-red-800 focus:outline-none focus:underline disabled:opacity-50"
                              disabled={isPending}
                              onClick={() => handleStageRemove(index)}
                              data-testid={`rollout-stage-remove-${flag.flag_key}-${index}`}
                            >
                              {t('featureFlags.rolloutStageRemove')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <button
                      type="button"
                      className="text-xs text-indigo-600 hover:text-indigo-800 focus:outline-none focus:underline disabled:opacity-50"
                      disabled={isPending}
                      onClick={handleStageAdd}
                      data-testid={`rollout-stage-add-${flag.flag_key}`}
                    >
                      {t('featureFlags.rolloutStageAdd')}
                    </button>
                  </React.Fragment>
                )}
              </div>
            </div>
          )}

          {/* Beta users panel (MINCRM-489) */}
          {(showBetaPanel || flag.beta_user_count === 0) && (
            <BetaUsersPanel flagKey={flag.flag_key} flagLabel={flag.label} />
          )}
          {flag.beta_user_count > 0 && !showBetaPanel && (
            <button
              type="button"
              className="mt-2 text-xs text-indigo-600 hover:text-indigo-800 focus:outline-none focus:underline"
              onClick={() => setShowBetaPanel(true)}
              data-testid={`feature-flag-beta-expand-${flag.flag_key}`}
            >
              {t('featureFlags.betaUsers')}
            </button>
          )}

          {/* User overrides panel (MINCRM-492) */}
          <UserOverridesPanel flagKey={flag.flag_key} />
        </>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function FeatureFlagsSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: FEATURE_FLAGS_QUERY_KEY,
    queryFn: listFeatureFlags,
  });

  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [confirmPending, setConfirmPending] = useState<{
    flag: FeatureFlagRow;
    patch: Parameters<typeof updateFeatureFlag>[1];
  } | null>(null);

  const mutation = useMutation({
    mutationFn: ({ key, patch }: { key: string; patch: Parameters<typeof updateFeatureFlag>[1] }) =>
      updateFeatureFlag(key, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: MY_FEATURE_FLAGS_QUERY_KEY });
      setPendingKey(null);
      setSaveError(null);
    },
    onError: () => {
      setPendingKey(null);
      setSaveError(t('featureFlags.saveError'));
    },
  });

  function handleToggle(flag: FeatureFlagRow, newEnabled: boolean) {
    setConfirmPending({ flag, patch: { enabled: newEnabled } });
  }

  function handleRoleOverride(flag: FeatureFlagRow, role: 'admin' | 'rep', value: boolean) {
    const existing = flag.role_overrides ?? {};
    const newOverrides = { ...existing, [role]: value };
    setConfirmPending({ flag, patch: { enabled: flag.enabled, role_overrides: newOverrides } });
  }

  function handleEnableAtChange(flag: FeatureFlagRow, isoValue: string | null) {
    setConfirmPending({ flag, patch: { enabled: flag.enabled, enable_at: isoValue } });
  }

  function handleRolloutChange(flag: FeatureFlagRow, percentage: number | null) {
    setPendingKey(flag.flag_key);
    mutation.mutate({
      key: flag.flag_key,
      patch: { enabled: flag.enabled, rollout_percentage: percentage },
    });
  }

  function handleRolloutStagesChange(flag: FeatureFlagRow, stages: RolloutStage[] | null) {
    setPendingKey(flag.flag_key);
    mutation.mutate({
      key: flag.flag_key,
      patch: { enabled: flag.enabled, rollout_stages: stages },
    });
  }

  function handleConfirm() {
    if (!confirmPending) return;
    setPendingKey(confirmPending.flag.flag_key);
    mutation.mutate({ key: confirmPending.flag.flag_key, patch: confirmPending.patch });
    setConfirmPending(null);
  }

  function handleCancel() {
    setConfirmPending(null);
  }

  const flags = data?.flags ?? [];
  // Recomputed on every render so enable_at classification stays accurate after React Query
  // refetches. A frozen mount-time snapshot keeps isPendingSchedule=true after the schedule
  // fires until the user navigates away. eslint-disable-next-line is intentional — Date.now()
  // here is safe because this component is not called inside another hook. (MINCRM-488)
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  const byCategory = FEATURE_FLAG_CATEGORIES.reduce<Record<FeatureFlagCategory, FeatureFlagRow[]>>(
    (acc, cat) => {
      acc[cat] = flags.filter((f) => f.category === cat);
      return acc;
    },
    {} as Record<FeatureFlagCategory, FeatureFlagRow[]>,
  );

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" data-testid="feature-flags-loading">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700"
        data-testid="feature-flags-error"
      >
        {t('featureFlags.loadError')}
      </div>
    );
  }

  if (flags.length === 0) {
    return (
      <p className="text-sm text-gray-500" data-testid="feature-flags-empty">
        {t('featureFlags.empty')}
      </p>
    );
  }

  return (
    <>
      {confirmPending && (
        <ConfirmDialog
          flagLabel={confirmPending.flag.label}
          enabling={
            // enable_at being set (non-null) means scheduling an enable — treat as enabling.
            // enable_at: null means clearing the schedule — treat as the current enabled state.
            'enable_at' in confirmPending.patch
              ? confirmPending.patch.enable_at !== null
              : 'enabled' in confirmPending.patch
                ? (confirmPending.patch.enabled as boolean)
                : confirmPending.flag.enabled
          }
          activeUsers={confirmPending.flag.active_user_count}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      <div className="space-y-8" data-testid="feature-flags-list">
        <p className="text-sm text-gray-600">{t('featureFlags.description')}</p>

        {saveError && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {saveError}
          </div>
        )}

        {FEATURE_FLAG_CATEGORIES.map((category) => {
          const categoryFlags = byCategory[category];
          if (!categoryFlags || categoryFlags.length === 0) return null;

          return (
            <section key={category} aria-labelledby={`feature-flag-category-${category}`}>
              <h2
                id={`feature-flag-category-${category}`}
                className="text-base font-semibold text-gray-900 mb-3"
                data-testid={`feature-flag-category-${category}`}
              >
                {t(`featureFlags.categories.${category.toLowerCase().replace(/ /g, '_')}`)}
              </h2>
              <div className="bg-white border border-gray-200 rounded-lg px-4 divide-y divide-gray-100">
                {categoryFlags.map((flag) => (
                  <FlagRow
                    key={flag.flag_key}
                    flag={flag}
                    onToggle={handleToggle}
                    onRoleOverride={handleRoleOverride}
                    onEnableAtChange={handleEnableAtChange}
                    onRolloutChange={handleRolloutChange}
                    onRolloutStagesChange={handleRolloutStagesChange}
                    isPending={pendingKey === flag.flag_key}
                    nowMs={nowMs}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
