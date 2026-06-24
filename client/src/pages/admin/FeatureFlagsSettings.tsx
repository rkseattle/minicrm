/**
 * FeatureFlagsSettings — Admin feature flag registry management.
 * Flags are grouped by category. Supports per-role override toggles for all flags,
 * with roles loaded dynamically from the IAM roles API (built-in + custom). (MINCRM-565)
 * Supports scheduled auto-enable via enable_at (MINCRM-488).
 * Supports beta user enrollment for user-level targeting (MINCRM-489).
 * Supports flag groups with master toggle and group-level beta users (MINCRM-491).
 * Changes require confirmation and write to the audit log.
 * (MINCRM-463, MINCRM-460, MINCRM-488, MINCRM-489, MINCRM-490, MINCRM-491, MINCRM-492, MINCRM-565)
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
  listFlagGroups,
  createFlagGroup,
  updateFlagGroup,
  deleteFlagGroup,
  getGroupBetaUsers,
  enrollGroupBetaUser,
  removeGroupBetaUser,
  FLAG_GROUPS_QUERY_KEY,
  groupBetaUsersQueryKey,
} from '@/api/featureFlags.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY } from '@/api/users.js';
import {
  listCustomRoles,
  CUSTOM_ROLES_QUERY_KEY,
  type CustomRoleResponse,
} from '@/api/customRoles.js';
import {
  FEATURE_FLAG_CATEGORIES,
  OVERRIDE_DIRECTIONS,
  GROUP_KEY_PATTERN,
} from '@shared/schemas/featureFlagSchema.js';
import type {
  FeatureFlagRow,
  FeatureFlagCategory,
  BetaUserEntry,
  UserOverrideEntry,
  OverrideDirection,
  RolloutStage,
  FlagGroupRow,
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

// ── Group Beta Users Panel (MINCRM-491) ───────────────────────────────────────

interface GroupBetaUsersPanelProps {
  groupKey: string;
  groupLabel: string;
}

function GroupBetaUsersPanel({ groupKey }: GroupBetaUsersPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [enrollError, setEnrollError] = useState<string | null>(null);

  const { data: betaData } = useQuery({
    queryKey: groupBetaUsersQueryKey(groupKey),
    queryFn: () => getGroupBetaUsers(groupKey),
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
    mutationFn: (userId: string) => enrollGroupBetaUser(groupKey, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: groupBetaUsersQueryKey(groupKey) });
      void queryClient.invalidateQueries({ queryKey: FLAG_GROUPS_QUERY_KEY });
      setSearch('');
      setEnrollError(null);
    },
    onError: (err: unknown) => {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data
        ?.error?.code;
      if (code === 'GROUP_BETA_USER_ALREADY_ENROLLED') {
        setEnrollError(t('featureFlags.groups.betaUserAlreadyEnrolled'));
      } else {
        setEnrollError(t('featureFlags.saveError'));
      }
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeGroupBetaUser(groupKey, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: groupBetaUsersQueryKey(groupKey) });
      void queryClient.invalidateQueries({ queryKey: FLAG_GROUPS_QUERY_KEY });
    },
  });

  const enrolledUsers = betaData?.users ?? [];

  return (
    <div
      className="mt-3 border-t border-gray-100 pt-3"
      data-testid={`group-beta-panel-${groupKey}`}
    >
      <p className="text-xs font-medium text-gray-700 mb-2">{t('featureFlags.groups.betaUsers')}</p>

      {enrollError && (
        <p className="text-xs text-red-600 mb-2" role="alert">
          {enrollError}
        </p>
      )}

      {enrolledUsers.length === 0 ? (
        <p className="text-xs text-gray-400 mb-2">{t('featureFlags.groups.betaUserEmpty')}</p>
      ) : (
        <ul className="mb-2 space-y-1" aria-label={t('featureFlags.groups.betaUsers')}>
          {enrolledUsers.map((user) => (
            <li
              key={user.user_id}
              className="flex items-center justify-between gap-2 text-xs text-gray-700"
              data-testid={`group-beta-user-row-${groupKey}-${user.user_id}`}
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
                data-testid={`group-beta-user-remove-${groupKey}-${user.user_id}`}
                aria-label={`${t('featureFlags.groups.betaUserRemove')} ${user.name}`}
              >
                {t('featureFlags.groups.betaUserRemove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('featureFlags.betaUserSearch')}
          className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          data-testid={`group-beta-user-search-${groupKey}`}
          aria-label={t('featureFlags.betaUserSearch')}
        />
        {search.trim() !== '' && filteredUsers.length > 0 && (
          <ul
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
                data-testid={`group-beta-user-option-${groupKey}-${user.id}`}
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

// ── Group Row (MINCRM-491) ────────────────────────────────────────────────────

interface GroupRowProps {
  group: FlagGroupRow;
  memberFlags: FeatureFlagRow[];
  onToggle: (group: FlagGroupRow, newEnabled: boolean) => void;
  onEnableAtChange: (group: FlagGroupRow, isoValue: string | null) => void;
  onDelete: (group: FlagGroupRow) => void;
  onFlagClick: (flagKey: string) => void;
  isPending: boolean;
  nowMs: number;
}

function GroupRow({
  group,
  memberFlags,
  onToggle,
  onEnableAtChange,
  onDelete,
  onFlagClick,
  isPending,
  nowMs,
}: GroupRowProps) {
  const { t } = useTranslation();
  const [showDetail, setShowDetail] = useState(false);

  const isPendingSchedule =
    !group.enabled && group.enable_at !== null && isEnableAtPending(group.enable_at, nowMs);

  return (
    <div
      className={`py-4 border-b border-gray-100 last:border-0 ${!group.enabled && !isPendingSchedule ? 'opacity-60' : ''}`}
      data-testid={`flag-group-row-${group.group_key}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900">{group.label}</span>

            {/* Member count badge */}
            {group.member_count > 0 && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600"
                data-testid={`group-member-count-${group.group_key}`}
              >
                {t('featureFlags.groups.memberCount', { count: group.member_count })}
              </span>
            )}

            {/* Beta user count badge */}
            {group.beta_user_count > 0 && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700"
                data-testid={`group-beta-count-${group.group_key}`}
              >
                {t('featureFlags.betaUserCount_other', { count: group.beta_user_count })}
              </span>
            )}

            {/* Scheduled badge */}
            {isPendingSchedule && group.enable_at !== null && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700"
                data-testid={`group-badge-scheduled-${group.group_key}`}
                title={t('featureFlags.scheduledLabel', { date: formatEnableAt(group.enable_at) })}
              >
                {t('featureFlags.scheduledBadge')}
              </span>
            )}

            {!group.enabled && !isPendingSchedule && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700"
                data-testid={`group-badge-disabled-${group.group_key}`}
              >
                {t('featureFlags.groups.disabledBadge')}
              </span>
            )}
          </div>

          {group.description && (
            <p className="text-xs text-gray-500 mt-0.5 break-words">{group.description}</p>
          )}

          {group.updated_by_name && (
            <p className="text-xs text-gray-400 mt-1">
              {t('featureFlags.lastChanged', {
                name: group.updated_by_name,
                date: formatUpdatedAt(group.updated_at),
              })}
            </p>
          )}
        </div>

        {/* Master toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={group.enabled}
            aria-label={t('featureFlags.groups.toggleLabel', { label: group.label })}
            disabled={isPending}
            onClick={() => onToggle(group, !group.enabled)}
            data-testid={`flag-group-toggle-${group.group_key}`}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${
              group.enabled ? 'bg-indigo-600' : 'bg-gray-300'
            } disabled:cursor-not-allowed`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                group.enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Schedule enable_at picker — only when group is disabled */}
      {!group.enabled && (
        <div
          className="mt-2 flex items-center gap-3 flex-wrap"
          data-testid={`group-enable-at-${group.group_key}`}
        >
          <label
            className="text-xs text-gray-500 shrink-0"
            htmlFor={`group-enable-at-${group.group_key}`}
          >
            {t('featureFlags.enableAt')}
          </label>
          <input
            id={`group-enable-at-${group.group_key}`}
            type="datetime-local"
            disabled={isPending}
            value={group.enable_at ? isoToDatetimeLocal(group.enable_at) : ''}
            onChange={(e) =>
              onEnableAtChange(group, e.target.value ? datetimeLocalToIso(e.target.value) : null)
            }
            data-testid={`group-enable-at-input-${group.group_key}`}
            className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
          {group.enable_at !== null && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => onEnableAtChange(group, null)}
              data-testid={`group-enable-at-clear-${group.group_key}`}
              className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:underline disabled:opacity-50"
            >
              {t('featureFlags.enableAtClear')}
            </button>
          )}
        </div>
      )}

      {/* Expand/collapse detail */}
      <div className="mt-2">
        <button
          type="button"
          className="text-xs text-indigo-600 hover:text-indigo-800 focus:outline-none focus:underline"
          onClick={() => setShowDetail((v) => !v)}
          data-testid={`group-detail-toggle-${group.group_key}`}
          aria-expanded={showDetail}
        >
          {showDetail ? t('common.collapse') : t('common.expand')}
        </button>
      </div>

      {showDetail && (
        <div className="mt-2">
          {/* Group beta users panel */}
          <GroupBetaUsersPanel groupKey={group.group_key} groupLabel={group.label} />

          {/* Member flags list */}
          {memberFlags.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-700 mb-2">
                {t('featureFlags.groups.memberFlags')}
              </p>
              <ul className="space-y-1">
                {memberFlags.map((flag) => (
                  <li key={flag.flag_key}>
                    <button
                      type="button"
                      className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus:underline"
                      onClick={() => onFlagClick(flag.flag_key)}
                      data-testid={`group-member-flag-${group.group_key}-${flag.flag_key}`}
                    >
                      {flag.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Delete group button — only enabled when no member flags */}
          <div className="mt-3 border-t border-gray-100 pt-3">
            <button
              type="button"
              disabled={isPending || group.member_count > 0}
              onClick={() => onDelete(group)}
              className="text-xs text-red-600 hover:text-red-800 focus:outline-none focus:underline disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid={`group-delete-${group.group_key}`}
              title={
                group.member_count > 0 ? t('featureFlags.groups.deleteDisabledTooltip') : undefined
              }
            >
              {t('featureFlags.groups.delete')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create Group Form (MINCRM-491) ────────────────────────────────────────────

interface CreateGroupFormProps {
  onCreated: () => void;
}

function CreateGroupForm({ onCreated }: CreateGroupFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [groupKey, setGroupKey] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const createMutation = useMutation({
    mutationFn: () =>
      createFlagGroup({
        group_key: groupKey.trim(),
        label: label.trim(),
        description: description.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FLAG_GROUPS_QUERY_KEY });
      setGroupKey('');
      setLabel('');
      setDescription('');
      setFormError(null);
      setShowForm(false);
      onCreated();
    },
    onError: (err: unknown) => {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data
        ?.error?.code;
      if (code === 'FLAG_GROUP_DUPLICATE_KEY') {
        setFormError(t('featureFlags.groups.duplicateKey'));
      } else {
        setFormError(t('featureFlags.saveError'));
      }
    },
  });

  function handleLabelChange(val: string) {
    setLabel(val);
    // Auto-suggest a group_key from the label when group_key is still empty or was auto-derived
    const slugged = val
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    setGroupKey(slugged);
  }

  const isKeyValid = groupKey.trim().length > 0 && GROUP_KEY_PATTERN.test(groupKey.trim());
  const isLabelValid = label.trim().length > 0;
  const canSubmit = isKeyValid && isLabelValid && !createMutation.isPending;

  if (!showForm) {
    return (
      <button
        type="button"
        className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus:underline"
        onClick={() => setShowForm(true)}
        data-testid="group-create-open"
      >
        {t('featureFlags.groups.createGroup')}
      </button>
    );
  }

  return (
    <div
      className="mt-3 border border-gray-200 rounded-lg p-4 bg-gray-50"
      data-testid="group-create-form"
    >
      <p className="text-xs font-medium text-gray-700 mb-3">
        {t('featureFlags.groups.createGroup')}
      </p>

      {formError && (
        <p className="text-xs text-red-600 mb-2" role="alert">
          {formError}
        </p>
      )}

      <div className="space-y-2">
        <div>
          <label className="text-xs text-gray-600 block mb-0.5" htmlFor="group-create-label">
            {t('featureFlags.groups.labelField')}
          </label>
          <input
            id="group-create-label"
            type="text"
            value={label}
            onChange={(e) => handleLabelChange(e.target.value)}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="group-create-label"
            maxLength={100}
          />
        </div>

        <div>
          <label className="text-xs text-gray-600 block mb-0.5" htmlFor="group-create-key">
            {t('featureFlags.groups.keyField')}
          </label>
          <input
            id="group-create-key"
            type="text"
            value={groupKey}
            onChange={(e) => setGroupKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
            data-testid="group-create-key"
            maxLength={100}
            placeholder="my_group_key"
          />
          {groupKey && !isKeyValid && (
            <p className="text-xs text-red-500 mt-0.5">{t('featureFlags.groups.keyInvalid')}</p>
          )}
        </div>

        <div>
          <label className="text-xs text-gray-600 block mb-0.5" htmlFor="group-create-description">
            {t('featureFlags.groups.descriptionField')}
          </label>
          <input
            id="group-create-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="group-create-description"
            maxLength={1000}
          />
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => createMutation.mutate()}
          className="text-xs font-medium text-white bg-indigo-600 rounded px-3 py-1.5 hover:bg-indigo-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="group-create-submit"
        >
          {t('featureFlags.groups.createSubmit')}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowForm(false);
            setFormError(null);
          }}
          className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:underline"
          data-testid="group-create-cancel"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

// ── Groups Section (MINCRM-491) ───────────────────────────────────────────────

interface GroupsSectionProps {
  flags: FeatureFlagRow[];
  onFlagClick: (flagKey: string) => void;
  onGroupRowRef: (groupKey: string, el: HTMLDivElement | null) => void;
}

function GroupsSection({ flags, onFlagClick, onGroupRowRef }: GroupsSectionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  const { data: groupsData } = useQuery({
    queryKey: FLAG_GROUPS_QUERY_KEY,
    queryFn: listFlagGroups,
  });

  const groups = groupsData?.groups ?? [];

  const [pendingGroupKey, setPendingGroupKey] = useState<string | null>(null);

  const groupMutation = useMutation({
    mutationFn: ({ key, patch }: { key: string; patch: Parameters<typeof updateFlagGroup>[1] }) =>
      updateFlagGroup(key, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FLAG_GROUPS_QUERY_KEY });
      setPendingGroupKey(null);
    },
    onError: () => {
      setPendingGroupKey(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => deleteFlagGroup(key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FLAG_GROUPS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  function handleToggle(group: FlagGroupRow, newEnabled: boolean) {
    setPendingGroupKey(group.group_key);
    groupMutation.mutate({ key: group.group_key, patch: { enabled: newEnabled } });
  }

  function handleEnableAtChange(group: FlagGroupRow, isoValue: string | null) {
    setPendingGroupKey(group.group_key);
    groupMutation.mutate({ key: group.group_key, patch: { enable_at: isoValue } });
  }

  function handleDelete(group: FlagGroupRow) {
    deleteMutation.mutate(group.group_key);
  }

  if (groups.length === 0) {
    return (
      <section aria-labelledby="feature-flag-groups-heading" data-testid="flag-groups-section">
        <h2
          id="feature-flag-groups-heading"
          className="text-base font-semibold text-gray-900 mb-3"
          data-testid="groups-section-heading"
        >
          {t('featureFlags.groups.sectionTitle')}
        </h2>
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-4">
          <p className="text-xs text-gray-400">{t('featureFlags.groups.empty')}</p>
          <CreateGroupForm onCreated={() => {}} />
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="feature-flag-groups-heading" data-testid="flag-groups-section">
      <h2
        id="feature-flag-groups-heading"
        className="text-base font-semibold text-gray-900 mb-3"
        data-testid="groups-section-heading"
      >
        {t('featureFlags.groups.sectionTitle')}
      </h2>
      <div className="bg-white border border-gray-200 rounded-lg px-4 divide-y divide-gray-100">
        {groups.map((group) => (
          <div
            key={group.group_key}
            ref={(el) => onGroupRowRef(group.group_key, el)}
            tabIndex={-1}
            className="focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-inset rounded"
          >
            <GroupRow
              group={group}
              memberFlags={flags.filter((f) => f.group_key === group.group_key)}
              onToggle={handleToggle}
              onEnableAtChange={handleEnableAtChange}
              onDelete={handleDelete}
              onFlagClick={onFlagClick}
              isPending={pendingGroupKey === group.group_key}
              nowMs={nowMs}
            />
          </div>
        ))}
      </div>
      <CreateGroupForm onCreated={() => {}} />
    </section>
  );
}

// ── Flag Row ──────────────────────────────────────────────────────────────────

interface FlagRowProps {
  flag: FeatureFlagRow;
  groups: FlagGroupRow[];
  /** All known roles (built-in + custom); null while loading. */
  allRoles: CustomRoleResponse[] | null;
  rolesError: boolean;
  onToggle: (flag: FeatureFlagRow, newEnabled: boolean) => void;
  onRoleOverride: (flag: FeatureFlagRow, role: string, value: boolean) => void;
  onRoleOverrideRemove: (flag: FeatureFlagRow, role: string) => void;
  onEnableAtChange: (flag: FeatureFlagRow, isoValue: string | null) => void;
  onRolloutChange: (flag: FeatureFlagRow, percentage: number | null) => void;
  onRolloutStagesChange: (flag: FeatureFlagRow, stages: RolloutStage[] | null) => void;
  onGroupChange: (flag: FeatureFlagRow, groupKey: string | null) => void;
  onGroupBadgeClick: (groupKey: string) => void;
  isPending: boolean;
  nowMs: number;
}

function FlagRow({
  flag,
  groups,
  allRoles,
  rolesError,
  onToggle,
  onRoleOverride,
  onRoleOverrideRemove,
  onEnableAtChange,
  onRolloutChange,
  onRolloutStagesChange,
  onGroupChange,
  onGroupBadgeClick,
  isPending,
  nowMs,
}: FlagRowProps) {
  const { t } = useTranslation();
  const [showBetaPanel, setShowBetaPanel] = useState(false);
  const [showRolloutStages, setShowRolloutStages] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
    // Do NOT call onRolloutStagesChange here — propagation is deferred to onBlur so that
    // typing intermediate values (e.g. "2" while entering "25") does not fire a PATCH.
  }

  function handleStageBlur(stages: Array<{ percentage: number; scheduled_at: string }>) {
    const valid = stages.filter((s) => s.scheduled_at !== '');
    onRolloutStagesChange(flag, valid.length > 0 ? valid : null);
  }

  function handleStageRemove(index: number) {
    const updated = localStages.filter((_, i) => i !== index);
    setLocalStages(updated);
    // Remove is a discrete action — propagate immediately, no blur needed.
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

            {/* Group badge — click opens the group detail (MINCRM-491) */}
            {flag.group_key && (
              <button
                type="button"
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 focus:outline-none focus:ring-1 focus:ring-purple-500"
                onClick={() => onGroupBadgeClick(flag.group_key!)}
                data-testid={`flag-group-badge-${flag.flag_key}`}
              >
                {groups.find((g) => g.group_key === flag.group_key)?.label ?? flag.group_key}
              </button>
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

      {/* Role override matrix — shown for all flags; roles loaded dynamically (MINCRM-565) */}
      <div
        className="mt-2 ms-0 flex items-center gap-4 flex-wrap"
        data-testid={`feature-flag-role-overrides-${flag.flag_key}`}
      >
        <span className="text-xs text-gray-500 shrink-0">{t('featureFlags.roleOverrides')}</span>
        {rolesError ? (
          <span
            className="text-xs text-red-500"
            data-testid={`feature-flag-role-overrides-error-${flag.flag_key}`}
          >
            {t('featureFlags.roleOverridesError')}
          </span>
        ) : allRoles === null ? (
          <span
            className="text-xs text-gray-400 animate-pulse"
            data-testid={`feature-flag-role-overrides-loading-${flag.flag_key}`}
          >
            {t('featureFlags.roleOverridesLoading')}
          </span>
        ) : (
          <>
            {allRoles.map((roleEntry) => {
              const overrideValue = flag.role_overrides?.[roleEntry.name];
              const effectiveValue = overrideValue !== undefined ? overrideValue : flag.enabled;
              return (
                <label key={roleEntry.id} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={effectiveValue}
                    disabled={isPending}
                    onChange={(e) => onRoleOverride(flag, roleEntry.name, e.target.checked)}
                    data-testid={`feature-flag-role-override-${flag.flag_key}-${roleEntry.name}`}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed"
                  />
                  <span className="text-xs text-gray-600">
                    {t(`featureFlags.roles.${roleEntry.name}`, { defaultValue: roleEntry.name })}
                  </span>
                </label>
              );
            })}
            {/* Render stale keys from deleted custom roles as remove-only controls */}
            {flag.role_overrides !== null &&
              Object.keys(flag.role_overrides).map((key) => {
                if (allRoles.some((r) => r.name === key)) return null;
                return (
                  <span
                    key={key}
                    className="flex items-center gap-1.5 text-xs text-amber-700"
                    data-testid={`feature-flag-role-override-unknown-${flag.flag_key}-${key}`}
                  >
                    {t('featureFlags.unknownRole', { key })}
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => onRoleOverrideRemove(flag, key)}
                      className="text-amber-600 hover:text-amber-800 focus:outline-none focus:underline disabled:opacity-50"
                      data-testid={`feature-flag-role-override-remove-${flag.flag_key}-${key}`}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
          </>
        )}
      </div>

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
          {(flag.enabled ||
            flag.rollout_percentage !== null ||
            (flag.rollout_stages && flag.rollout_stages.length > 0)) && (
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
                              onBlur={() => handleStageBlur(localStages)}
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
                              onBlur={() => handleStageBlur(localStages)}
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

          {/* Group assignment dropdown (MINCRM-491) */}
          {groups.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-3 flex items-center gap-3 flex-wrap">
              <label
                className="text-xs text-gray-500 shrink-0"
                htmlFor={`flag-group-select-${flag.flag_key}`}
              >
                {t('featureFlags.groups.assignGroup')}
              </label>
              <select
                id={`flag-group-select-${flag.flag_key}`}
                disabled={isPending}
                value={flag.group_key ?? ''}
                onChange={(e) => onGroupChange(flag, e.target.value || null)}
                className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid={`flag-group-select-${flag.flag_key}`}
              >
                <option value="">{t('featureFlags.groups.noGroup')}</option>
                {groups.map((g) => (
                  <option key={g.group_key} value={g.group_key}>
                    {g.label}
                  </option>
                ))}
              </select>
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

  const { data: groupsData } = useQuery({
    queryKey: FLAG_GROUPS_QUERY_KEY,
    queryFn: listFlagGroups,
  });

  // Fetch all roles (built-in + custom) once; passed to every FlagRow to power the
  // dynamic role override panel. null while loading. (MINCRM-565)
  const { data: rolesData, isError: isRolesError } = useQuery({
    queryKey: CUSTOM_ROLES_QUERY_KEY,
    queryFn: listCustomRoles,
  });
  const allRoles: CustomRoleResponse[] | null = rolesData ?? null;

  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Ref maps for scrolling: flag rows (clicked from group member list) and group rows
  // (clicked from a flag's group badge). Keyed by flag_key and group_key respectively.
  // (MINCRM-491)
  const flagRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const groupRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
      void queryClient.invalidateQueries({ queryKey: FLAG_GROUPS_QUERY_KEY });
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

  // Role override changes do not route through the confirm dialog — they don't change the
  // flag's enabled state, so "Enable X?" wording would be misleading. Mutate directly like
  // rollout and group changes. (MINCRM-565)
  function handleRoleOverride(flag: FeatureFlagRow, role: string, value: boolean) {
    const existing = flag.role_overrides ?? {};
    const newOverrides = { ...existing, [role]: value };
    setPendingKey(flag.flag_key);
    mutation.mutate({
      key: flag.flag_key,
      patch: { enabled: flag.enabled, role_overrides: newOverrides },
    });
  }

  function handleRoleOverrideRemove(flag: FeatureFlagRow, role: string) {
    const existing = flag.role_overrides ?? {};
    const newOverrides = { ...existing };
    delete newOverrides[role];
    const clearedOverrides = Object.keys(newOverrides).length === 0 ? null : newOverrides;
    setPendingKey(flag.flag_key);
    mutation.mutate({
      key: flag.flag_key,
      patch: { enabled: flag.enabled, role_overrides: clearedOverrides },
    });
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

  function handleGroupChange(flag: FeatureFlagRow, groupKey: string | null) {
    setPendingKey(flag.flag_key);
    mutation.mutate({
      key: flag.flag_key,
      patch: { enabled: flag.enabled, group_key: groupKey },
    });
  }

  // Scrolls the page to the flag row identified by flagKey, opened from a group detail link.
  function handleFlagClick(flagKey: string) {
    const el = flagRowRefs.current[flagKey];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
  }

  function handleGroupBadgeClick(groupKey: string) {
    const el = groupRowRefs.current[groupKey];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
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
  const groups = groupsData?.groups ?? [];

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

        {/* Groups section — always shown so admins can create groups (MINCRM-491) */}
        <GroupsSection
          flags={flags}
          onFlagClick={handleFlagClick}
          onGroupRowRef={(groupKey, el) => {
            groupRowRefs.current[groupKey] = el;
          }}
        />

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
                  <div
                    key={flag.flag_key}
                    ref={(el) => {
                      flagRowRefs.current[flag.flag_key] = el;
                    }}
                    tabIndex={-1}
                    className="focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-inset rounded"
                  >
                    <FlagRow
                      flag={flag}
                      groups={groups}
                      allRoles={allRoles}
                      rolesError={isRolesError}
                      onToggle={handleToggle}
                      onRoleOverride={handleRoleOverride}
                      onRoleOverrideRemove={handleRoleOverrideRemove}
                      onEnableAtChange={handleEnableAtChange}
                      onRolloutChange={handleRolloutChange}
                      onRolloutStagesChange={handleRolloutStagesChange}
                      onGroupChange={handleGroupChange}
                      onGroupBadgeClick={handleGroupBadgeClick}
                      isPending={pendingKey === flag.flag_key}
                      nowMs={nowMs}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
