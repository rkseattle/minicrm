/**
 * i18next configuration.
 * Loads translation resources for all supported locales and initializes the
 * i18next instance used throughout the React application via react-i18next.
 *
 * On initialization the system-wide default language is fetched from the API.
 * If the fetch succeeds and the user has not overridden the language via the
 * browser locale, the system default is applied as the active language.
 *
 * Supported languages: English (en), Mandarin Chinese (zh), Spanish (es),
 *                      French (fr), German (de)
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LOCALES } from '@shared/schemas/settingsSchema.js';

import en from './locales/en.json';
import zh from './locales/zh.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';

/** Translation resource map keyed by language code */
const resources = {
  en: { translation: en },
  zh: { translation: zh },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
};

/** Browser locale (e.g. "en" from "en-US") */
const browserLocale = navigator.language.split('-')[0];

i18n.use(initReactI18next).init({
  resources,
  /** Default language — fall back to English when the detected locale is missing */
  fallbackLng: 'en',
  /** Start with the browser locale; may be updated below by the system default */
  lng: browserLocale,
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
const browserLocaleIsSupported = (SUPPORTED_LOCALES as readonly string[]).includes(browserLocale);

if (!browserLocaleIsSupported) {
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

export default i18n;
