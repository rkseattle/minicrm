/**
 * Vitest global test setup. Adapted from minicrm-client's own
 * src/test/setup.ts (no shared code; no i18n here — this app is
 * English-only, see coverage-dashboard's own docs).
 */

import '@testing-library/jest-dom';
import { setupServer } from 'msw/node';
import { beforeAll, afterEach, afterAll, vi } from 'vitest';
import { handlers } from './msw/handlers.js';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoViewStub() {};
}

// jsdom does not implement ProgressEvent. The MSW XHR interceptor fires one
// when a mocked response completes, causing an unhandled rejection that
// fails the vitest run even when all test assertions pass.
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

export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

afterEach(() => vi.useRealTimers());
