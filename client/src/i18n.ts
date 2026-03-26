/**
 * i18next configuration.
 * Loads translation resources for all supported locales and initializes the
 * i18next instance used throughout the React application via react-i18next.
 *
 * Supported languages: English (en), Mandarin Chinese (zh), Spanish (es),
 *                      French (fr), German (de)
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

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

i18n.use(initReactI18next).init({
  resources,
  /** Default language — fall back to English when the detected locale is missing */
  fallbackLng: 'en',
  /** Detect language from the browser */
  lng: navigator.language.split('-')[0],
  interpolation: {
    /** React already escapes values, so disable i18next's own escaping */
    escapeValue: false,
  },
});

export default i18n;
