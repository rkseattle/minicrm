/**
 * MfaSettings — MFA enforcement toggle for admins.
 * Extracted from GeneralSettings as part of the Security & Identity
 * tab consolidation.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getMfaRequiredSetting,
  setMfaRequiredSetting,
  MFA_REQUIRED_SETTING_QUERY_KEY,
} from '@/api/mfa.js';
import { useAuth } from '@/hooks/useAuth.js';

export default function MfaSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: mfaRequiredData } = useQuery({
    queryKey: MFA_REQUIRED_SETTING_QUERY_KEY,
    queryFn: getMfaRequiredSetting,
  });

  const [mfaRequiredSuccess, setMfaRequiredSuccess] = useState(false);
  const [mfaRequiredError, setMfaRequiredError] = useState(false);

  const mfaRequiredMutation = useMutation({
    mutationFn: (required: boolean) => setMfaRequiredSetting(required),
    onSuccess: (data) => {
      queryClient.setQueryData(MFA_REQUIRED_SETTING_QUERY_KEY, data);
      setMfaRequiredSuccess(true);
      setMfaRequiredError(false);
    },
    onError: () => {
      setMfaRequiredError(true);
      setMfaRequiredSuccess(false);
    },
  });

  if (user?.role !== 'admin') {
    return null;
  }

  return (
    <div
      className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
      data-testid="mfa-required-section"
    >
      <h2 className="text-lg font-semibold text-gray-900 mb-1">{t('mfa.sectionTitle')}</h2>
      <p className="text-xs text-gray-500 mb-4">{t('mfa.adminSetting.hint')}</p>

      <label
        className="flex items-center gap-3 cursor-pointer"
        data-testid="mfa-required-toggle-label"
      >
        <input
          type="checkbox"
          checked={mfaRequiredData?.mfa_required ?? false}
          disabled={mfaRequiredMutation.isPending}
          onChange={(e) => {
            setMfaRequiredSuccess(false);
            setMfaRequiredError(false);
            mfaRequiredMutation.mutate(e.target.checked);
          }}
          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          data-testid="mfa-required-checkbox"
        />
        <span className="text-sm text-gray-700">{t('mfa.adminSetting.label')}</span>
      </label>

      {mfaRequiredSuccess && (
        <p role="status" className="mt-3 text-sm text-green-700" data-testid="mfa-required-success">
          {t('mfa.adminSetting.saveSuccess')}
        </p>
      )}
      {mfaRequiredError && (
        <p role="alert" className="mt-3 text-sm text-red-600" data-testid="mfa-required-error">
          {t('mfa.adminSetting.saveError')}
        </p>
      )}
    </div>
  );
}
