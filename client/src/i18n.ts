/**
 * i18next configuration.
 * Loads translation resources for all supported locales and initializes the
 * i18next instance used throughout the React application via react-i18next.
 *
 * Language resolution order (highest precedence first):
 *  1. User's stored personal preference (from /api/auth/me, applied after auth resolves)
 *  2. System-wide default set by an admin (from /api/settings/default-language)
 *  3. English (hard-coded fallback)
 *
 * The user preference is fetched alongside the auth session, so it is applied
 * before the first meaningful render — no language flash.
 *
 * Supported languages: English (en), Mandarin Chinese Simplified (zh-Hans),
 *                      Spanish (es), French (fr), German (de)
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LOCALES } from '@shared/schemas/settingsSchema.js';

import en from './locales/en.json';
import zhHans from './locales/zh-Hans.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
// pseudo is not in SUPPORTED_LOCALES (so it stays off the server-validated language
// selector), but is registered here so E2E tests can call i18n.changeLanguage('pseudo')
// client-side without any API call. MINCRM-241
import pseudo from './locales/pseudo.json';

/** Translation resource map keyed by language code */
const resources = {
  en: { translation: en },
  'zh-Hans': { translation: zhHans },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  pseudo: { translation: pseudo },
};

i18n.use(initReactI18next).init({
  resources,
  /** Default language — fall back to English while the resolved language is being fetched */
  fallbackLng: 'en',
  lng: 'en',
  interpolation: {
    /** React already escapes values, so disable i18next's own escaping */
    escapeValue: false,
  },
});

/**
 * Applies the resolved language to the i18next instance if it is supported.
 * Called once on app load after the auth session is available.
 *
 * Priority:
 *  1. userPreference — stored on the user record (MINCRM-31)
 *  2. systemDefault  — fetched from /api/settings/default-language
 *  3. Stays on 'en' (the init default above)
 *
 * @param userPreference - The user's stored locale code, or null.
 */
export async function applyResolvedLanguage(userPreference: string | null): Promise<void> {
  if (userPreference && (SUPPORTED_LOCALES as readonly string[]).includes(userPreference)) {
    void i18n.changeLanguage(userPreference);
    return;
  }

  // Fall through to system default
  try {
    const response = await fetch('/api/v1/settings/default-language');
    const data = (await response.json()) as { language: string };
    if ((SUPPORTED_LOCALES as readonly string[]).includes(data.language)) {
      void i18n.changeLanguage(data.language);
    }
  } catch {
    // Network failure on app load — silently stay on fallback English
  }
}

/**
 * RTL locales supported by the application.
 * None of the current five locales are RTL, but this set is checked on every
 * language change so adding an RTL locale (e.g. 'ar', 'he') in the future
 * automatically flips the document direction without any additional work.
 */
const RTL_LOCALES = new Set<string>([]);

/**
 * Sets the document's text direction based on the active locale.
 * Called on init and whenever the language changes.
 *
 * @param locale - The active BCP 47 locale code
 */
function applyDocumentDirection(locale: string): void {
  document.documentElement.dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

// Set initial direction from the fallback locale
applyDocumentDirection(i18n.language);

// Keep direction in sync when the user switches languages at runtime
i18n.on('languageChanged', applyDocumentDirection);

export default i18n;
