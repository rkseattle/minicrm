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

// jsdom does not implement ResizeObserver. Stub it so components that use it do not throw.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom does not implement ProgressEvent. The MSW XHR interceptor fires one
// when a mocked response completes, causing an unhandled rejection that fails
// the vitest run even when all test assertions pass. Stub it with the
// Event constructor so the interceptor can construct and dispatch it safely.
if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class ProgressEvent extends Event {
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;
    constructor(type: string, init?: ProgressEventInit) {
      super(type, init);
      this.lengthComputable = init?.lengthComputable ?? false;
      this.loaded = init?.loaded ?? 0;
      this.total = init?.total ?? 0;
    }
  } as unknown as typeof ProgressEvent;
}

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

// Safety net: a test that calls vi.useFakeTimers() and fails/throws before its own
// vi.useRealTimers() cleanup would otherwise leave fake timers installed for every
// subsequent test in the same worker process — including in other files, since
// vitest can schedule multiple test files onto one worker. waitFor() and other
// real-timer-based async utilities then hang indefinitely with no error, which is
// very hard to trace back to an unrelated file. Unconditionally restoring real
// timers after every test (a no-op when a test never used fake timers) closes
// that gap regardless of how the previous test exited. (MINCRM-473)
afterEach(() => vi.useRealTimers());
