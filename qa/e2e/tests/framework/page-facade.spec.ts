/**
 * Tests for PageFacade and createPageFacade (MINCRM-209, MINCRM-235).
 *
 * Verifies:
 * 1. Proxy routes heal method calls to the healPage object.
 * 2. Proxy routes navigation calls (goto, url) to the raw Page.
 * 3. Calling a forbidden Playwright method is a TypeScript compile error.
 * 4. newTab() returns a PageFacade registered under the same testName.
 * 5. context() returns SafeContext — newPage() and newCDPSession() are blocked.
 */

import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { HealingRegistry } from '../../framework/healing/healing-registry.js';
import { createPageFacade } from '../../framework/types/page-facade.js';
import type { PageFacade } from '../../framework/types/page-facade.js';
import type { SafeContext } from '../../framework/types/safe-context.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockLocator(resolves: boolean) {
  const loc = {
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
  // probeLocator calls locator.first() before waitFor — return self.
  (loc as Record<string, unknown>)['first'] = () => loc;
  return loc;
}

function mockPage(
  resolveMap: boolean[],
  opts: { newPageResult?: Page } = {},
): Page & { navigated: string[] } {
  let callIndex = 0;
  const factory = () => {
    const resolves = resolveMap[callIndex] ?? false;
    callIndex++;
    return mockLocator(resolves);
  };
  const navigated: string[] = [];
  const ctx: Partial<BrowserContext> = {
    newPage: opts.newPageResult
      ? () => Promise.resolve(opts.newPageResult as Page)
      : () => Promise.resolve(mockPage([], {}) as unknown as Page),
    newCDPSession: undefined,
  };
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
    context: () => ctx as BrowserContext,
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

  // MINCRM-236: SafePage uses a Pick allowlist. A Playwright method not in
  // AllowedPageMethods is automatically blocked — verified here by asserting
  // that locator(), addScriptTag(), and getByLabel() (valid Page methods but
  // not in the allowlist) are compile errors on SafePage / PageFacade.
  test('SafePage positive-Pick blocks unlisted Playwright methods (MINCRM-236 regression guard)', () => {
    const page = mockPage([]);
    const facade: PageFacade = createPageFacade(page, 'pick allowlist test');

    // Never-executed block — type-checked but not called at runtime. MINCRM-236
    if (false as boolean) {
      // @ts-expect-error — locator() is not in AllowedPageMethods (MINCRM-236)
      void facade.locator('.foo');

      // @ts-expect-error — addScriptTag() is not in AllowedPageMethods (MINCRM-236)
      void facade.addScriptTag({ content: '' });

      // @ts-expect-error — getByLabel() is not in AllowedPageMethods (MINCRM-236)
      void facade.getByLabel('Email');
    }

    expect(facade).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// MINCRM-235: newTab() and SafeContext
// ---------------------------------------------------------------------------

test.describe('createPageFacade — newTab() and SafeContext', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('newTab() returns a PageFacade with heal methods', async () => {
    const page = mockPage([]);
    const facade = createPageFacade(page, 'newTab test');

    const tab = await facade.newTab();

    // A PageFacade has locate(), click(), fill(), etc.
    expect(typeof tab.locate).toBe('function');
    expect(typeof tab.click).toBe('function');
    expect(typeof tab.goto).toBe('function');
  });

  test('newTab() registers heal events under the same testName as the parent', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');

    process.env['PW_WORKER_INDEX'] = '77';

    // The new tab page mock: primary fails, fallback resolves — this triggers a heal event.
    const newTabPage = mockPage([false, true]);
    const page = mockPage([], { newPageResult: newTabPage as unknown as Page });

    const capturedTestName = 'newTab-testname-capture';
    const facade = createPageFacade(page, capturedTestName);

    const tab = await facade.newTab();

    // Trigger a heal event on the new tab (primary fails → fallback → heal recorded).
    await tab.click(
      [
        { type: 'testId', value: 'btn' },
        { type: 'css', value: '.btn' },
      ],
      { fallbackTimeout: 100 },
    );

    expect(HealingRegistry.instance.count).toBe(1);

    // Flush and verify the event carries the parent testName.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'newtab-hl-test-'));
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      HealingRegistry.instance.flush();
    } finally {
      process.chdir(originalCwd);
    }

    const contents = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'test-results', 'healing-77.json'), 'utf-8'),
    ) as { events: Array<{ testName: string }> };

    expect(contents.events[0]?.testName).toBe(capturedTestName);

    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env['PW_WORKER_INDEX'];
  });

  test('context() returns SafeContext — does not expose newPage or newCDPSession', () => {
    const page = mockPage([]);
    const facade: PageFacade = createPageFacade(page, 'SafeContext type test');

    const ctx: SafeContext = facade.context();
    expect(ctx).toBeDefined();

    // Never-executed block — type-checked but not called at runtime. MINCRM-235
    if (false as boolean) {
      // @ts-expect-error — newPage() is omitted from SafeContext (MINCRM-235)
      void ctx.newPage();

      // @ts-expect-error — newCDPSession() is omitted from SafeContext (MINCRM-235)
      void ctx.newCDPSession({} as unknown as Page);
    }
  });

  test('context().newPage() is a TypeScript compile error on PageFacade (regression guard)', () => {
    const page = mockPage([]);
    const facade: PageFacade = createPageFacade(page, 'context newPage guard');

    // Never-executed block — type-checked but not called at runtime. MINCRM-235
    if (false as boolean) {
      // @ts-expect-error — context() returns SafeContext which omits newPage() (MINCRM-235)
      void facade.context().newPage();
    }
  });
});
