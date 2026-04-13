/**
 * Admin Settings page.
 * Allows admins to configure system-wide settings.
 * Sections: system default language, navigation layout (MINCRM-133), demo data management (MINCRM-103).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import CsvImporter from '@/components/CsvImporter.js';
import {
  getDefaultLanguage,
  setDefaultLanguage,
  DEFAULT_LANGUAGE_QUERY_KEY,
} from '@/api/settings.js';
import {
  getDemoStatus,
  seedDemoData,
  resetDemoData,
  removeDemoData,
  DEMO_STATUS_QUERY_KEY,
} from '@/api/demo.js';
import {
  getEmailNotificationsEnabled,
  setEmailNotificationsEnabled,
  EMAIL_NOTIFICATIONS_QUERY_KEY,
} from '@/api/settings.js';
import {
  getNotificationRecipientCount,
  NOTIFICATION_RECIPIENT_COUNT_QUERY_KEY,
} from '@/api/users.js';
import { SUPPORTED_LOCALES, NAV_LAYOUTS } from '@shared/schemas/settingsSchema.js';
import type { SupportedLocale, NavLayout } from '@shared/schemas/settingsSchema.js';
import { useNavLayout } from '@/components/NavLayoutContext.js';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';
import {
  getStorageConfig,
  setStorageConfig,
  clearStorageConfig,
  testStorageConfig,
  STORAGE_CONFIG_QUERY_KEY,
} from '@/api/attachments.js';

type DemoAction = 'seed' | 'reset' | 'remove';
type ImportTab = 'accounts' | 'contacts' | 'deals';

/**
 * Admin-only page for configuring system-wide settings.
 */
export default function AdminSettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // ── Language settings ────────────────────────────────────────────────────────

  const { data, isLoading, isError } = useQuery({
    queryKey: DEFAULT_LANGUAGE_QUERY_KEY,
    queryFn: getDefaultLanguage,
  });

  const { layout: activeLayout, saveLayout } = useNavLayout();

  const [pendingLanguage, setPendingLanguage] = useState<SupportedLocale | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showError, setShowError] = useState(false);

  // ── Nav layout settings ──────────────────────────────────────────────────────

  const [navLayoutSaving, setNavLayoutSaving] = useState(false);
  const [navLayoutSuccess, setNavLayoutSuccess] = useState(false);
  const [navLayoutError, setNavLayoutError] = useState(false);

  /**
   * Persists the selected navigation layout immediately via context.
   *
   * @param newLayout - The chosen layout value.
   */
  async function handleNavLayoutChange(newLayout: NavLayout): Promise<void> {
    if (newLayout === activeLayout) return;
    setNavLayoutSaving(true);
    setNavLayoutSuccess(false);
    setNavLayoutError(false);
    try {
      await saveLayout(newLayout);
      setNavLayoutSuccess(true);
    } catch {
      setNavLayoutError(true);
    } finally {
      setNavLayoutSaving(false);
    }
  }

  const selectedLanguage: SupportedLocale = pendingLanguage ?? data?.language ?? 'en';

  const languageMutation = useMutation({
    mutationFn: setDefaultLanguage,
    onSuccess: (savedLanguage) => {
      queryClient.setQueryData(DEFAULT_LANGUAGE_QUERY_KEY, savedLanguage);
      void queryClient.invalidateQueries({ queryKey: DEFAULT_LANGUAGE_QUERY_KEY });
      setPendingLanguage(null);
      setShowSuccess(true);
      setShowError(false);
    },
    onError: () => {
      setShowError(true);
      setShowSuccess(false);
    },
  });

  /**
   * Handles form submission to persist the selected language.
   *
   * @param e - The form submit event.
   */
  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setShowSuccess(false);
    setShowError(false);
    languageMutation.mutate(selectedLanguage);
  }

  // ── Demo data ────────────────────────────────────────────────────────────────

  const {
    data: demoStatus,
    isLoading: demoStatusLoading,
    isError: demoStatusError,
  } = useQuery({
    queryKey: DEMO_STATUS_QUERY_KEY,
    queryFn: getDemoStatus,
  });

  // pendingAction is the action awaiting confirmation dialog, null when dialog is closed
  const [pendingAction, setPendingAction] = useState<DemoAction | null>(null);
  const [demoFeedback, setDemoFeedback] = useState<{
    type: 'success' | 'error';
    key: string;
  } | null>(null);

  // Ref for the feedback paragraph — focused after a mutation settles so keyboard users
  // land on a live region rather than a now-disabled trigger button.
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  // Move focus to the feedback message whenever it appears.
  useEffect(() => {
    if (demoFeedback) {
      feedbackRef.current?.focus();
    }
  }, [demoFeedback]);

  const seedMutation = useMutation({
    mutationFn: seedDemoData,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEMO_STATUS_QUERY_KEY });
      setDemoFeedback({ type: 'success', key: 'settings.demo.seedSuccess' });
    },
    onError: () => {
      setDemoFeedback({ type: 'error', key: 'settings.demo.seedError' });
    },
  });

  const resetMutation = useMutation({
    mutationFn: resetDemoData,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEMO_STATUS_QUERY_KEY });
      setDemoFeedback({ type: 'success', key: 'settings.demo.resetSuccess' });
    },
    onError: () => {
      setDemoFeedback({ type: 'error', key: 'settings.demo.resetError' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: removeDemoData,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEMO_STATUS_QUERY_KEY });
      setDemoFeedback({ type: 'success', key: 'settings.demo.removeSuccess' });
    },
    onError: () => {
      setDemoFeedback({ type: 'error', key: 'settings.demo.removeError' });
    },
  });

  const isDemoMutating =
    seedMutation.isPending || resetMutation.isPending || removeMutation.isPending;

  /**
   * Opens the confirmation dialog for the given action.
   *
   * @param action - The demo action to confirm.
   */
  function openConfirm(action: DemoAction): void {
    setDemoFeedback(null);
    setPendingAction(action);
  }

  /**
   * Closes the confirmation dialog without acting.
   * Focus returns to the document naturally as the dialog unmounts.
   */
  function closeConfirm(): void {
    setPendingAction(null);
  }

  /**
   * Executes the confirmed demo action.
   * Focus is moved to the feedback paragraph once the mutation settles (via useEffect).
   */
  function executeAction(): void {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    if (action === 'seed') seedMutation.mutate();
    else if (action === 'reset') resetMutation.mutate();
    else removeMutation.mutate();
  }

  const demoActive = demoStatus?.active ?? false;

  // ── Email Notifications global toggle (MINCRM-163) ──────────────────────────

  const {
    data: emailNotifData,
    isLoading: emailNotifLoading,
    isError: emailNotifError,
  } = useQuery({
    queryKey: EMAIL_NOTIFICATIONS_QUERY_KEY,
    queryFn: getEmailNotificationsEnabled,
  });

  const { data: recipientCountData, isLoading: recipientCountLoading } = useQuery({
    queryKey: NOTIFICATION_RECIPIENT_COUNT_QUERY_KEY,
    queryFn: getNotificationRecipientCount,
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

  /**
   * Toggles the system-wide email notifications setting.
   *
   * @param newValue - The new enabled state.
   */
  function handleEmailNotifToggle(newValue: boolean): void {
    if (emailNotifSaving) return;
    setEmailNotifSaving(true);
    setEmailNotifSuccess(false);
    setEmailNotifSaveError(false);
    emailNotifMutation.mutate(newValue);
  }

  const emailNotifEnabled = emailNotifData?.enabled ?? true;

  // ── Import Data ──────────────────────────────────────────────────────────────

  const [importTab, setImportTab] = useState<ImportTab>('accounts');

  // ── File Storage settings (MINCRM-169) ───────────────────────────────────────

  const {
    data: storageData,
    isLoading: storageLoading,
    isError: storageError,
  } = useQuery({
    queryKey: STORAGE_CONFIG_QUERY_KEY,
    queryFn: getStorageConfig,
  });

  const [storageForm, setStorageForm] = useState({
    endpoint: '',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
  });
  // Populate form from query data once loaded
  useEffect(() => {
    if (storageData?.config) {
      setStorageForm((prev) => ({
        endpoint: storageData.config!.endpoint,
        bucket: storageData.config!.bucket,
        accessKeyId: storageData.config!.accessKeyId,
        // Keep a local secret field empty so user must re-enter to change
        secretAccessKey: prev.secretAccessKey,
      }));
    }
  }, [storageData]);

  const [storageTestStatus, setStorageTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>(
    'idle',
  );
  const [storageSaveSuccess, setStorageSaveSuccess] = useState(false);
  const [storageSaveError, setStorageSaveError] = useState(false);

  const storageSaveMutation = useMutation({
    mutationFn: setStorageConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_CONFIG_QUERY_KEY });
      setStorageSaveSuccess(true);
      setStorageSaveError(false);
      setStorageForm((prev) => ({ ...prev, secretAccessKey: '' }));
    },
    onError: () => {
      setStorageSaveError(true);
      setStorageSaveSuccess(false);
    },
  });

  const storageClearMutation = useMutation({
    mutationFn: clearStorageConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_CONFIG_QUERY_KEY });
      setStorageForm({ endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' });
      setStorageSaveSuccess(false);
      setStorageSaveError(false);
      setStorageTestStatus('idle');
    },
    onError: () => {
      setStorageSaveError(true);
    },
  });

  /**
   * Tests the candidate storage credentials without saving.
   */
  const handleStorageTest = useCallback(async (): Promise<void> => {
    setStorageTestStatus('testing');
    try {
      const result = await testStorageConfig(storageForm);
      setStorageTestStatus(result.success ? 'ok' : 'fail');
    } catch {
      setStorageTestStatus('fail');
    }
  }, [storageForm]);

  /**
   * Saves the storage configuration.
   *
   * @param e - Form submit event.
   */
  function handleStorageSave(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setStorageSaveSuccess(false);
    setStorageSaveError(false);
    storageSaveMutation.mutate(storageForm);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6" data-testid="settings-heading">
          {t('settings.pageTitle')}
        </h1>

        {isLoading && (
          <p className="text-sm text-gray-500" data-testid="settings-loading">
            {t('settings.loading')}
          </p>
        )}

        {isError && (
          <p role="alert" className="text-sm text-red-600" data-testid="settings-load-error">
            {t('settings.loadError')}
          </p>
        )}

        {!isLoading && !isError && (
          <form
            onSubmit={handleSubmit}
            className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 space-y-6 max-w-2xl"
          >
            <div>
              <label
                htmlFor="default-language"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('settings.defaultLanguageLabel')}
              </label>
              {/* Translator note: this hint describes the scope of the system-wide default language
                  setting. It appears below the language dropdown label on the Admin Settings page.
                  It is a noun phrase / explanatory sentence — not a button label. */}
              <p className="text-xs text-gray-500 mb-3">{t('settings.defaultLanguageHint')}</p>
              <Select
                id="default-language"
                data-testid="default-language-select"
                value={selectedLanguage}
                onChange={(e) => setPendingLanguage(e.target.value as SupportedLocale)}
              >
                {SUPPORTED_LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {t(`settings.languages.${locale}`)}
                  </option>
                ))}
              </Select>
            </div>

            {showSuccess && (
              <p role="status" className="text-sm text-green-700" data-testid="settings-success">
                {t('settings.saveSuccess')}
              </p>
            )}

            {showError && (
              <p role="alert" className="text-sm text-red-600" data-testid="settings-error">
                {t('settings.saveError')}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="md"
                data-testid="settings-save"
                disabled={languageMutation.isPending}
              >
                {languageMutation.isPending ? t('settings.saving') : t('settings.saveButton')}
              </Button>
            </div>
          </form>
        )}

        {/* ── Navigation Layout section — desktop only (mobile always uses hamburger) */}
        <div
          className="hidden lg:block mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="nav-layout-section"
        >
          <h2
            className="text-lg font-semibold text-gray-900 mb-1"
            data-testid="nav-layout-section-title"
          >
            {t('settings.navLayout.label')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('settings.navLayout.hint')}</p>

          <div
            className="flex flex-wrap gap-3"
            role="radiogroup"
            aria-label={t('settings.navLayout.label')}
          >
            {NAV_LAYOUTS.map((layoutOption) => (
              <button
                key={layoutOption}
                type="button"
                role="radio"
                aria-checked={activeLayout === layoutOption}
                data-testid={`nav-layout-option-${layoutOption}`}
                disabled={navLayoutSaving}
                onClick={() => void handleNavLayoutChange(layoutOption)}
                className={[
                  'px-4 py-2 rounded-md border text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500',
                  activeLayout === layoutOption
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50',
                  navLayoutSaving ? 'opacity-50 cursor-not-allowed' : '',
                ].join(' ')}
              >
                {t(`settings.navLayout.${layoutOption}`)}
              </button>
            ))}
          </div>

          {navLayoutSuccess && (
            <p
              role="status"
              className="mt-3 text-sm text-green-700"
              data-testid="nav-layout-success"
            >
              {t('settings.navLayout.saveSuccess')}
            </p>
          )}
          {navLayoutError && (
            <p role="alert" className="mt-3 text-sm text-red-600" data-testid="nav-layout-error">
              {t('settings.navLayout.saveError')}
            </p>
          )}
        </div>

        {/* ── Email Notifications section (MINCRM-163) ─────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="email-notifications-section"
        >
          <h2
            className="text-lg font-semibold text-gray-900 mb-1"
            data-testid="email-notifications-section-title"
          >
            {t('settings.emailNotifications.sectionTitle')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            {t('settings.emailNotifications.sectionHint')}
          </p>

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
              {/* Recipient count */}
              <p className="text-sm text-gray-600" data-testid="email-notif-recipient-count">
                {recipientCountLoading
                  ? t('common.loading')
                  : t('settings.emailNotifications.recipientCount', {
                      count: recipientCountData?.count ?? 0,
                    })}
              </p>

              {/* Toggle */}
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
                <p
                  role="status"
                  className="text-sm text-green-700"
                  data-testid="email-notif-success"
                >
                  {t('settings.emailNotifications.saveSuccess')}
                </p>
              )}
              {emailNotifSaveError && (
                <p
                  role="alert"
                  className="text-sm text-red-600"
                  data-testid="email-notif-save-error"
                >
                  {t('settings.emailNotifications.saveError')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Demo Data section ─────────────────────────────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="demo-section"
        >
          <h2 className="text-lg font-semibold text-gray-900 mb-1" data-testid="demo-section-title">
            {t('settings.demo.sectionTitle')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('settings.demo.sectionHint')}</p>

          {/* Status badge */}
          {demoStatusLoading && (
            <p className="text-sm text-gray-500 mb-4" data-testid="demo-status-loading">
              {t('settings.demo.statusLoading')}
            </p>
          )}
          {demoStatusError && (
            <p role="alert" className="text-sm text-red-600 mb-4" data-testid="demo-status-error">
              {t('settings.demo.statusError')}
            </p>
          )}
          {!demoStatusLoading && !demoStatusError && (
            <p className="text-sm mb-4" data-testid="demo-status-badge">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  demoActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {demoActive ? t('settings.demo.statusActive') : t('settings.demo.statusInactive')}
              </span>
            </p>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              size="md"
              data-testid="demo-seed-button"
              disabled={isDemoMutating || demoActive}
              onClick={() => openConfirm('seed')}
            >
              {seedMutation.isPending ? t('common.loading') : t('settings.demo.seedButton')}
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="md"
              data-testid="demo-reset-button"
              disabled={isDemoMutating}
              onClick={() => openConfirm('reset')}
            >
              {resetMutation.isPending ? t('common.loading') : t('settings.demo.resetButton')}
            </Button>

            <Button
              type="button"
              variant="danger"
              size="md"
              data-testid="demo-remove-button"
              disabled={isDemoMutating || !demoActive}
              onClick={() => openConfirm('remove')}
            >
              {removeMutation.isPending ? t('common.loading') : t('settings.demo.removeButton')}
            </Button>
          </div>

          {/* Feedback message — tabIndex=-1 allows programmatic focus from useEffect */}
          {demoFeedback && (
            <p
              ref={feedbackRef}
              tabIndex={-1}
              role={demoFeedback.type === 'error' ? 'alert' : 'status'}
              className={`mt-4 text-sm ${demoFeedback.type === 'success' ? 'text-green-700' : 'text-red-600'}`}
              data-testid="demo-feedback"
            >
              {t(demoFeedback.key)}
            </p>
          )}
        </div>

        {/* ── File Storage section (MINCRM-169) ────────────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="storage-section"
        >
          <h2
            className="text-lg font-semibold text-gray-900 mb-1"
            data-testid="storage-section-title"
          >
            {t('settings.storage.sectionTitle')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('settings.storage.sectionHint')}</p>

          {storageLoading && (
            <p className="text-sm text-gray-500" data-testid="storage-loading">
              {t('common.loading')}
            </p>
          )}

          {storageError && (
            <p role="alert" className="text-sm text-red-600" data-testid="storage-load-error">
              {t('settings.loadError')}
            </p>
          )}

          {!storageLoading && !storageError && (
            <form onSubmit={handleStorageSave} className="space-y-4">
              <div>
                <label
                  htmlFor="storage-endpoint"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('settings.storage.endpointLabel')}
                </label>
                <input
                  id="storage-endpoint"
                  type="text"
                  data-testid="storage-endpoint-input"
                  placeholder="https://s3.example.com"
                  value={storageForm.endpoint}
                  onChange={(e) =>
                    setStorageForm((prev) => ({ ...prev, endpoint: e.target.value }))
                  }
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="storage-bucket"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('settings.storage.bucketLabel')}
                </label>
                <input
                  id="storage-bucket"
                  type="text"
                  data-testid="storage-bucket-input"
                  value={storageForm.bucket}
                  onChange={(e) => setStorageForm((prev) => ({ ...prev, bucket: e.target.value }))}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="storage-access-key-id"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('settings.storage.accessKeyIdLabel')}
                </label>
                <input
                  id="storage-access-key-id"
                  type="text"
                  data-testid="storage-access-key-id-input"
                  value={storageForm.accessKeyId}
                  onChange={(e) =>
                    setStorageForm((prev) => ({ ...prev, accessKeyId: e.target.value }))
                  }
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="storage-secret-access-key"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('settings.storage.secretAccessKeyLabel')}
                </label>
                {storageData?.configured && !storageForm.secretAccessKey && (
                  <p className="text-xs text-gray-400 mb-1" data-testid="storage-secret-masked">
                    {t('settings.storage.secretMasked')}
                  </p>
                )}
                <input
                  id="storage-secret-access-key"
                  type="password"
                  data-testid="storage-secret-access-key-input"
                  placeholder={
                    storageData?.configured ? t('settings.storage.secretPlaceholder') : ''
                  }
                  value={storageForm.secretAccessKey}
                  onChange={(e) =>
                    setStorageForm((prev) => ({ ...prev, secretAccessKey: e.target.value }))
                  }
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Test connection feedback */}
              {storageTestStatus === 'ok' && (
                <p role="status" className="text-sm text-green-700" data-testid="storage-test-ok">
                  {t('settings.storage.testSuccess')}
                </p>
              )}
              {storageTestStatus === 'fail' && (
                <p role="alert" className="text-sm text-red-600" data-testid="storage-test-fail">
                  {t('settings.storage.testFail')}
                </p>
              )}

              {storageSaveSuccess && (
                <p
                  role="status"
                  className="text-sm text-green-700"
                  data-testid="storage-save-success"
                >
                  {t('settings.storage.saveSuccess')}
                </p>
              )}
              {storageSaveError && (
                <p role="alert" className="text-sm text-red-600" data-testid="storage-save-error">
                  {t('settings.storage.saveError')}
                </p>
              )}

              <div className="flex flex-wrap gap-3 justify-end">
                {storageData?.configured && (
                  <Button
                    type="button"
                    variant="danger"
                    size="md"
                    data-testid="storage-clear-button"
                    disabled={storageClearMutation.isPending || storageSaveMutation.isPending}
                    onClick={() => storageClearMutation.mutate()}
                  >
                    {storageClearMutation.isPending
                      ? t('common.loading')
                      : t('settings.storage.clearButton')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  data-testid="storage-test-button"
                  disabled={
                    storageTestStatus === 'testing' ||
                    storageSaveMutation.isPending ||
                    !storageForm.endpoint ||
                    !storageForm.bucket ||
                    !storageForm.accessKeyId ||
                    !storageForm.secretAccessKey
                  }
                  onClick={() => void handleStorageTest()}
                >
                  {storageTestStatus === 'testing'
                    ? t('common.loading')
                    : t('settings.storage.testButton')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  data-testid="storage-save-button"
                  disabled={
                    storageSaveMutation.isPending ||
                    !storageForm.endpoint ||
                    !storageForm.bucket ||
                    !storageForm.accessKeyId ||
                    !storageForm.secretAccessKey
                  }
                >
                  {storageSaveMutation.isPending
                    ? t('settings.saving')
                    : t('settings.storage.saveButton')}
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* ── Import Data section ───────────────────────────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="import-section"
        >
          <h2
            className="text-lg font-semibold text-gray-900 mb-1"
            data-testid="import-section-title"
          >
            {t('settings.import.sectionTitle')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('settings.import.sectionHint')}</p>

          {/* Tabs */}
          <div
            className="flex border-b border-gray-200 mb-6"
            role="tablist"
            aria-label={t('settings.import.sectionTitle')}
          >
            {(['accounts', 'contacts', 'deals'] as ImportTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={importTab === tab}
                aria-controls={`import-panel-${tab}`}
                id={`import-tab-${tab}`}
                data-testid={`import-tab-${tab}`}
                onClick={() => {
                  if (importTab !== tab) setImportTab(tab);
                }}
                className={[
                  'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500',
                  importTab === tab
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                ].join(' ')}
              >
                {t(`settings.import.tab.${tab}`)}
              </button>
            ))}
          </div>

          {/* Tab panels */}
          {(['accounts', 'contacts', 'deals'] as ImportTab[]).map((tab) => (
            <div
              key={tab}
              role="tabpanel"
              id={`import-panel-${tab}`}
              aria-labelledby={`import-tab-${tab}`}
              hidden={importTab !== tab}
              data-testid={`import-panel-${tab}`}
            >
              {tab === 'accounts' && (
                <>
                  <p className="text-xs text-gray-500 mb-4">{t('settings.import.accounts.hint')}</p>
                  <CsvImporter
                    entity="accounts"
                    entityLabel={t('settings.import.tab.accounts')}
                    options={[
                      {
                        key: 'skip_duplicates',
                        label: t('settings.import.accounts.skipDuplicates'),
                        defaultValue: true,
                      },
                    ]}
                  />
                </>
              )}
              {tab === 'contacts' && (
                <>
                  <p className="text-xs text-gray-500 mb-4">{t('settings.import.contacts.hint')}</p>
                  <CsvImporter entity="contacts" entityLabel={t('settings.import.tab.contacts')} />
                </>
              )}
              {tab === 'deals' && (
                <>
                  <p className="text-xs text-gray-500 mb-4">{t('settings.import.deals.hint')}</p>
                  <CsvImporter
                    entity="deals"
                    entityLabel={t('settings.import.tab.deals')}
                    options={[
                      {
                        key: 'skip_unresolvable_accounts',
                        label: t('settings.import.deals.skipUnresolvableAccounts'),
                        defaultValue: false,
                      },
                    ]}
                  />
                </>
              )}
            </div>
          ))}
        </div>

        {/* ── Audit Log section (MINCRM-172) ───────────────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="audit-log-section"
        >
          <h2
            className="text-lg font-semibold text-gray-900 mb-1"
            data-testid="audit-log-section-title"
          >
            {t('auditLog.heading')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('auditLog.sectionHint')}</p>
          <Link
            to="/admin/audit-log"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline"
            data-testid="audit-log-link"
          >
            {t('auditLog.navLink')}
            <svg
              aria-hidden="true"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {/* ── Confirmation dialog ────────────────────────────────────────────── */}
        {pendingAction && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-confirm-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            data-testid="demo-confirm-dialog"
          >
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
              <h3
                id="demo-confirm-title"
                className="text-base font-semibold text-gray-900 mb-2"
                data-testid="demo-confirm-title"
              >
                {t(`settings.demo.${pendingAction}ConfirmTitle`)}
              </h3>
              <p className="text-sm text-gray-600 mb-6" data-testid="demo-confirm-message">
                {t(`settings.demo.${pendingAction}ConfirmMessage`)}
              </p>
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  data-testid="demo-confirm-cancel"
                  onClick={closeConfirm}
                >
                  {t('settings.demo.cancelAction')}
                </Button>
                <Button
                  type="button"
                  variant={pendingAction === 'seed' ? 'primary' : 'danger'}
                  size="md"
                  data-testid="demo-confirm-ok"
                  onClick={executeAction}
                >
                  {t('settings.demo.confirmAction')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
