/**
 * Saves the signed-in user's language preference and applies it to the interface.
 *
 * Three controls drive this — the desktop header selector, its counterpart in the mobile
 * drawer, and the Profile Settings form — and each has to persist the choice, switch the
 * running interface, and put the old locale back if the request fails.
 */

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { setMyLanguage, MY_LANGUAGE_QUERY_KEY } from '@/api/users.js';
import { applyResolvedLanguage } from '@/i18n.js';
import type { SupportedLocale } from '@shared/schemas/settingsSchema.js';

export interface UseLanguagePreferenceResult {
  /** Persists the locale, or clears the personal preference when passed null. */
  save: (locale: SupportedLocale | null) => void;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  reset: () => void;
}

/**
 * @param options.optimistic - Apply the locale before the request resolves, reverting on
 *   failure. The header selector wants this; a form with an explicit Save button does not,
 *   because the interface should not change until the save succeeds.
 * @param options.onSaved - Runs after a successful save, for callers holding their own
 *   pending state. Clearing that state before the request settles discards the user's
 *   choice on failure and snaps the control back mid-flight.
 * @returns Handlers and status flags for the language mutation.
 */
export function useLanguagePreference(
  options: { optimistic?: boolean; onSaved?: () => void } = {},
): UseLanguagePreferenceResult {
  const { optimistic = false, onSaved } = options;
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const previousLocaleRef = useRef<string | null>(null);

  const mutation = useMutation({
    mutationFn: (locale: SupportedLocale | null) => setMyLanguage(locale),
    onSuccess: (saved) => {
      queryClient.setQueryData(MY_LANGUAGE_QUERY_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: MY_LANGUAGE_QUERY_KEY });
      previousLocaleRef.current = null;
      // Resolves null through the org default rather than leaving the old locale running.
      void applyResolvedLanguage(saved.language);
      onSaved?.();
    },
    onError: () => {
      if (previousLocaleRef.current) {
        void i18n.changeLanguage(previousLocaleRef.current);
        previousLocaleRef.current = null;
      }
    },
  });

  function save(locale: SupportedLocale | null): void {
    if (optimistic && locale) {
      previousLocaleRef.current = i18n.language;
      void i18n.changeLanguage(locale);
    }
    mutation.mutate(locale);
  }

  return {
    save,
    isPending: mutation.isPending,
    isError: mutation.isError,
    isSuccess: mutation.isSuccess,
    reset: mutation.reset,
  };
}
