/**
 * i18next configuration.
 * Loads translation resources for all supported locales and initializes the
 * i18next instance used throughout the React application via react-i18next.
 *
 * On initialization the system-wide default language is fetched from the API.
 * If the fetch succeeds and the user has not overridden the language via the
 * browser locale, the system default is applied as the active language.
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

/** Translation resource map keyed by language code */
const resources = {
  en: { translation: en },
  'zh-Hans': { translation: zhHans },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
};

/**
 * Maps a raw browser locale (from navigator.language) to a supported locale code.
 * Handles both full BCP 47 tags (e.g. "zh-CN", "zh-Hans-CN") and bare subtags.
 *
 * @param rawLocale - The raw locale string from navigator.language
 * @returns The matching supported locale, or undefined if none matches
 */
function resolveBrowserLocale(rawLocale: string): string | undefined {
  // Exact match first (e.g. "zh-Hans", "en", "fr")
  if ((SUPPORTED_LOCALES as readonly string[]).includes(rawLocale)) return rawLocale;
  // zh family: zh, zh-CN, zh-Hans-CN, zh-SG → zh-Hans
  if (rawLocale === 'zh' || rawLocale.startsWith('zh-')) return 'zh-Hans';
  // Bare language subtag match (e.g. "en-US" → "en", "fr-CA" → "fr")
  const bare = rawLocale.split('-')[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(bare) ? bare : undefined;
}

/** Resolved supported locale for the browser's configured language, or undefined */
const browserLocale = resolveBrowserLocale(navigator.language);

i18n.use(initReactI18next).init({
  resources,
  /** Default language — fall back to English when the detected locale is missing */
  fallbackLng: 'en',
  /** Start with the browser locale when it's supported; system default applied below otherwise */
  lng: browserLocale ?? 'en',
  interpolation: {
    /** React already escapes values, so disable i18next's own escaping */
    escapeValue: false,
  },
});

/**
 * Fetch the system-wide default language and apply it unless the browser
 * locale is already a supported language (meaning the user has an OS/browser
 * preference that should take precedence).
 *
 * NOTE: This fetch runs asynchronously after the first React render, which can
 * produce a brief flash of the fallback language before the system default is
 * applied. MINCRM-31 will introduce user-level language preferences stored
 * server-side; once that lands, the resolved language should be returned
 * alongside the auth session on the /api/auth/me response, eliminating the
 * flash entirely. Hook into this logic at the TODO below when implementing
 * MINCRM-31.
 */
if (!browserLocale) {
  // TODO MINCRM-31: before applying the system default, check whether the
  // authenticated user has a personal language preference and prefer that.
  fetch('/api/settings/default-language')
    .then((res) => res.json() as Promise<{ language: string }>)
    .then(({ language }) => {
      if ((SUPPORTED_LOCALES as readonly string[]).includes(language)) {
        void i18n.changeLanguage(language);
      }
    })
    .catch(() => {
      // Network failure on app load — silently stay on fallback English
    });
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

// Set initial direction from the resolved browser/fallback locale
applyDocumentDirection(i18n.language);

// Keep direction in sync when the user switches languages at runtime
i18n.on('languageChanged', applyDocumentDirection);

export default i18n;
