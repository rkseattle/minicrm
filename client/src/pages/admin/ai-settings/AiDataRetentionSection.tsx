/**
 * AiDataRetentionSection — session retention window + manual purge.
 * One of the sub-sections behind the AI panel's sub-navigation.
 * Extracted from AiSettings.tsx without behavior changes.
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  setAiSessionRetention,
  AI_CONFIG_QUERY_KEY,
  getAiRetentionStats,
  triggerManualAiPurge,
  AI_RETENTION_STATS_QUERY_KEY,
} from '@/api/ai.js';
import { Button } from '@/components/ui/Button.js';

// ── Manual purge confirmation dialog ────────────────────────────────────────

interface PurgeConfirmDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function PurgeConfirmDialog({ onConfirm, onCancel, isPending }: PurgeConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-purge-confirm-title"
      data-testid="ai-purge-confirm-dialog"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 id="ai-purge-confirm-title" className="text-lg font-semibold text-gray-900 mb-3">
          {t('aiSettings.sessionRetention.purgeConfirmTitle')}
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          {t('aiSettings.sessionRetention.purgeConfirmBody')}
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onClick={onCancel}
            disabled={isPending}
            data-testid="ai-purge-cancel-button"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 bg-red-600 hover:bg-red-700 focus:ring-red-500"
            onClick={onConfirm}
            disabled={isPending}
            data-testid="ai-purge-confirm-button"
          >
            {isPending ? t('common.saving') : t('aiSettings.sessionRetention.purgeConfirmAction')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Delay before refetching retention stats after a manual purge. 3s comfortably
 * covers the purge's single DELETE statement at realistic session-table sizes.
 * This is a heuristic, not a completion signal — the server gives no way to
 * know when the async purge actually finishes, so a purge on an unusually
 * large table could still show pre-purge counts after this delay; the
 * "will update shortly" copy (aiSettings.sessionRetention.purgeAccepted)
 * deliberately doesn't promise an exact time for this reason, and an admin
 * can always refresh manually to see the current counts.
 */
const PURGE_REFETCH_DELAY_MS = 3000;

export function AiDataRetentionSection({ retentionDays }: { retentionDays: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [inputValue, setInputValue] = useState(String(retentionDays));
  // Adjusts local state during render when retentionDays changes, rather than
  // syncing via an effect — avoids the extra render an effect-based sync would
  // cause (react-hooks/set-state-in-effect). See:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevRetentionDays, setPrevRetentionDays] = useState(retentionDays);
  if (retentionDays !== prevRetentionDays) {
    setPrevRetentionDays(retentionDays);
    setInputValue(String(retentionDays));
  }
  const [validationError, setValidationError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Retention stats + manual purge ─────────────────────────────
  const {
    data: statsData,
    isLoading: statsLoading,
    isError: statsError,
  } = useQuery({
    queryKey: AI_RETENTION_STATS_QUERY_KEY,
    queryFn: getAiRetentionStats,
  });

  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purgeAccepted, setPurgeAccepted] = useState(false);
  const [purgeError, setPurgeError] = useState('');
  const purgeRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const purgeMutation = useMutation({
    mutationFn: triggerManualAiPurge,
    onSuccess: () => {
      setShowPurgeConfirm(false);
      setPurgeAccepted(true);
      setPurgeError('');
      // The purge runs asynchronously on the server (202 response returns before
      // it finishes) — an immediate invalidation would just refetch the
      // pre-purge counts. Schedule the refetch after a short delay instead, long
      // enough for the purge's DELETE to complete in practice; the UI copy sets
      // the expectation ("will update shortly") rather than promising instant sync.
      if (purgeRefetchTimerRef.current) clearTimeout(purgeRefetchTimerRef.current);
      purgeRefetchTimerRef.current = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: AI_RETENTION_STATS_QUERY_KEY });
      }, PURGE_REFETCH_DELAY_MS);
    },
    onError: () => {
      setPurgeError(t('aiSettings.sessionRetention.purgeError'));
      setPurgeAccepted(false);
    },
  });

  // Clear the success-message and purge-refetch timers on unmount to prevent
  // setState/refetch scheduling on an unmounted component.
  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) {
        clearTimeout(successTimerRef.current);
      }
      if (purgeRefetchTimerRef.current !== null) {
        clearTimeout(purgeRefetchTimerRef.current);
      }
    };
  }, []);

  const mutation = useMutation({
    mutationFn: (days: number) => setAiSessionRetention({ ai_session_retention_days: days }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_CONFIG_QUERY_KEY });
      setSaveSuccess(true);
      setSaveError('');
      if (successTimerRef.current !== null) {
        clearTimeout(successTimerRef.current);
      }
      successTimerRef.current = setTimeout(() => {
        setSaveSuccess(false);
      }, 3000);
    },
    onError: () => {
      setSaveError(t('aiSettings.sessionRetention.saveError'));
      setSaveSuccess(false);
    },
  });

  const handleSave = () => {
    setValidationError('');
    setSaveSuccess(false);
    setSaveError('');

    // Use Number() for parsing so that decimal inputs like '30.5' are not silently
    // truncated to 30 by parseInt. Non-integer values are caught by the isInteger
    // check and shown as a validation error, preventing silent data corruption.
    const parsed = Number(inputValue);
    if (!Number.isInteger(parsed) || isNaN(parsed)) {
      setValidationError(t('aiSettings.sessionRetention.validationMin'));
      return;
    }
    if (parsed < 30) {
      setValidationError(t('aiSettings.sessionRetention.validationMin'));
      return;
    }
    if (parsed > 3650) {
      setValidationError(t('aiSettings.sessionRetention.validationMax'));
      return;
    }

    mutation.mutate(parsed);
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700">
        {t('aiSettings.sessionRetention.heading')}
      </h3>
      <p className="mt-1 text-sm text-gray-600">{t('aiSettings.sessionRetention.description')}</p>
      <div className="mt-4 flex items-start gap-3">
        <div className="flex-1 max-w-xs">
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="session-retention-days"
          >
            {t('aiSettings.sessionRetention.label')}
          </label>
          <input
            id="session-retention-days"
            type="number"
            min={30}
            max={3650}
            step={1}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setValidationError('');
            }}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="ai-session-retention-days-input"
          />
          {validationError && (
            <p
              className="mt-1 text-xs text-red-600"
              data-testid="ai-session-retention-validation-error"
            >
              {validationError}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500">{t('aiSettings.sessionRetention.hint')}</p>
        </div>
        <div className="pt-6">
          <Button
            onClick={handleSave}
            disabled={mutation.isPending}
            data-testid="ai-session-retention-save-button"
          >
            {mutation.isPending
              ? t('aiSettings.sessionRetention.saving')
              : t('aiSettings.sessionRetention.save')}
          </Button>
        </div>
      </div>
      {saveSuccess && (
        <p className="mt-2 text-xs text-green-600" data-testid="ai-session-retention-save-success">
          {t('aiSettings.sessionRetention.saveSuccess')}
        </p>
      )}
      {saveError && (
        <p className="mt-2 text-xs text-red-600" data-testid="ai-session-retention-save-error">
          {saveError}
        </p>
      )}

      {/* Retention stats + manual purge */}
      <div className="mt-6 border-t border-gray-100 pt-4">
        {statsLoading && (
          <div
            className="animate-pulse h-4 bg-gray-200 rounded w-1/2"
            data-testid="ai-retention-stats-loading"
          />
        )}
        {statsError && (
          <p className="text-xs text-red-600" data-testid="ai-retention-stats-error">
            {t('aiSettings.sessionRetention.statsLoadError')}
          </p>
        )}
        {statsData && (
          <p className="text-xs text-gray-600" data-testid="ai-retention-stats">
            {t('aiSettings.sessionRetention.statsSummary', {
              sessions: statsData.session_count.toLocaleString(),
              messages: statsData.message_count.toLocaleString(),
            })}
          </p>
        )}

        <div className="mt-3">
          <Button
            variant="secondary"
            onClick={() => {
              setPurgeAccepted(false);
              setPurgeError('');
              setShowPurgeConfirm(true);
            }}
            disabled={purgeMutation.isPending}
            data-testid="ai-purge-now-button"
          >
            {t('aiSettings.sessionRetention.purgeNow')}
          </Button>
        </div>

        {purgeAccepted && (
          <p className="mt-2 text-xs text-green-600" data-testid="ai-purge-accepted">
            {t('aiSettings.sessionRetention.purgeAccepted')}
          </p>
        )}
        {purgeError && (
          <p className="mt-2 text-xs text-red-600" data-testid="ai-purge-error">
            {purgeError}
          </p>
        )}
      </div>

      {showPurgeConfirm && (
        <PurgeConfirmDialog
          onConfirm={() => purgeMutation.mutate()}
          onCancel={() => setShowPurgeConfirm(false)}
          isPending={purgeMutation.isPending}
        />
      )}
    </div>
  );
}
