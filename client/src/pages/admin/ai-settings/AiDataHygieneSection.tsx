/**
 * AiDataHygieneSection — data hygiene scan thresholds + manual "run now".
 * One of the sub-sections behind the AI panel's sub-navigation (MINCRM-653).
 * Follows AiCoachingSection's pattern: threshold inputs + save button, plus
 * a manual trigger that reuses the exact nightly-job function. (MINCRM-476)
 *
 * Split into a data-fetching wrapper (this component) and a presentational
 * form that only mounts once config data exists — avoids syncing
 * query-fetched data into local state via a useEffect
 * (react-hooks/set-state-in-effect): the form's initial state is derived
 * once at mount via a lazy useState initializer instead.
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getDataHygieneConfig,
  setDataHygieneConfig,
  triggerManualHygieneScan,
  DATA_HYGIENE_CONFIG_QUERY_KEY,
} from '@/api/dataHygiene.js';
import { Button } from '@/components/ui/Button.js';
import type { DataHygieneConfigResponse } from '@shared/schemas/dataHygieneSchema.js';

interface FormState {
  contact_inactivity_days: string;
  account_inactivity_days: string;
  title_staleness_days: string;
  opportunity_inactivity_days: string;
  dismiss_suppression_days: string;
  weekly_digest_enabled: boolean;
}

function toFormState(config: DataHygieneConfigResponse): FormState {
  return {
    contact_inactivity_days: String(config.contact_inactivity_days),
    account_inactivity_days: String(config.account_inactivity_days),
    title_staleness_days: String(config.title_staleness_days),
    opportunity_inactivity_days: String(config.opportunity_inactivity_days),
    dismiss_suppression_days: String(config.dismiss_suppression_days),
    weekly_digest_enabled: config.weekly_digest_enabled,
  };
}

/** Delay before the "run started" confirmation clears itself. */
const RUN_ACCEPTED_MESSAGE_MS = 5000;

function AiDataHygieneThresholdsForm({ config }: { config: DataHygieneConfigResponse }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

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
    mutationFn: setDataHygieneConfig,
    onSuccess: (freshData) => {
      queryClient.setQueryData(DATA_HYGIENE_CONFIG_QUERY_KEY, freshData);
      setForm(toFormState(freshData));
      setSaveSuccess(true);
      setSaveError('');
      if (successTimerRef.current !== null) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: () => {
      setSaveError(t('aiSettings.dataHygiene.saveError'));
      setSaveSuccess(false);
    },
  });

  const runMutation = useMutation({
    mutationFn: triggerManualHygieneScan,
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
      setRunError(t('aiSettings.dataHygiene.runError'));
      setRunAccepted(false);
    },
  });

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setValidationError('');
  }

  function handleSave() {
    setValidationError('');
    setSaveSuccess(false);
    setSaveError('');

    const contactInactivityDays = Number(form.contact_inactivity_days);
    const accountInactivityDays = Number(form.account_inactivity_days);
    const titleStalenessDays = Number(form.title_staleness_days);
    const opportunityInactivityDays = Number(form.opportunity_inactivity_days);
    const dismissSuppressionDays = Number(form.dismiss_suppression_days);

    const dayFields: Array<{ value: number; errorKey: string }> = [
      { value: contactInactivityDays, errorKey: 'validationContactInactivityDays' },
      { value: accountInactivityDays, errorKey: 'validationAccountInactivityDays' },
      { value: titleStalenessDays, errorKey: 'validationTitleStalenessDays' },
      { value: opportunityInactivityDays, errorKey: 'validationOpportunityInactivityDays' },
      { value: dismissSuppressionDays, errorKey: 'validationDismissSuppressionDays' },
    ];
    for (const field of dayFields) {
      if (!Number.isInteger(field.value) || field.value < 1) {
        setValidationError(t(`aiSettings.dataHygiene.${field.errorKey}`));
        return;
      }
    }

    mutation.mutate({
      contact_inactivity_days: contactInactivityDays,
      account_inactivity_days: accountInactivityDays,
      title_staleness_days: titleStalenessDays,
      opportunity_inactivity_days: opportunityInactivityDays,
      dismiss_suppression_days: dismissSuppressionDays,
      weekly_digest_enabled: form.weekly_digest_enabled,
    });
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700">{t('aiSettings.dataHygiene.heading')}</h3>
      <p className="mt-1 text-sm text-gray-600">{t('aiSettings.dataHygiene.description')}</p>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        <div>
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="hygiene-contact-inactivity-days"
          >
            {t('aiSettings.dataHygiene.contactInactivityDaysLabel')}
          </label>
          <input
            id="hygiene-contact-inactivity-days"
            type="number"
            min={1}
            step={1}
            value={form.contact_inactivity_days}
            onChange={(e) => updateField('contact_inactivity_days', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="hygiene-contact-inactivity-days-input"
          />
        </div>
        <div>
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="hygiene-account-inactivity-days"
          >
            {t('aiSettings.dataHygiene.accountInactivityDaysLabel')}
          </label>
          <input
            id="hygiene-account-inactivity-days"
            type="number"
            min={1}
            step={1}
            value={form.account_inactivity_days}
            onChange={(e) => updateField('account_inactivity_days', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="hygiene-account-inactivity-days-input"
          />
        </div>
        <div>
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="hygiene-title-staleness-days"
          >
            {t('aiSettings.dataHygiene.titleStalenessDaysLabel')}
          </label>
          <input
            id="hygiene-title-staleness-days"
            type="number"
            min={1}
            step={1}
            value={form.title_staleness_days}
            onChange={(e) => updateField('title_staleness_days', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="hygiene-title-staleness-days-input"
          />
        </div>
        <div>
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="hygiene-opportunity-inactivity-days"
          >
            {t('aiSettings.dataHygiene.opportunityInactivityDaysLabel')}
          </label>
          <input
            id="hygiene-opportunity-inactivity-days"
            type="number"
            min={1}
            step={1}
            value={form.opportunity_inactivity_days}
            onChange={(e) => updateField('opportunity_inactivity_days', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="hygiene-opportunity-inactivity-days-input"
          />
        </div>
        <div>
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="hygiene-dismiss-suppression-days"
          >
            {t('aiSettings.dataHygiene.dismissSuppressionDaysLabel')}
          </label>
          <input
            id="hygiene-dismiss-suppression-days"
            type="number"
            min={1}
            step={1}
            value={form.dismiss_suppression_days}
            onChange={(e) => updateField('dismiss_suppression_days', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="hygiene-dismiss-suppression-days-input"
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.weekly_digest_enabled}
              onChange={(e) => updateField('weekly_digest_enabled', e.target.checked)}
              data-testid="hygiene-weekly-digest-checkbox"
            />
            {t('aiSettings.dataHygiene.weeklyDigestLabel')}
          </label>
        </div>
      </div>

      {validationError && (
        <p className="mt-2 text-xs text-red-600" data-testid="hygiene-validation-error">
          {validationError}
        </p>
      )}

      <div className="mt-4">
        <Button
          onClick={handleSave}
          disabled={mutation.isPending}
          data-testid="hygiene-save-button"
        >
          {mutation.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>

      {saveSuccess && (
        <p className="mt-2 text-xs text-green-600" data-testid="hygiene-save-success">
          {t('aiSettings.dataHygiene.saveSuccess')}
        </p>
      )}
      {saveError && (
        <p className="mt-2 text-xs text-red-600" data-testid="hygiene-save-error">
          {saveError}
        </p>
      )}

      <div className="mt-6 border-t border-gray-100 pt-4">
        <p className="text-sm text-gray-600 mb-3">
          {t('aiSettings.dataHygiene.runNowDescription')}
        </p>
        <Button
          variant="secondary"
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          data-testid="hygiene-run-now-button"
        >
          {runMutation.isPending ? t('common.saving') : t('aiSettings.dataHygiene.runNow')}
        </Button>

        {runAccepted && (
          <p className="mt-2 text-xs text-green-600" data-testid="hygiene-run-accepted">
            {t('aiSettings.dataHygiene.runAccepted')}
          </p>
        )}
        {runError && (
          <p className="mt-2 text-xs text-red-600" data-testid="hygiene-run-error">
            {runError}
          </p>
        )}
      </div>
    </div>
  );
}

export function AiDataHygieneSection() {
  const { t } = useTranslation();

  const { data, isLoading, isError } = useQuery({
    queryKey: DATA_HYGIENE_CONFIG_QUERY_KEY,
    queryFn: getDataHygieneConfig,
  });

  if (isLoading) {
    return (
      <div className="py-8 text-center text-gray-500" data-testid="hygiene-loading">
        {t('common.loading')}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="py-8 text-center text-red-600" data-testid="hygiene-error">
        {t('aiSettings.dataHygiene.loadError')}
      </div>
    );
  }

  return <AiDataHygieneThresholdsForm config={data} />;
}
