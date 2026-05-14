/**
 * GeneralSettings — Language and Navigation Layout settings.
 * Extracted from AdminSettingsPage.tsx (MINCRM-259).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getDefaultLanguage,
  setDefaultLanguage,
  DEFAULT_LANGUAGE_QUERY_KEY,
} from '@/api/settings.js';
import { setOnboardingCompleted, ONBOARDING_STATUS_QUERY_KEY } from '@/api/onboarding.js';
import { SUPPORTED_LOCALES, NAV_LAYOUTS } from '@shared/schemas/settingsSchema.js';
import type { SupportedLocale, NavLayout } from '@shared/schemas/settingsSchema.js';
import { useNavLayout } from '@/components/NavLayoutContext.js';
import { useAuth } from '@/hooks/useAuth.js';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';

export default function GeneralSettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: DEFAULT_LANGUAGE_QUERY_KEY,
    queryFn: getDefaultLanguage,
  });

  const { layout: activeLayout, saveLayout } = useNavLayout();

  const [pendingLanguage, setPendingLanguage] = useState<SupportedLocale | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showError, setShowError] = useState(false);

  const [navLayoutSaving, setNavLayoutSaving] = useState(false);
  const [navLayoutSuccess, setNavLayoutSuccess] = useState(false);
  const [navLayoutError, setNavLayoutError] = useState(false);

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

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setShowSuccess(false);
    setShowError(false);
    languageMutation.mutate(selectedLanguage);
  }

  return (
    <>
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

      {/* Navigation Layout — desktop only (mobile always uses hamburger) */}
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
                'px-4 py-2 rounded-md border text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500',
                activeLayout === layoutOption
                  ? 'border-primary-600 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50',
                navLayoutSaving ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              {t(`settings.navLayout.${layoutOption}`)}
            </button>
          ))}
        </div>

        {navLayoutSuccess && (
          <p role="status" className="mt-3 text-sm text-green-700" data-testid="nav-layout-success">
            {t('settings.navLayout.saveSuccess')}
          </p>
        )}
        {navLayoutError && (
          <p role="alert" className="mt-3 text-sm text-red-600" data-testid="nav-layout-error">
            {t('settings.navLayout.saveError')}
          </p>
        )}
      </div>

      {/* Reset onboarding — admin only (MINCRM-256) */}
      {user?.role === 'admin' && (
        <div
          className="mt-8 bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
          data-testid="reset-onboarding-section"
        >
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            {t('settings.onboarding.resetTitle')}
          </h2>
          <p className="text-xs text-gray-500 mb-4">{t('settings.onboarding.resetHint')}</p>

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
            {t('settings.onboarding.resetButton')}
          </Button>

          {resetOnboardingSuccess && (
            <p
              role="status"
              className="mt-3 text-sm text-green-700"
              data-testid="reset-onboarding-success"
            >
              {t('settings.onboarding.resetSuccess')}
            </p>
          )}
          {resetOnboardingError && (
            <p
              role="alert"
              className="mt-3 text-sm text-red-600"
              data-testid="reset-onboarding-error"
            >
              {t('settings.onboarding.resetError')}
            </p>
          )}
        </div>
      )}
    </>
  );
}
