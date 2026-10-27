/**
 * EmailSyncSettings — org-wide governance for synced mail: domains no mailbox stores, and
 * how far back a newly connected mailbox reads.
 *
 * Disabled-not-hidden when email_sync is off org-wide, like the AI panel: an administrator
 * needs to see what exists in order to decide to turn it on.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  MAX_EXCLUDED_DOMAINS,
  excludedDomainListSchema,
  parseExcludedDomainLines,
} from '@shared/schemas/emailDomainSchema.js';
import {
  EMAIL_SYNC_BACKFILL_DAYS_DEFAULT,
  EMAIL_SYNC_BACKFILL_DAYS_MAX,
  EMAIL_SYNC_BACKFILL_DAYS_MIN,
  emailSyncBackfillDaysSchema,
} from '@shared/schemas/settingsSchema.js';
import {
  EMAIL_SYNC_BACKFILL_DAYS_QUERY_KEY,
  EMAIL_SYNC_EXCLUDED_DOMAINS_QUERY_KEY,
  getEmailSyncBackfillDays,
  getEmailSyncExcludedDomains,
  setEmailSyncBackfillDays,
  setEmailSyncExcludedDomains,
} from '@/api/settings.js';
import { Button } from '@/components/ui/Button.js';

interface EmailSyncSettingsProps {
  /** True when email_sync is off org-wide: shown, but nothing can be changed. */
  disabled?: boolean;
}

export default function EmailSyncSettings({ disabled = false }: EmailSyncSettingsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const domainsQuery = useQuery({
    queryKey: EMAIL_SYNC_EXCLUDED_DOMAINS_QUERY_KEY,
    queryFn: getEmailSyncExcludedDomains,
  });
  const daysQuery = useQuery({
    queryKey: EMAIL_SYNC_BACKFILL_DAYS_QUERY_KEY,
    queryFn: getEmailSyncBackfillDays,
  });

  const [domainsText, setDomainsText] = useState('');
  const [daysText, setDaysText] = useState(String(EMAIL_SYNC_BACKFILL_DAYS_DEFAULT));
  const [domainsError, setDomainsError] = useState<string | null>(null);
  const [daysError, setDaysError] = useState<string | null>(null);
  const [saved, setSaved] = useState<'domains' | 'days' | null>(null);

  // Re-synced during render when the server snapshot changes, as NotificationSettings does.
  const [prevDomains, setPrevDomains] = useState(domainsQuery.data);
  if (domainsQuery.data && domainsQuery.data !== prevDomains) {
    setPrevDomains(domainsQuery.data);
    setDomainsText(domainsQuery.data.domains.join('\n'));
  }
  const [prevDays, setPrevDays] = useState(daysQuery.data);
  if (daysQuery.data && daysQuery.data !== prevDays) {
    setPrevDays(daysQuery.data);
    setDaysText(String(daysQuery.data.days));
  }

  const domainsMutation = useMutation({
    mutationFn: setEmailSyncExcludedDomains,
    onSuccess: (data) => {
      queryClient.setQueryData(EMAIL_SYNC_EXCLUDED_DOMAINS_QUERY_KEY, data);
      setSaved('domains');
    },
    onError: () => setDomainsError(t('settings.emailSync.saveError')),
  });
  const daysMutation = useMutation({
    mutationFn: setEmailSyncBackfillDays,
    onSuccess: (data) => {
      queryClient.setQueryData(EMAIL_SYNC_BACKFILL_DAYS_QUERY_KEY, data);
      setSaved('days');
    },
    onError: () => setDaysError(t('settings.emailSync.saveError')),
  });

  function saveDomains(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setSaved(null);
    const parsed = excludedDomainListSchema.safeParse(parseExcludedDomainLines(domainsText));
    if (!parsed.success) {
      setDomainsError(t('settings.emailSync.domainsInvalid', { max: MAX_EXCLUDED_DOMAINS }));
      return;
    }
    setDomainsError(null);
    domainsMutation.mutate(parsed.data);
  }

  function saveDays(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setSaved(null);
    const parsed = emailSyncBackfillDaysSchema.safeParse({ days: Number(daysText) });
    if (!parsed.success) {
      setDaysError(
        t('settings.emailSync.daysInvalid', {
          min: EMAIL_SYNC_BACKFILL_DAYS_MIN,
          max: EMAIL_SYNC_BACKFILL_DAYS_MAX,
        }),
      );
      return;
    }
    setDaysError(null);
    daysMutation.mutate(parsed.data.days);
  }

  const loading = domainsQuery.isLoading || daysQuery.isLoading;
  // A failed read never offers the form: saving over a value nobody saw could empty a valid
  // list, and exclusion only works forward. A malformed stored value is replaced by the API.
  const loadError = domainsQuery.isError || daysQuery.isError;

  return (
    <div
      className="bg-white shadow-xs rounded-lg border border-gray-200 p-6 max-w-2xl"
      data-testid="email-sync-settings"
      role="region"
      aria-labelledby="email-sync-settings-title"
    >
      <h2 id="email-sync-settings-title" className="text-lg font-semibold text-gray-900 mb-1">
        {t('settings.emailSync.sectionTitle')}
      </h2>
      <p className="text-xs text-gray-500 mb-4">{t('settings.emailSync.sectionHint')}</p>

      {disabled && (
        <p
          className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2 mb-4"
          data-testid="email-sync-settings-disabled-banner"
        >
          {t('settings.featureDisabledBanner')}
        </p>
      )}

      {loading && (
        <p className="text-sm text-gray-500" data-testid="email-sync-settings-loading">
          {t('common.loading')}
        </p>
      )}

      {loadError && (
        <p role="alert" className="text-sm text-red-600" data-testid="email-sync-settings-error">
          {t('settings.loadError')}
        </p>
      )}

      {!loading && !loadError && (
        <fieldset disabled={disabled} className={disabled ? 'opacity-60 space-y-6' : 'space-y-6'}>
          <form onSubmit={saveDomains} className="space-y-2" noValidate>
            <label
              htmlFor="email-sync-excluded-domains"
              className="block text-sm font-medium text-gray-700"
            >
              {t('settings.emailSync.domainsLabel')}
            </label>
            <p className="text-xs text-gray-500" id="email-sync-excluded-domains-hint">
              {t('settings.emailSync.domainsHint')}
            </p>
            <textarea
              id="email-sync-excluded-domains"
              rows={5}
              value={domainsText}
              onChange={(e) => {
                setDomainsText(e.target.value);
                setSaved(null);
              }}
              placeholder={t('settings.emailSync.domainsPlaceholder')}
              aria-describedby="email-sync-excluded-domains-hint"
              aria-invalid={domainsError !== null}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
              data-testid="email-sync-excluded-domains-input"
            />
            {domainsError && (
              <p
                role="alert"
                className="text-sm text-red-600"
                data-testid="email-sync-domains-error"
              >
                {domainsError}
              </p>
            )}
            {saved === 'domains' && (
              <p
                role="status"
                className="text-sm text-green-700"
                data-testid="email-sync-domains-saved"
              >
                {t('settings.emailSync.saved')}
              </p>
            )}
            <Button
              type="submit"
              disabled={domainsMutation.isPending}
              data-testid="email-sync-domains-save"
            >
              {t('common.save')}
            </Button>
          </form>

          <form onSubmit={saveDays} className="space-y-2" noValidate>
            <label
              htmlFor="email-sync-backfill-days"
              className="block text-sm font-medium text-gray-700"
            >
              {t('settings.emailSync.daysLabel')}
            </label>
            <p className="text-xs text-gray-500" id="email-sync-backfill-days-hint">
              {t('settings.emailSync.daysHint')}
            </p>
            <input
              id="email-sync-backfill-days"
              type="number"
              inputMode="numeric"
              min={EMAIL_SYNC_BACKFILL_DAYS_MIN}
              max={EMAIL_SYNC_BACKFILL_DAYS_MAX}
              value={daysText}
              onChange={(e) => {
                setDaysText(e.target.value);
                setSaved(null);
              }}
              aria-describedby="email-sync-backfill-days-hint"
              aria-invalid={daysError !== null}
              className="block w-32 rounded-md border border-gray-300 px-3 py-2 text-sm"
              data-testid="email-sync-backfill-days-input"
            />
            {daysError && (
              <p role="alert" className="text-sm text-red-600" data-testid="email-sync-days-error">
                {daysError}
              </p>
            )}
            {saved === 'days' && (
              <p
                role="status"
                className="text-sm text-green-700"
                data-testid="email-sync-days-saved"
              >
                {t('settings.emailSync.saved')}
              </p>
            )}
            <Button
              type="submit"
              disabled={daysMutation.isPending}
              data-testid="email-sync-days-save"
            >
              {t('common.save')}
            </Button>
          </form>
        </fieldset>
      )}
    </div>
  );
}
