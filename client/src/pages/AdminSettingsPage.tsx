/**
 * Admin Settings page.
 * Allows admins to configure system-wide settings.
 * Currently exposes the system default language selector.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import {
  getDefaultLanguage,
  setDefaultLanguage,
  DEFAULT_LANGUAGE_QUERY_KEY,
} from '@/api/settings.js';
import { SUPPORTED_LOCALES } from '@shared/schemas/settingsSchema.js';
import type { SupportedLocale } from '@shared/schemas/settingsSchema.js';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';

/**
 * Admin-only page for configuring system-wide settings.
 */
export default function AdminSettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: DEFAULT_LANGUAGE_QUERY_KEY,
    queryFn: getDefaultLanguage,
  });

  // pendingLanguage tracks user selection before saving; null means "use the server value"
  const [pendingLanguage, setPendingLanguage] = useState<SupportedLocale | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showError, setShowError] = useState(false);

  const selectedLanguage: SupportedLocale = pendingLanguage ?? data?.language ?? 'en';

  const mutation = useMutation({
    mutationFn: setDefaultLanguage,
    onSuccess: (savedLanguage) => {
      // Write the saved value into the cache before clearing pendingLanguage so
      // the select never reverts to a stale value while the background refetch runs.
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
    mutation.mutate(selectedLanguage);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-6 py-8">
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
                disabled={mutation.isPending}
              >
                {mutation.isPending ? t('settings.saving') : t('settings.saveButton')}
              </Button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
