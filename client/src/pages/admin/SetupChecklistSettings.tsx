/**
 * SetupChecklistSettings — Admin control to reset the onboarding setup
 * checklist (MINCRM-256, MINCRM-379). Extracted from GeneralSettings as part
 * of the Data & Platform tab consolidation (MINCRM-563).
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { setOnboardingCompleted, ONBOARDING_STATUS_QUERY_KEY } from '@/api/onboarding.js';
import { Button } from '@/components/ui/Button.js';

export default function SetupChecklistSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [resetOnboardingSuccess, setResetOnboardingSuccess] = useState(false);
  const [resetOnboardingError, setResetOnboardingError] = useState(false);

  const resetOnboardingMutation = useMutation({
    mutationFn: () => setOnboardingCompleted(false),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ONBOARDING_STATUS_QUERY_KEY });
      setResetOnboardingSuccess(true);
      setResetOnboardingError(false);
    },
    onError: () => {
      setResetOnboardingError(true);
      setResetOnboardingSuccess(false);
    },
  });

  return (
    <div
      className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
      data-testid="reset-onboarding-section"
    >
      <h2 className="text-lg font-semibold text-gray-900 mb-1">
        {t('settings.setupChecklist.resetTitle')}
      </h2>
      <p className="text-xs text-gray-500 mb-4">{t('settings.setupChecklist.resetHint')}</p>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        data-testid="reset-onboarding-button"
        disabled={resetOnboardingMutation.isPending}
        onClick={() => {
          setResetOnboardingSuccess(false);
          setResetOnboardingError(false);
          resetOnboardingMutation.mutate();
        }}
      >
        {t('settings.setupChecklist.resetButton')}
      </Button>

      {resetOnboardingSuccess && (
        <p
          role="status"
          className="mt-3 text-sm text-green-700"
          data-testid="reset-onboarding-success"
        >
          {t('settings.setupChecklist.resetSuccess')}
        </p>
      )}
      {resetOnboardingError && (
        <p role="alert" className="mt-3 text-sm text-red-600" data-testid="reset-onboarding-error">
          {t('settings.setupChecklist.resetError')}
        </p>
      )}
    </div>
  );
}
