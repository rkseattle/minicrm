/**
 * NotificationSettings — Email notifications toggle and SMTP configuration.
 * Extracted from AdminSettingsPage.tsx (MINCRM-259).
 */

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getEmailNotificationsEnabled,
  setEmailNotificationsEnabled,
  EMAIL_NOTIFICATIONS_QUERY_KEY,
  getSmtpConfig,
  setSmtpConfig,
  testSmtpConfig,
  SMTP_CONFIG_QUERY_KEY,
} from '@/api/settings.js';
import {
  getNotificationRecipientCount,
  NOTIFICATION_RECIPIENT_COUNT_QUERY_KEY,
} from '@/api/users.js';
import { useAuth } from '@/hooks/useAuth.js';
import { Button } from '@/components/ui/Button.js';

export default function NotificationSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // ── Email Notifications global toggle (MINCRM-163) ──────────────────────────

  const {
    data: emailNotifData,
    isLoading: emailNotifLoading,
    isError: emailNotifError,
  } = useQuery({
    queryKey: EMAIL_NOTIFICATIONS_QUERY_KEY,
    queryFn: getEmailNotificationsEnabled,
  });

  const [emailNotifSaving, setEmailNotifSaving] = useState(false);
  const [emailNotifSuccess, setEmailNotifSuccess] = useState(false);
  const [emailNotifSaveError, setEmailNotifSaveError] = useState(false);

  const emailNotifMutation = useMutation({
    mutationFn: setEmailNotificationsEnabled,
    onSuccess: (saved) => {
      queryClient.setQueryData(EMAIL_NOTIFICATIONS_QUERY_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: EMAIL_NOTIFICATIONS_QUERY_KEY });
      setEmailNotifSaving(false);
      setEmailNotifSuccess(true);
      setEmailNotifSaveError(false);
    },
    onError: () => {
      setEmailNotifSaving(false);
      setEmailNotifSaveError(true);
      setEmailNotifSuccess(false);
    },
  });

  function handleEmailNotifToggle(newValue: boolean): void {
    if (emailNotifSaving) return;
    setEmailNotifSaving(true);
    setEmailNotifSuccess(false);
    setEmailNotifSaveError(false);
    emailNotifMutation.mutate(newValue);
  }

  const emailNotifEnabled = emailNotifData?.enabled ?? true;

  // ── Recipient count ──────────────────────────────────────────────────────────

  const { data: recipientCountData, isLoading: recipientCountLoading } = useQuery({
    queryKey: NOTIFICATION_RECIPIENT_COUNT_QUERY_KEY,
    queryFn: getNotificationRecipientCount,
  });

  // ── SMTP configuration (MINCRM-254) ─────────────────────────────────────────

  const {
    data: smtpData,
    isLoading: smtpLoading,
    isError: smtpLoadError,
  } = useQuery({
    queryKey: SMTP_CONFIG_QUERY_KEY,
    queryFn: getSmtpConfig,
  });

  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState('');
  // Password is never pre-filled from the server — user must enter a new value to change
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpEnabled, setSmtpEnabled] = useState(false);
  const [smtpChangePassword, setSmtpChangePassword] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpSaveSuccess, setSmtpSaveSuccess] = useState(false);
  const [smtpSaveError, setSmtpSaveError] = useState(false);
  const [smtpTestAddress, setSmtpTestAddress] = useState('');
  const [smtpTestStatus, setSmtpTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>(
    'idle',
  );
  const [smtpTestErrorMessage, setSmtpTestErrorMessage] = useState('');

  // Track the last server data snapshot we've applied so we re-sync on invalidation.
  const smtpLastSyncedRef = useRef<typeof smtpData | null>(null);
  if (smtpData && smtpData !== smtpLastSyncedRef.current) {
    smtpLastSyncedRef.current = smtpData;
    setSmtpHost(smtpData.smtp_host);
    setSmtpPort(smtpData.smtp_port);
    setSmtpUser(smtpData.smtp_user);
    setSmtpEnabled(smtpData.smtp_enabled);
    if (smtpData.smtp_pass_set) {
      setSmtpChangePassword(false);
    }
  }

  const smtpForm = {
    smtp_host: smtpHost,
    smtp_port: smtpPort,
    smtp_user: smtpUser,
    smtp_pass: smtpPass,
    smtp_enabled: smtpEnabled,
  };

  async function handleSmtpSave(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSmtpSaving(true);
    setSmtpSaveSuccess(false);
    setSmtpSaveError(false);
    const passwordIsChanging = smtpChangePassword || !smtpData?.smtp_pass_set;
    try {
      await setSmtpConfig({
        smtp_host: smtpForm.smtp_host,
        smtp_port: smtpForm.smtp_port,
        smtp_user: smtpForm.smtp_user,
        ...(passwordIsChanging && smtpForm.smtp_pass ? { smtp_pass: smtpForm.smtp_pass } : {}),
        smtp_enabled: smtpForm.smtp_enabled,
      });
      await queryClient.invalidateQueries({ queryKey: SMTP_CONFIG_QUERY_KEY });
      setSmtpSaveSuccess(true);
      setSmtpChangePassword(false);
      setSmtpPass('');
    } catch {
      setSmtpSaveError(true);
    } finally {
      setSmtpSaving(false);
    }
  }

  async function handleSmtpTest(): Promise<void> {
    if (!smtpTestAddress) return;
    setSmtpTestStatus('sending');
    setSmtpTestErrorMessage('');
    try {
      const result = await testSmtpConfig(smtpTestAddress);
      if (result.success) {
        setSmtpTestStatus('success');
      } else {
        setSmtpTestStatus('error');
        setSmtpTestErrorMessage(result.error ?? t('settings.smtp.testError', { message: '' }));
      }
    } catch {
      setSmtpTestStatus('error');
      setSmtpTestErrorMessage(t('settings.smtp.testError', { message: t('errors.generic') }));
    }
  }

  return (
    <>
      {/* ── Email Notifications section (MINCRM-163) ─────────────────────── */}
      <div
        className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
        data-testid="email-notifications-section"
      >
        <h2
          className="text-lg font-semibold text-gray-900 mb-1"
          data-testid="email-notifications-section-title"
        >
          {t('settings.emailNotifications.sectionTitle')}
        </h2>
        <p className="text-xs text-gray-500 mb-4">{t('settings.emailNotifications.sectionHint')}</p>

        {emailNotifLoading && (
          <p className="text-sm text-gray-500" data-testid="email-notif-loading">
            {t('common.loading')}
          </p>
        )}

        {emailNotifError && (
          <p role="alert" className="text-sm text-red-600" data-testid="email-notif-error">
            {t('settings.loadError')}
          </p>
        )}

        {!emailNotifLoading && !emailNotifError && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600" data-testid="email-notif-recipient-count">
              {recipientCountLoading
                ? t('common.loading')
                : t('settings.emailNotifications.recipientCount', {
                    count: recipientCountData?.count ?? 0,
                  })}
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={emailNotifEnabled}
                data-testid="email-notif-toggle"
                disabled={emailNotifSaving}
                onClick={() => handleEmailNotifToggle(!emailNotifEnabled)}
                className={[
                  'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2',
                  emailNotifEnabled ? 'bg-indigo-600' : 'bg-gray-200',
                  emailNotifSaving ? 'opacity-50 cursor-not-allowed' : '',
                ].join(' ')}
              >
                <span
                  className={[
                    'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                    emailNotifEnabled ? 'translate-x-5' : 'translate-x-0',
                  ].join(' ')}
                />
              </button>
              <span className="text-sm font-medium text-gray-700">
                {emailNotifEnabled
                  ? t('settings.emailNotifications.enabled')
                  : t('settings.emailNotifications.disabled')}
              </span>
            </div>

            {emailNotifSuccess && (
              <p role="status" className="text-sm text-green-700" data-testid="email-notif-success">
                {t('settings.emailNotifications.saveSuccess')}
              </p>
            )}
            {emailNotifSaveError && (
              <p role="alert" className="text-sm text-red-600" data-testid="email-notif-save-error">
                {t('settings.emailNotifications.saveError')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── SMTP Configuration section (MINCRM-254) ──────────────────────── */}
      {user?.role === 'admin' && (
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="smtp-section"
        >
          <h2 className="text-lg font-semibold text-gray-900 mb-1" data-testid="smtp-section-title">
            {t('settings.smtp.sectionTitle')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('settings.smtp.sectionHint')}</p>

          {smtpLoading && (
            <p className="text-sm text-gray-500" data-testid="smtp-loading">
              {t('settings.smtp.loading')}
            </p>
          )}
          {smtpLoadError && (
            <p role="alert" className="text-sm text-red-600" data-testid="smtp-load-error">
              {t('settings.smtp.loadError')}
            </p>
          )}

          {!smtpLoading && !smtpLoadError && (
            <form onSubmit={(e) => void handleSmtpSave(e)} className="space-y-4">
              <div>
                <label htmlFor="smtp-host" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.smtp.hostLabel')}
                </label>
                <input
                  id="smtp-host"
                  type="text"
                  data-testid="smtp-host-input"
                  value={smtpForm.smtp_host}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="smtp.example.com"
                />
              </div>

              <div>
                <label htmlFor="smtp-port" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.smtp.portLabel')}
                </label>
                <input
                  id="smtp-port"
                  type="number"
                  data-testid="smtp-port-input"
                  value={smtpForm.smtp_port}
                  min={1}
                  max={65535}
                  onChange={(e) => setSmtpPort(parseInt(e.target.value, 10) || 587)}
                  className="block w-32 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="smtp-user" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.smtp.usernameLabel')}
                </label>
                <input
                  id="smtp-user"
                  type="text"
                  data-testid="smtp-user-input"
                  value={smtpForm.smtp_user}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="smtp-pass" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('settings.smtp.passwordLabel')}
                </label>
                {smtpData?.smtp_pass_set && !smtpChangePassword ? (
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-gray-500" data-testid="smtp-pass-masked">
                      {t('settings.smtp.passwordSet')}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      data-testid="smtp-change-password-button"
                      onClick={() => setSmtpChangePassword(true)}
                    >
                      {t('settings.smtp.changePasswordButton')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <input
                      id="smtp-pass"
                      type="password"
                      data-testid="smtp-pass-input"
                      value={smtpForm.smtp_pass}
                      onChange={(e) => setSmtpPass(e.target.value)}
                      className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      autoComplete="new-password"
                    />
                    {smtpData?.smtp_pass_set && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        data-testid="smtp-cancel-password-button"
                        onClick={() => {
                          setSmtpChangePassword(false);
                          setSmtpPass('');
                        }}
                      >
                        {t('settings.smtp.cancelPasswordButton')}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={smtpForm.smtp_enabled}
                  data-testid="smtp-enabled-toggle"
                  onClick={() => setSmtpEnabled((prev) => !prev)}
                  className={[
                    'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2',
                    smtpForm.smtp_enabled ? 'bg-indigo-600' : 'bg-gray-200',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                      smtpForm.smtp_enabled ? 'translate-x-5' : 'translate-x-0',
                    ].join(' ')}
                  />
                </button>
                <span className="text-sm font-medium text-gray-700">
                  {smtpForm.smtp_enabled
                    ? t('settings.smtp.enabledOn')
                    : t('settings.smtp.enabledOff')}
                </span>
              </div>

              {smtpSaveSuccess && (
                <p role="status" className="text-sm text-green-700" data-testid="smtp-save-success">
                  {t('settings.smtp.saveSuccess')}
                </p>
              )}
              {smtpSaveError && (
                <p role="alert" className="text-sm text-red-600" data-testid="smtp-save-error">
                  {t('settings.smtp.saveError')}
                </p>
              )}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  data-testid="smtp-save-button"
                  disabled={smtpSaving}
                >
                  {smtpSaving ? t('settings.saving') : t('settings.smtp.saveButton')}
                </Button>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm font-medium text-gray-700 mb-3">
                  {t('settings.smtp.testSectionTitle')}
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-0">
                    <label
                      htmlFor="smtp-test-address"
                      className="block text-xs font-medium text-gray-700 mb-1"
                    >
                      {t('settings.smtp.testEmailLabel')}
                    </label>
                    <input
                      id="smtp-test-address"
                      type="email"
                      data-testid="smtp-test-address-input"
                      value={smtpTestAddress}
                      onChange={(e) => {
                        setSmtpTestAddress(e.target.value);
                        setSmtpTestStatus('idle');
                      }}
                      className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      placeholder="you@example.com"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    data-testid="smtp-test-button"
                    disabled={smtpTestStatus === 'sending' || !smtpTestAddress}
                    onClick={() => void handleSmtpTest()}
                  >
                    {smtpTestStatus === 'sending'
                      ? t('settings.smtp.testSending')
                      : t('settings.smtp.testButton')}
                  </Button>
                </div>

                {smtpTestStatus === 'success' && (
                  <p
                    role="status"
                    className="mt-2 text-sm text-green-700"
                    data-testid="smtp-test-success"
                  >
                    {t('settings.smtp.testSuccess', { address: smtpTestAddress })}
                  </p>
                )}
                {smtpTestStatus === 'error' && (
                  <p
                    role="alert"
                    className="mt-2 text-sm text-red-600 break-words"
                    data-testid="smtp-test-error"
                  >
                    {t('settings.smtp.testError', { message: smtpTestErrorMessage })}
                  </p>
                )}
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
