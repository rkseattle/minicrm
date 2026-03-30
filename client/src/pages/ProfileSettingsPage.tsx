/**
 * Profile Settings page.
 * Available to all authenticated users.
 * Currently exposes the personal language preference selector.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import { getMyLanguage, setMyLanguage, MY_LANGUAGE_QUERY_KEY } from '@/api/users.js';
import { applyResolvedLanguage } from '@/i18n.js';
import { SUPPORTED_LOCALES } from '@shared/schemas/settingsSchema.js';
import type { SupportedLocale } from '@shared/schemas/settingsSchema.js';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';

/** Sentinel value used in the dropdown to represent "no personal preference set" */
const SYSTEM_DEFAULT_VALUE = '__system_default__';

/**
 * Profile settings page — lets users set a personal language preference
 * that overrides the system-wide default.
 */
export default function ProfileSettingsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: MY_LANGUAGE_QUERY_KEY,
    queryFn: getMyLanguage,
  });

  // pendingLanguage is the unsaved selection; null means "not changed yet"
  const [pendingLanguage, setPendingLanguage] = useState<
    SupportedLocale | null | typeof SYSTEM_DEFAULT_VALUE
  >(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // The effective value shown in the dropdown
  const currentServerValue = data?.language ?? null;
  const selectValue: string =
    pendingLanguage !== null
      ? (pendingLanguage ?? SYSTEM_DEFAULT_VALUE)
      : (currentServerValue ?? SYSTEM_DEFAULT_VALUE);

  const mutation = useMutation({
    mutationFn: (language: SupportedLocale | null) => setMyLanguage(language),
    onSuccess: (saved) => {
      queryClient.setQueryData(MY_LANGUAGE_QUERY_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: MY_LANGUAGE_QUERY_KEY });
      setPendingLanguage(null);
      setSuccessMessage(t('profileSettings.saveSuccess'));
      setErrorMessage(null);
      // Apply immediately — no page reload required.
      // When clearing (null), fetch and apply the system default.
      if (saved.language) {
        void i18n.changeLanguage(saved.language);
      } else {
        void applyResolvedLanguage(null);
      }
    },
    onError: () => {
      setErrorMessage(t('profileSettings.saveError'));
      setSuccessMessage(null);
    },
  });

  /**
   * Handles dropdown change — tracks the pending value locally.
   *
   * @param value - The newly selected dropdown value.
   */
  function handleSelectChange(value: string): void {
    if (value === SYSTEM_DEFAULT_VALUE) {
      setPendingLanguage(SYSTEM_DEFAULT_VALUE as typeof SYSTEM_DEFAULT_VALUE);
    } else {
      setPendingLanguage(value as SupportedLocale);
    }
  }

  /**
   * Handles form submission.
   *
   * @param e - The form submit event.
   */
  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setSuccessMessage(null);
    setErrorMessage(null);

    const languageToSave =
      selectValue === SYSTEM_DEFAULT_VALUE ? null : (selectValue as SupportedLocale);
    mutation.mutate(languageToSave);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <h1
          className="text-2xl font-bold text-gray-900 mb-6"
          data-testid="profile-settings-heading"
        >
          {t('profileSettings.pageTitle')}
        </h1>

        {isLoading && (
          <p className="text-sm text-gray-500" data-testid="profile-settings-loading">
            {t('profileSettings.loading')}
          </p>
        )}

        {isError && (
          <p
            role="alert"
            className="text-sm text-red-600"
            data-testid="profile-settings-load-error"
          >
            {t('profileSettings.loadError')}
          </p>
        )}

        {!isLoading && !isError && (
          <form
            onSubmit={handleSubmit}
            className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 space-y-6 max-w-2xl"
          >
            <div>
              <label
                htmlFor="preferred-language"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('profileSettings.languageLabel')}
              </label>
              <p className="text-xs text-gray-500 mb-3">{t('profileSettings.languageHint')}</p>
              <Select
                id="preferred-language"
                data-testid="preferred-language-select"
                value={selectValue}
                onChange={(e) => handleSelectChange(e.target.value)}
              >
                <option value={SYSTEM_DEFAULT_VALUE}>{t('profileSettings.systemDefault')}</option>
                {SUPPORTED_LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {t(`settings.languages.${locale}`)}
                  </option>
                ))}
              </Select>
            </div>

            {successMessage && (
              <p
                role="status"
                className="text-sm text-green-700"
                data-testid="profile-settings-success"
              >
                {successMessage}
              </p>
            )}

            {errorMessage && (
              <p role="alert" className="text-sm text-red-600" data-testid="profile-settings-error">
                {errorMessage}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="md"
                data-testid="profile-settings-save"
                disabled={mutation.isPending}
              >
                {mutation.isPending ? t('profileSettings.saving') : t('profileSettings.saveButton')}
              </Button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
