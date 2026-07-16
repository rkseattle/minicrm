/**
 * AiCoachingSection — rep coaching insight thresholds + manual "run now".
 * One of the sub-sections behind the AI panel's sub-navigation (MINCRM-653).
 * Follows AiDataRetentionSection's pattern: threshold inputs + save button,
 * plus a manual trigger that reuses the exact nightly-job function. (MINCRM-474)
 *
 * Split into a data-fetching wrapper (this component) and a presentational
 * form (AiCoachingThresholdsForm) that only mounts once config data exists —
 * this avoids syncing query-fetched data into local state via a useEffect
 * (flagged by react-hooks/set-state-in-effect): the form's initial state is
 * derived once at mount via a lazy useState initializer instead.
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getRepCoachingConfig,
  setRepCoachingConfig,
  triggerManualRepCoachingRun,
  REP_COACHING_CONFIG_QUERY_KEY,
} from '@/api/repCoaching.js';
import { Button } from '@/components/ui/Button.js';
import type { RepCoachingConfigResponse } from '@shared/schemas/settingsSchema.js';

interface FormState {
  min_closed_deals: string;
  stage_time_outlier_ratio: string;
  activity_frequency_outlier_ratio: string;
  response_time_outlier_hours: string;
  win_rate_outlier_delta: string;
}

function toFormState(config: RepCoachingConfigResponse): FormState {
  return {
    min_closed_deals: String(config.min_closed_deals),
    stage_time_outlier_ratio: String(config.stage_time_outlier_ratio),
    activity_frequency_outlier_ratio: String(config.activity_frequency_outlier_ratio),
    response_time_outlier_hours: String(config.response_time_outlier_hours),
    win_rate_outlier_delta: String(config.win_rate_outlier_delta),
  };
}

/** Delay before the "run started" confirmation clears itself. */
const RUN_ACCEPTED_MESSAGE_MS = 5000;

function AiCoachingThresholdsForm({ config }: { config: RepCoachingConfigResponse }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Lazy initializer — reads `config` only on this component's first mount, not
  // on every re-render, avoiding the need to sync it via a useEffect.
  const [form, setForm] = useState<FormState>(() => toFormState(config));
  const [validationError, setValidationError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [runAccepted, setRunAccepted] = useState(false);
  const [runError, setRunError] = useState('');
  const runAcceptedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) clearTimeout(successTimerRef.current);
      if (runAcceptedTimerRef.current !== null) clearTimeout(runAcceptedTimerRef.current);
    };
  }, []);

  const mutation = useMutation({
    mutationFn: setRepCoachingConfig,
    onSuccess: (freshData) => {
      queryClient.setQueryData(REP_COACHING_CONFIG_QUERY_KEY, freshData);
      setForm(toFormState(freshData));
      setSaveSuccess(true);
      setSaveError('');
      if (successTimerRef.current !== null) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: () => {
      setSaveError(t('aiSettings.coaching.saveError'));
      setSaveSuccess(false);
    },
  });

  const runMutation = useMutation({
    mutationFn: triggerManualRepCoachingRun,
    onSuccess: () => {
      setRunAccepted(true);
      setRunError('');
      if (runAcceptedTimerRef.current !== null) clearTimeout(runAcceptedTimerRef.current);
      runAcceptedTimerRef.current = setTimeout(
        () => setRunAccepted(false),
        RUN_ACCEPTED_MESSAGE_MS,
      );
    },
    onError: () => {
      setRunError(t('aiSettings.coaching.runError'));
      setRunAccepted(false);
    },
  });

  function updateField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setValidationError('');
  }

  function handleSave() {
    setValidationError('');
    setSaveSuccess(false);
    setSaveError('');

    const minClosedDeals = Number(form.min_closed_deals);
    const stageTimeRatio = Number(form.stage_time_outlier_ratio);
    const activityRatio = Number(form.activity_frequency_outlier_ratio);
    const responseHours = Number(form.response_time_outlier_hours);
    const winRateDelta = Number(form.win_rate_outlier_delta);

    if (!Number.isInteger(minClosedDeals) || minClosedDeals < 1) {
      setValidationError(t('aiSettings.coaching.validationMinClosedDeals'));
      return;
    }
    if (isNaN(stageTimeRatio) || stageTimeRatio <= 1) {
      setValidationError(t('aiSettings.coaching.validationStageRatio'));
      return;
    }
    if (isNaN(activityRatio) || activityRatio <= 0 || activityRatio >= 1) {
      setValidationError(t('aiSettings.coaching.validationActivityRatio'));
      return;
    }
    if (!Number.isInteger(responseHours) || responseHours < 1) {
      setValidationError(t('aiSettings.coaching.validationResponseHours'));
      return;
    }
    if (isNaN(winRateDelta) || winRateDelta <= 0 || winRateDelta >= 1) {
      setValidationError(t('aiSettings.coaching.validationWinRateDelta'));
      return;
    }

    mutation.mutate({
      min_closed_deals: minClosedDeals,
      stage_time_outlier_ratio: stageTimeRatio,
      activity_frequency_outlier_ratio: activityRatio,
      response_time_outlier_hours: responseHours,
      win_rate_outlier_delta: winRateDelta,
    });
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700">{t('aiSettings.coaching.heading')}</h3>
      <p className="mt-1 text-sm text-gray-600">{t('aiSettings.coaching.description')}</p>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        <div>
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="coaching-min-closed-deals"
          >
            {t('aiSettings.coaching.minClosedDealsLabel')}
          </label>
          <input
            id="coaching-min-closed-deals"
            type="number"
            min={1}
            step={1}
            value={form.min_closed_deals}
            onChange={(e) => updateField('min_closed_deals', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="ai-coaching-min-closed-deals-input"
          />
        </div>
        <div>
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="coaching-stage-ratio"
          >
            {t('aiSettings.coaching.stageRatioLabel')}
          </label>
          <input
            id="coaching-stage-ratio"
            type="number"
            min={1.01}
            step={0.01}
            value={form.stage_time_outlier_ratio}
            onChange={(e) => updateField('stage_time_outlier_ratio', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="ai-coaching-stage-ratio-input"
          />
        </div>
        <div>
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="coaching-activity-ratio"
          >
            {t('aiSettings.coaching.activityRatioLabel')}
          </label>
          <input
            id="coaching-activity-ratio"
            type="number"
            min={0.01}
            max={0.99}
            step={0.01}
            value={form.activity_frequency_outlier_ratio}
            onChange={(e) => updateField('activity_frequency_outlier_ratio', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="ai-coaching-activity-ratio-input"
          />
        </div>
        <div>
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="coaching-response-hours"
          >
            {t('aiSettings.coaching.responseHoursLabel')}
          </label>
          <input
            id="coaching-response-hours"
            type="number"
            min={1}
            step={1}
            value={form.response_time_outlier_hours}
            onChange={(e) => updateField('response_time_outlier_hours', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="ai-coaching-response-hours-input"
          />
        </div>
        <div>
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="coaching-win-rate-delta"
          >
            {t('aiSettings.coaching.winRateDeltaLabel')}
          </label>
          <input
            id="coaching-win-rate-delta"
            type="number"
            min={0.01}
            max={0.99}
            step={0.01}
            value={form.win_rate_outlier_delta}
            onChange={(e) => updateField('win_rate_outlier_delta', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="ai-coaching-win-rate-delta-input"
          />
        </div>
      </div>

      {validationError && (
        <p className="mt-2 text-xs text-red-600" data-testid="ai-coaching-validation-error">
          {validationError}
        </p>
      )}

      <div className="mt-4">
        <Button
          onClick={handleSave}
          disabled={mutation.isPending}
          data-testid="ai-coaching-save-button"
        >
          {mutation.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>

      {saveSuccess && (
        <p className="mt-2 text-xs text-green-600" data-testid="ai-coaching-save-success">
          {t('aiSettings.coaching.saveSuccess')}
        </p>
      )}
      {saveError && (
        <p className="mt-2 text-xs text-red-600" data-testid="ai-coaching-save-error">
          {saveError}
        </p>
      )}

      <div className="mt-6 border-t border-gray-100 pt-4">
        <p className="text-sm text-gray-600 mb-3">{t('aiSettings.coaching.runNowDescription')}</p>
        <Button
          variant="secondary"
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          data-testid="ai-coaching-run-now-button"
        >
          {runMutation.isPending ? t('common.saving') : t('aiSettings.coaching.runNow')}
        </Button>

        {runAccepted && (
          <p className="mt-2 text-xs text-green-600" data-testid="ai-coaching-run-accepted">
            {t('aiSettings.coaching.runAccepted')}
          </p>
        )}
        {runError && (
          <p className="mt-2 text-xs text-red-600" data-testid="ai-coaching-run-error">
            {runError}
          </p>
        )}
      </div>
    </div>
  );
}

export function AiCoachingSection() {
  const { t } = useTranslation();

  const { data, isLoading, isError } = useQuery({
    queryKey: REP_COACHING_CONFIG_QUERY_KEY,
    queryFn: getRepCoachingConfig,
  });

  if (isLoading) {
    return (
      <div className="py-8 text-center text-gray-500" data-testid="ai-coaching-loading">
        {t('common.loading')}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="py-8 text-center text-red-600" data-testid="ai-coaching-error">
        {t('aiSettings.coaching.loadError')}
      </div>
    );
  }

  return <AiCoachingThresholdsForm config={data} />;
}
