/**
 * ProfilePage component.
 * Allows authenticated users to manage their personal preferences:
 *   - Preferred language
 *   - Navigation layout
 *   - Email notification preferences
 *   - Two-factor authentication
 *
 * Accessible at /profile for all authenticated users.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';
import {
  getMyLanguage,
  MY_LANGUAGE_QUERY_KEY,
  getMyNavLayout,
  MY_NAV_LAYOUT_QUERY_KEY,
} from '@/api/users.js';
import {
  getMyNotificationPrefs,
  updateMyNotificationPrefs,
  MY_NOTIFICATION_PREFS_QUERY_KEY,
} from '@/api/users.js';
import type { NotificationPrefs } from '@/api/users.js';
import { NAV_LAYOUTS, SUPPORTED_LOCALES } from '@shared/schemas/settingsSchema.js';
import type { NavLayout, SupportedLocale } from '@shared/schemas/settingsSchema.js';
import { useLanguagePreference } from '@/hooks/useLanguagePreference.js';
import { useNavLayoutPreference } from '@/hooks/useNavLayoutPreference.js';
import { getMfaStatus, MFA_STATUS_QUERY_KEY } from '@/api/mfa.js';
import MfaSetupModal from '@/components/MfaSetupModal.js';
import MfaRecoveryCodesModal from '@/components/MfaRecoveryCodesModal.js';
import MfaDisableModal from '@/components/MfaDisableModal.js';
import ConnectedAccountsPanel from '@/components/ConnectedAccountsPanel.js';

/**
 * Profile settings page — language, navigation layout, email notification toggles, and MFA.
 */
export default function ProfilePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  // True when the user was redirected here because org-wide MFA is required.
  const mfaSetupRequired = searchParams.get('mfa_setup_required') === '1';

  // ── MFA section state ────────────────────────────────────────────────────────
  const [mfaSetupOpen, setMfaSetupOpen] = useState(false);
  const [mfaRecoveryOpen, setMfaRecoveryOpen] = useState(false);
  const [mfaDisableOpen, setMfaDisableOpen] = useState(false);
  const [recoveryCodesOnce, setRecoveryCodesOnce] = useState<string[]>([]);

  const {
    data: mfaData,
    isLoading: mfaLoading,
    isError: mfaError,
  } = useQuery({
    queryKey: MFA_STATUS_QUERY_KEY,
    queryFn: getMfaStatus,
  });

  // ── Language preference ──────────────────────────────────────────────────────

  const {
    data: langData,
    isLoading: langLoading,
    isError: langError,
  } = useQuery({
    queryKey: MY_LANGUAGE_QUERY_KEY,
    queryFn: getMyLanguage,
  });

  // '' is "Use system default"; null is "nothing picked this visit".
  const [pendingLanguage, setPendingLanguage] = useState<SupportedLocale | '' | null>(null);
  // A saved null preference must keep showing "Use system default" rather than falling
  // through to the concrete default, or the control contradicts what was just stored.
  // '' while loading too: showing English before the real value arrives makes the
  // control briefly claim a preference the user may not have.
  const savedLanguage: SupportedLocale | '' = langData ? (langData.language ?? '') : '';
  const selectedLanguage: SupportedLocale | '' = pendingLanguage ?? savedLanguage;

  // Not optimistic: this form has an explicit Save button, so the interface should not
  // switch until the save lands.
  const languagePreference = useLanguagePreference({
    onSaved: () => setPendingLanguage(null),
  });

  // ── Navigation layout preference ─────────────────────────────────────────────

  const {
    data: navLayoutData,
    isLoading: navLayoutLoading,
    isError: navLayoutError,
  } = useQuery({
    queryKey: MY_NAV_LAYOUT_QUERY_KEY,
    queryFn: getMyNavLayout,
  });

  // '' is "Use workspace default"; null is "nothing picked this visit".
  const [pendingNavLayout, setPendingNavLayout] = useState<NavLayout | '' | null>(null);
  const savedNavLayout: NavLayout | '' = navLayoutData ? (navLayoutData.layout ?? '') : '';
  const selectedNavLayout: NavLayout | '' = pendingNavLayout ?? savedNavLayout;

  const navLayoutPreference = useNavLayoutPreference({
    onSaved: () => setPendingNavLayout(null),
  });

  function handleNavLayoutSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    navLayoutPreference.reset();
    // The empty option means "no personal preference", which the API takes as null.
    navLayoutPreference.save(selectedNavLayout === '' ? null : selectedNavLayout);
  }

  /**
   * Handles language form submission.
   *
   * @param e - Form submit event.
   */
  function handleLangSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    languagePreference.reset();
    // The empty option is "no personal preference", which the API takes as null — an
    // empty string fails schema validation and surfaces as a save error.
    languagePreference.save(selectedLanguage === '' ? null : selectedLanguage);
  }

  // ── Notification preferences ─────────────────────────────────────────────────

  const {
    data: prefsData,
    isLoading: prefsLoading,
    isError: prefsError,
  } = useQuery({
    queryKey: MY_NOTIFICATION_PREFS_QUERY_KEY,
    queryFn: getMyNotificationPrefs,
  });

  // Track per-key overrides the user has made before saving; null means "use server value"
  const [prefsOverrides, setPrefsOverrides] = useState<Partial<NotificationPrefs>>({});

  const serverPrefs: NotificationPrefs = prefsData?.preferences ?? {
    notify_overdue_tasks: true,
    notify_assignments: true,
    notify_deal_stage_changes: true,
  };

  // Displayed prefs merge server values with any unsaved local overrides
  const prefs: NotificationPrefs = { ...serverPrefs, ...prefsOverrides };

  const [prefsSuccess, setPrefsSuccess] = useState(false);
  const [prefsSaveError, setPrefsSaveError] = useState(false);

  const prefsMutation = useMutation({
    mutationFn: updateMyNotificationPrefs,
    onSuccess: (saved) => {
      queryClient.setQueryData(MY_NOTIFICATION_PREFS_QUERY_KEY, saved);
      setPrefsOverrides({});
      setPrefsSuccess(true);
      setPrefsSaveError(false);
    },
    onError: () => {
      setPrefsSaveError(true);
      setPrefsSuccess(false);
    },
  });

  /**
   * Handles notification preferences form submission.
   *
   * @param e - Form submit event.
   */
  function handlePrefsSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setPrefsSuccess(false);
    setPrefsSaveError(false);
    prefsMutation.mutate(prefs);
  }

  /**
   * Toggles a single notification preference flag.
   *
   * @param key - The preference key to toggle.
   */
  function togglePref(key: keyof NotificationPrefs): void {
    setPrefsOverrides((prev) => {
      const current = prev[key] !== undefined ? prev[key] : serverPrefs[key];
      return { ...prev, [key]: !current };
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6" data-testid="profile-heading">
          {t('profileSettings.pageTitle')}
        </h1>

        {/* ── Language preference section ──────────────────────────────────── */}
        {langLoading && (
          <p className="text-sm text-gray-500" data-testid="profile-lang-loading">
            {t('profileSettings.loading')}
          </p>
        )}

        {langError && (
          <p role="alert" className="text-sm text-red-600" data-testid="profile-lang-error">
            {t('profileSettings.loadError')}
          </p>
        )}

        {!langLoading && !langError && (
          <form
            onSubmit={handleLangSubmit}
            className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 space-y-4 max-w-2xl"
            data-testid="profile-lang-section"
          >
            <div>
              <label
                htmlFor="profile-language"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('profileSettings.languageLabel')}
              </label>
              <p className="text-xs text-gray-500 mb-3">{t('profileSettings.languageHint')}</p>
              <Select
                id="profile-language"
                data-testid="profile-language-select"
                value={selectedLanguage}
                onChange={(e) => setPendingLanguage(e.target.value as SupportedLocale | '')}
              >
                <option value="">{t('profileSettings.systemDefault')}</option>
                {SUPPORTED_LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {t(`settings.languages.${locale}`)}
                  </option>
                ))}
              </Select>
            </div>

            {languagePreference.isSuccess && (
              <p
                role="status"
                className="text-sm text-green-700"
                data-testid="profile-lang-success"
              >
                {t('profileSettings.saveSuccess')}
              </p>
            )}

            {languagePreference.isError && (
              <p
                role="alert"
                className="text-sm text-red-600"
                data-testid="profile-lang-save-error"
              >
                {t('profileSettings.saveError')}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="md"
                data-testid="profile-lang-save"
                disabled={languagePreference.isPending}
              >
                {languagePreference.isPending
                  ? t('profileSettings.saving')
                  : t('profileSettings.saveButton')}
              </Button>
            </div>
          </form>
        )}

        {/* ── Navigation layout section ────────────────────────────────────── */}
        {navLayoutLoading && (
          <p className="text-sm text-gray-500" data-testid="profile-navlayout-loading">
            {t('profileSettings.loading')}
          </p>
        )}

        {navLayoutError && (
          <p role="alert" className="text-sm text-red-600" data-testid="profile-navlayout-error">
            {t('profileSettings.loadError')}
          </p>
        )}

        {!navLayoutLoading && !navLayoutError && (
          <form
            onSubmit={handleNavLayoutSubmit}
            className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 space-y-4 max-w-2xl"
            data-testid="profile-navlayout-section"
          >
            <div>
              <label
                htmlFor="profile-navlayout"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('profileSettings.navLayoutLabel')}
              </label>
              <p className="text-xs text-gray-500 mb-3">{t('profileSettings.navLayoutHint')}</p>
              <Select
                id="profile-navlayout"
                data-testid="profile-navlayout-select"
                value={selectedNavLayout}
                onChange={(e) => setPendingNavLayout(e.target.value as NavLayout | '')}
              >
                <option value="">{t('profileSettings.workspaceDefault')}</option>
                {NAV_LAYOUTS.map((layoutOption) => (
                  <option key={layoutOption} value={layoutOption}>
                    {t(`settings.navLayout.${layoutOption}`)}
                  </option>
                ))}
              </Select>
            </div>

            {navLayoutPreference.isSuccess && (
              <p
                role="status"
                className="text-sm text-green-700"
                data-testid="profile-navlayout-success"
              >
                {t('profileSettings.saveSuccess')}
              </p>
            )}

            {navLayoutPreference.isError && (
              <p
                role="alert"
                className="text-sm text-red-600"
                data-testid="profile-navlayout-save-error"
              >
                {t('profileSettings.saveError')}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="md"
                data-testid="profile-navlayout-save"
                disabled={navLayoutPreference.isPending}
              >
                {navLayoutPreference.isPending
                  ? t('profileSettings.saving')
                  : t('profileSettings.saveButton')}
              </Button>
            </div>
          </form>
        )}

        {/* ── Email notifications section ──────────────────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="profile-notifications-section"
        >
          <h2
            className="text-lg font-semibold text-gray-900 mb-1"
            data-testid="profile-notifications-title"
          >
            {t('profileSettings.notifications.sectionTitle')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            {t('profileSettings.notifications.sectionHint')}
          </p>

          {prefsLoading && (
            <p className="text-sm text-gray-500" data-testid="profile-prefs-loading">
              {t('profileSettings.loading')}
            </p>
          )}

          {prefsError && (
            <p role="alert" className="text-sm text-red-600" data-testid="profile-prefs-error">
              {t('profileSettings.loadError')}
            </p>
          )}

          {!prefsLoading && !prefsError && (
            <form onSubmit={handlePrefsSubmit} className="space-y-4">
              <fieldset>
                <legend className="sr-only">
                  {t('profileSettings.notifications.sectionTitle')}
                </legend>

                {(
                  [
                    ['notify_overdue_tasks', 'profileSettings.notifications.overdueTasks'],
                    ['notify_assignments', 'profileSettings.notifications.assignments'],
                    ['notify_deal_stage_changes', 'profileSettings.notifications.dealStageChanges'],
                  ] as [keyof NotificationPrefs, string][]
                ).map(([key, labelKey]) => (
                  <label
                    key={key}
                    className="flex items-center gap-3 cursor-pointer"
                    data-testid={`notif-toggle-${key}`}
                  >
                    <input
                      type="checkbox"
                      checked={prefs[key]}
                      onChange={() => togglePref(key)}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      data-testid={`notif-checkbox-${key}`}
                    />
                    <span className="text-sm text-gray-700">{t(labelKey)}</span>
                  </label>
                ))}
              </fieldset>

              {prefsSuccess && (
                <p
                  role="status"
                  className="text-sm text-green-700"
                  data-testid="profile-prefs-success"
                >
                  {t('profileSettings.saveSuccess')}
                </p>
              )}

              {prefsSaveError && (
                <p
                  role="alert"
                  className="text-sm text-red-600"
                  data-testid="profile-prefs-save-error"
                >
                  {t('profileSettings.saveError')}
                </p>
              )}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  data-testid="profile-prefs-save"
                  disabled={prefsMutation.isPending}
                >
                  {prefsMutation.isPending
                    ? t('profileSettings.saving')
                    : t('profileSettings.saveButton')}
                </Button>
              </div>
            </form>
          )}
        </div>
        {/* ── Two-factor authentication section ───────────────────────────── */}
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="profile-mfa-section"
        >
          <h2 className="text-lg font-semibold text-gray-900 mb-1" data-testid="profile-mfa-title">
            {t('mfa.sectionTitle')}
          </h2>
          {mfaSetupRequired && (
            <div
              role="alert"
              data-testid="profile-mfa-required-banner"
              className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800"
            >
              {t('mfa.setupRequired.banner')}
            </div>
          )}
          <p className="text-xs text-gray-500 mb-4">{t('mfa.sectionHint')}</p>

          {mfaLoading && (
            <p className="text-sm text-gray-500" data-testid="profile-mfa-loading">
              {t('profileSettings.loading')}
            </p>
          )}

          {mfaError && (
            <p role="alert" className="text-sm text-red-600" data-testid="profile-mfa-error">
              {t('profileSettings.loadError')}
            </p>
          )}

          {!mfaLoading && !mfaError && mfaData && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    mfaData.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                  }`}
                  data-testid="profile-mfa-status-badge"
                >
                  {mfaData.enabled ? t('mfa.statusEnabled') : t('mfa.statusDisabled')}
                </span>
                {mfaData.enabled && (
                  <span className="text-xs text-gray-500" data-testid="profile-mfa-recovery-count">
                    {t('mfa.recoveryCodesRemaining', { count: mfaData.recoveryCodesRemaining })}
                  </span>
                )}
              </div>

              {!mfaData.enabled && (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => setMfaSetupOpen(true)}
                  data-testid="profile-mfa-enable-button"
                >
                  {t('mfa.enableButton')}
                </Button>
              )}

              {mfaData.enabled && (
                <Button
                  type="button"
                  variant="danger"
                  size="md"
                  onClick={() => setMfaDisableOpen(true)}
                  data-testid="profile-mfa-disable-button"
                >
                  {t('mfa.disableButton')}
                </Button>
              )}
            </div>
          )}
        </div>

        <ConnectedAccountsPanel />
      </main>

      <MfaSetupModal
        isOpen={mfaSetupOpen}
        onSuccess={(codes) => {
          setMfaSetupOpen(false);
          setRecoveryCodesOnce(codes);
          setMfaRecoveryOpen(true);
          void queryClient.invalidateQueries({ queryKey: MFA_STATUS_QUERY_KEY });
        }}
        onCancel={() => setMfaSetupOpen(false)}
      />

      <MfaRecoveryCodesModal
        isOpen={mfaRecoveryOpen}
        recoveryCodes={recoveryCodesOnce}
        onDone={() => setMfaRecoveryOpen(false)}
      />

      <MfaDisableModal
        isOpen={mfaDisableOpen}
        onSuccess={() => {
          setMfaDisableOpen(false);
          void queryClient.invalidateQueries({ queryKey: MFA_STATUS_QUERY_KEY });
        }}
        onCancel={() => setMfaDisableOpen(false)}
      />
    </div>
  );
}
