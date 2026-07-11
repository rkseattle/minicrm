/**
 * VisibilitySettings — Per-object data visibility policy configuration.
 * Admin only. Allows configuring private / team / org scoping per object type.
 * (MINCRM-538)
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getVisibilityConfig,
  putVisibilityConfig,
  VISIBILITY_CONFIG_QUERY_KEY,
} from '@/api/settings.js';
import { VISIBILITY_POLICIES } from '@shared/schemas/visibilitySchema.js';
import type { VisibilityPolicy } from '@shared/schemas/visibilitySchema.js';
import { Select } from '@/components/ui/Select.js';
import { Button } from '@/components/ui/Button.js';

export default function VisibilitySettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: VISIBILITY_CONFIG_QUERY_KEY,
    queryFn: getVisibilityConfig,
  });

  const [pendingContact, setPendingContact] = useState<VisibilityPolicy | null>(null);
  const [pendingDeal, setPendingDeal] = useState<VisibilityPolicy | null>(null);
  const [pendingActivity, setPendingActivity] = useState<VisibilityPolicy | null>(null);
  const [pendingAccount, setPendingAccount] = useState<VisibilityPolicy | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const mutation = useMutation({
    mutationFn: putVisibilityConfig,
    onSuccess: (response) => {
      queryClient.setQueryData(VISIBILITY_CONFIG_QUERY_KEY, response);
      setPendingContact(null);
      setPendingDeal(null);
      setPendingActivity(null);
      setPendingAccount(null);
      setSaveSuccess(true);
      setSaveError(false);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: () => {
      setSaveSuccess(false);
      setSaveError(true);
    },
  });

  const currentContact = pendingContact ?? data?.visibility.contact ?? 'org';
  const currentDeal = pendingDeal ?? data?.visibility.deal ?? 'org';
  const currentActivity = pendingActivity ?? data?.visibility.activity ?? 'org';
  const currentAccount = pendingAccount ?? data?.visibility.account ?? 'org';

  const hasChanges =
    (pendingContact !== null && pendingContact !== data?.visibility.contact) ||
    (pendingDeal !== null && pendingDeal !== data?.visibility.deal) ||
    (pendingActivity !== null && pendingActivity !== data?.visibility.activity) ||
    (pendingAccount !== null && pendingAccount !== data?.visibility.account);

  function handleSave() {
    const updates: Record<string, VisibilityPolicy> = {};
    if (pendingContact !== null && pendingContact !== data?.visibility.contact) {
      updates.contact = pendingContact;
    }
    if (pendingDeal !== null && pendingDeal !== data?.visibility.deal) {
      updates.deal = pendingDeal;
    }
    if (pendingActivity !== null && pendingActivity !== data?.visibility.activity) {
      updates.activity = pendingActivity;
    }
    if (pendingAccount !== null && pendingAccount !== data?.visibility.account) {
      updates.account = pendingAccount;
    }
    if (Object.keys(updates).length === 0) return;
    mutation.mutate(updates);
  }

  if (isLoading) {
    return (
      <p className="text-sm text-gray-500" data-testid="visibility-settings-loading">
        {t('settings.loading')}
      </p>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-red-600" role="alert" data-testid="visibility-settings-error">
        {t('visibilitySettings.loadError')}
      </p>
    );
  }

  const policyOptions = VISIBILITY_POLICIES.map((p) => ({
    value: p,
    label: t(`visibilitySettings.policy.${p}`),
  }));

  return (
    <div className="space-y-6" data-testid="visibility-settings-panel">
      <div>
        <h2 className="text-lg font-semibold text-gray-900" data-testid="visibility-settings-title">
          {t('visibilitySettings.sectionTitle')}
        </h2>
        <p className="mt-1 text-sm text-gray-500">{t('visibilitySettings.sectionHint')}</p>
      </div>

      <div className="space-y-4">
        <Select
          id="visibility-contacts"
          label={t('visibilitySettings.contactsLabel')}
          value={currentContact}
          onChange={(e) => setPendingContact(e.target.value as VisibilityPolicy)}
          data-testid="visibility-contacts-select"
        >
          {policyOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>

        <Select
          id="visibility-deals"
          label={t('visibilitySettings.dealsLabel')}
          value={currentDeal}
          onChange={(e) => setPendingDeal(e.target.value as VisibilityPolicy)}
          data-testid="visibility-deals-select"
        >
          {policyOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>

        <Select
          id="visibility-activities"
          label={t('visibilitySettings.activitiesLabel')}
          value={currentActivity}
          onChange={(e) => setPendingActivity(e.target.value as VisibilityPolicy)}
          data-testid="visibility-activities-select"
        >
          {policyOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>

        <Select
          id="visibility-accounts"
          label={t('visibilitySettings.accountsLabel')}
          value={currentAccount}
          onChange={(e) => setPendingAccount(e.target.value as VisibilityPolicy)}
          data-testid="visibility-accounts-select"
        >
          {policyOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || mutation.isPending}
          data-testid="visibility-settings-save-button"
        >
          {mutation.isPending ? t('visibilitySettings.saving') : t('visibilitySettings.saveButton')}
        </Button>

        {saveSuccess && (
          <p
            className="text-sm text-green-600"
            role="status"
            data-testid="visibility-settings-success"
          >
            {t('visibilitySettings.saveSuccess')}
          </p>
        )}
        {saveError && (
          <p
            className="text-sm text-red-600"
            role="alert"
            data-testid="visibility-settings-save-error"
          >
            {t('visibilitySettings.saveError')}
          </p>
        )}
      </div>
    </div>
  );
}
