/**
 * Vitest global test setup.
 * - Extends expect with @testing-library/jest-dom matchers
 * - Initializes i18next with English translations
 * - Starts the MSW server before all tests and resets/closes around each test
 */

import '@testing-library/jest-dom';
import { setupServer } from 'msw/node';
import { beforeAll, afterEach, afterAll, vi } from 'vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import { handlers } from './msw/handlers.js';

// jsdom does not implement window.matchMedia. Default to desktop (>= 768 px) so
// components that use useBreakpoint() render their desktop subtree in tests,
// keeping all existing test assertions valid. Individual tests that need to
// exercise the mobile layout can override this mock locally. (MINCRM-238)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query === '(min-width: 768px)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Initialize i18next once for the entire test run with English and French translations
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    interpolation: { escapeValue: false },
  });
}

/** MSW server — exported so individual tests can call server.use() to override handlers */
export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
