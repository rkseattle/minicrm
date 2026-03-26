/**
 * Vitest global test setup.
 * - Extends expect with @testing-library/jest-dom matchers
 * - Initializes i18next with English translations
 * - Starts the MSW server before all tests and resets/closes around each test
 */

import '@testing-library/jest-dom';
import { setupServer } from 'msw/node';
import { beforeAll, afterEach, afterAll } from 'vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import { handlers } from './msw/handlers.js';

// Initialize i18next once for the entire test run with English translations
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
}

/** MSW server — exported so individual tests can call server.use() to override handlers */
export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
