/**
 * FeatureFlagsSettings — Admin feature flag registry management.
 * Flags are grouped by category. Supports per-role override toggles for
 * reporting and csv_export. Changes require confirmation and write to the audit log.
 * (MINCRM-463)
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listFeatureFlags,
  updateFeatureFlag,
  FEATURE_FLAGS_QUERY_KEY,
} from '@/api/featureFlags.js';
import {
  FEATURE_FLAG_CATEGORIES,
  ROLE_OVERRIDE_FLAG_KEYS,
} from '@shared/schemas/featureFlagSchema.js';
import type { FeatureFlagRow, FeatureFlagCategory } from '@shared/schemas/featureFlagSchema.js';

const ACTIVE_USER_WARNING_THRESHOLD = 1;

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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

interface FlagRowProps {
  flag: FeatureFlagRow;
  onToggle: (flag: FeatureFlagRow, newEnabled: boolean) => void;
  onRoleOverride: (flag: FeatureFlagRow, role: 'admin' | 'rep', value: boolean) => void;
  isPending: boolean;
}

function FlagRow({ flag, onToggle, onRoleOverride, isPending }: FlagRowProps) {
  const { t } = useTranslation();
  const supportsRoleOverrides = (ROLE_OVERRIDE_FLAG_KEYS as readonly string[]).includes(
    flag.flag_key,
  );

  return (
    <div
      className={`py-4 border-b border-gray-100 last:border-0 ${!flag.enabled ? 'opacity-60' : ''}`}
      data-testid={`feature-flag-row-${flag.flag_key}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900">{flag.label}</span>
            {!flag.enabled && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500"
                data-testid={`feature-flag-badge-off-${flag.flag_key}`}
              >
                {t('featureFlags.offBadge')}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 break-words">{flag.description}</p>
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
    </div>
  );
}

export default function FeatureFlagsSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: FEATURE_FLAGS_QUERY_KEY,
    queryFn: listFeatureFlags,
  });

  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Confirm dialog state
  const [confirmPending, setConfirmPending] = useState<{
    flag: FeatureFlagRow;
    patch: Parameters<typeof updateFeatureFlag>[1];
  } | null>(null);

  const mutation = useMutation({
    mutationFn: ({ key, patch }: { key: string; patch: Parameters<typeof updateFeatureFlag>[1] }) =>
      updateFeatureFlag(key, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
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
            'enabled' in confirmPending.patch
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
                    isPending={pendingKey === flag.flag_key}
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
