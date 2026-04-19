/**
 * Tests for PageFacade and createPageFacade (MINCRM-209).
 *
 * Verifies:
 * 1. Proxy routes heal method calls to the healPage object.
 * 2. Proxy routes navigation calls (goto, url) to the raw Page.
 * 3. Calling a forbidden Playwright method is a TypeScript compile error.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { HealingRegistry } from '../../framework/healing/healing-registry.js';
import { createPageFacade } from '../../framework/types/page-facade.js';
import type { PageFacade } from '../../framework/types/page-facade.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockLocator(resolves: boolean) {
  return {
    waitFor: () => (resolves ? Promise.resolve() : Promise.reject(new Error('Timeout'))),
    click: () => Promise.resolve(),
    fill: (_v: string) => Promise.resolve(),
    textContent: () => Promise.resolve('text'),
    getAttribute: (_n: string) => Promise.resolve('val'),
    count: () => Promise.resolve(1),
    selectOption: (_v: string) => Promise.resolve(['v']),
    check: () => Promise.resolve(),
    uncheck: () => Promise.resolve(),
    hover: () => Promise.resolve(),
  };
}

function mockPage(resolveMap: boolean[]): Page & { navigated: string[] } {
  let callIndex = 0;
  const factory = () => {
    const resolves = resolveMap[callIndex] ?? false;
    callIndex++;
    return mockLocator(resolves);
  };
  const navigated: string[] = [];
  return {
    getByTestId: factory,
    getByRole: factory,
    getByLabel: factory,
    getByText: factory,
    locator: factory,
    goto: (url: string) => {
      navigated.push(url);
      return Promise.resolve(null);
    },
    url: () => 'http://localhost/',
    navigated,
  } as unknown as Page & { navigated: string[] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('createPageFacade', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('heal method (click) is routed to healPage, not raw Page', async () => {
    const page = mockPage([true]);
    const facade = createPageFacade(page, 'proxy heal test');

    // If routed to healPage, click goes through HealingLocator and works.
    // If routed to Page.click (which is not defined on mock), it would throw.
    await expect(
      facade.click([{ type: 'testId', value: 'btn' }], { fallbackTimeout: 100 }),
    ).resolves.toBeUndefined();
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('navigation method (goto) is routed to the raw Page', async () => {
    const page = mockPage([]);
    const facade = createPageFacade(page, 'proxy navigation test');

    await facade.goto('http://localhost/test');

    expect(page.navigated).toContain('http://localhost/test');
  });

  test('url() on facade returns value from raw Page', () => {
    const page = mockPage([]);
    const facade = createPageFacade(page, 'proxy url test');

    expect(facade.url()).toBe('http://localhost/');
  });

  test('heal method routes heal event through HealingRegistry', async () => {
    // primary fails, fallback resolves — heal event should be recorded
    const page = mockPage([false, true]);
    const facade = createPageFacade(page, 'proxy heal event test');

    await facade.click(
      [
        { type: 'testId', value: 'btn' },
        { type: 'css', value: '.btn' },
      ],
      { fallbackTimeout: 100 },
    );

    expect(HealingRegistry.instance.count).toBe(1);
  });

  test('facade satisfies PageFacade type — can be assigned to PageFacade variable', () => {
    const page = mockPage([]);
    const facade: PageFacade = createPageFacade(page, 'type test');

    expect(facade).toBeDefined();
  });

  // TypeScript compile-error test: calling a forbidden Playwright method must be
  // a compile error. @ts-expect-error below asserts the error exists — TypeScript
  // will fail the build if the error stops occurring, which is the regression guard.
  test('forbidden Page method is not callable on PageFacade (compile-time guard)', () => {
    const page = mockPage([]);
    const facade: PageFacade = createPageFacade(page, 'forbidden method test');

    // @ts-expect-error — getByTestId is a ForbiddenPageMethod and must not be accessible
    void facade.getByTestId('something');
  });
});
