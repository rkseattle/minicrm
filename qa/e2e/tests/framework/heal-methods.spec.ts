/**
 * Tests for the new HealMethods added in MINCRM-209:
 * waitFor, textContent, getAttribute, count, selectOption, check, uncheck, hover.
 *
 * Also verifies that doesNotExist and isNotVisible do NOT trigger healing
 * when the primary strategy fails.
 *
 * All locator interactions use mock Page objects — no browser required.
 *
 * MINCRM-209
 */

import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { HealingRegistry } from '../../framework/healing/healing-registry.js';
import { buildHealPage } from '../../framework/fixtures/heal-methods.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type MockLocator = Locator & {
  _resolves: boolean;
  waitFor: (opts?: { state?: string; timeout?: number }) => Promise<void>;
  textContent: () => Promise<string | null>;
  getAttribute: (name: string) => Promise<string | null>;
  count: () => Promise<number>;
  selectOption: (value: string) => Promise<string[]>;
  check: () => Promise<void>;
  uncheck: () => Promise<void>;
  hover: () => Promise<void>;
  click: () => Promise<void>;
  fill: (value: string) => Promise<void>;
};

function mockLocator(resolves: boolean): MockLocator {
  const loc = {
    _resolves: resolves,
    waitFor: (_opts?: { state?: string; timeout?: number }) =>
      resolves ? Promise.resolve() : Promise.reject(new Error('Timeout')),
    textContent: () => Promise.resolve(resolves ? 'hello' : null),
    getAttribute: (_name: string) => Promise.resolve(resolves ? 'attr-value' : null),
    count: () => Promise.resolve(resolves ? 3 : 0),
    selectOption: (_value: string) => Promise.resolve(['selected']),
    check: () => Promise.resolve(),
    uncheck: () => Promise.resolve(),
    hover: () => Promise.resolve(),
    click: () => Promise.resolve(),
    fill: (_value: string) => Promise.resolve(),
  } as unknown as MockLocator;
  // probeLocator calls locator.first() before waitFor — return self.
  (loc as unknown as Record<string, unknown>)['first'] = () => loc;
  return loc;
}

function mockPage(resolveMap: boolean[]): Page {
  let callIndex = 0;
  const factory = () => {
    const resolves = resolveMap[callIndex] ?? false;
    callIndex++;
    return mockLocator(resolves);
  };
  return {
    getByTestId: factory,
    getByRole: factory,
    getByLabel: factory,
    getByText: factory,
    locator: factory,
  } as unknown as Page;
}

// ---------------------------------------------------------------------------
// locate() returns BoundHealingLocator
// ---------------------------------------------------------------------------

test.describe('healPage.locate()', () => {
  test('returns a BoundHealingLocator (has resolve() with no parameters)', () => {
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'locate test');

    const bound = hp.locate([{ type: 'testId', value: 'btn' }]);

    // BoundHealingLocator exposes resolve() and waitFor()
    expect(typeof bound.resolve).toBe('function');
    expect(typeof bound.waitFor).toBe('function');
  });

  test('resolve() on BoundHealingLocator works without passing testName', async () => {
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'locate resolve test');

    const bound = hp.locate([{ type: 'testId', value: 'btn' }], { fallbackTimeout: 100 });
    const locator = await bound.resolve();

    expect(locator).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// waitFor — heals correctly; does NOT heal on negative assertions
// ---------------------------------------------------------------------------

test.describe('healPage.waitFor()', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('primary resolves — no heal event', async () => {
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'waitFor primary resolves');

    await hp.waitFor([{ type: 'testId', value: 'el' }], 'visible', { fallbackTimeout: 100 });

    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('primary fails, fallback resolves — heal event recorded', async () => {
    const page = mockPage([false, true]);
    const hp = buildHealPage(page, 'waitFor fallback resolves');

    await hp.waitFor(
      [
        { type: 'testId', value: 'el' },
        { type: 'css', value: '.el' },
      ],
      'visible',
      { fallbackTimeout: 100 },
    );

    expect(HealingRegistry.instance.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// textContent
// ---------------------------------------------------------------------------

test.describe('healPage.textContent()', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('primary resolves — returns text content, no heal event', async () => {
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'textContent primary');

    const text = await hp.textContent([{ type: 'testId', value: 'el' }], { fallbackTimeout: 100 });

    expect(text).toBe('hello');
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('primary fails, fallback resolves — heal event recorded', async () => {
    const page = mockPage([false, true]);
    const hp = buildHealPage(page, 'textContent fallback');

    await hp.textContent(
      [
        { type: 'testId', value: 'el' },
        { type: 'css', value: '.el' },
      ],
      { fallbackTimeout: 100 },
    );

    expect(HealingRegistry.instance.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getAttribute
// ---------------------------------------------------------------------------

test.describe('healPage.getAttribute()', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('primary resolves — returns attribute value, no heal event', async () => {
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'getAttribute primary');

    const val = await hp.getAttribute('data-id', [{ type: 'testId', value: 'el' }], {
      fallbackTimeout: 100,
    });

    expect(val).toBe('attr-value');
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('primary fails, fallback resolves — heal event recorded', async () => {
    const page = mockPage([false, true]);
    const hp = buildHealPage(page, 'getAttribute fallback');

    await hp.getAttribute(
      'data-id',
      [
        { type: 'testId', value: 'el' },
        { type: 'css', value: '.el' },
      ],
      { fallbackTimeout: 100 },
    );

    expect(HealingRegistry.instance.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// count
// ---------------------------------------------------------------------------

test.describe('healPage.count()', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('primary resolves — returns count, no heal event', async () => {
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'count primary');

    const n = await hp.count([{ type: 'testId', value: 'el' }], { fallbackTimeout: 100 });

    expect(n).toBe(3);
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('primary fails, fallback resolves — heal event recorded', async () => {
    const page = mockPage([false, true]);
    const hp = buildHealPage(page, 'count fallback');

    await hp.count(
      [
        { type: 'testId', value: 'el' },
        { type: 'css', value: '.el' },
      ],
      { fallbackTimeout: 100 },
    );

    expect(HealingRegistry.instance.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// selectOption
// ---------------------------------------------------------------------------

test.describe('healPage.selectOption()', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('primary resolves — selects option, no heal event', async () => {
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'selectOption primary');

    await hp.selectOption('opt-1', [{ type: 'testId', value: 'sel' }], { fallbackTimeout: 100 });

    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('primary fails, fallback resolves — heal event recorded', async () => {
    const page = mockPage([false, true]);
    const hp = buildHealPage(page, 'selectOption fallback');

    await hp.selectOption(
      'opt-1',
      [
        { type: 'testId', value: 'sel' },
        { type: 'css', value: 'select' },
      ],
      { fallbackTimeout: 100 },
    );

    expect(HealingRegistry.instance.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

test.describe('healPage.check()', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('primary resolves — no heal event', async () => {
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'check primary');

    await hp.check([{ type: 'testId', value: 'cb' }], { fallbackTimeout: 100 });

    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('primary fails, fallback resolves — heal event recorded', async () => {
    const page = mockPage([false, true]);
    const hp = buildHealPage(page, 'check fallback');

    await hp.check(
      [
        { type: 'testId', value: 'cb' },
        { type: 'css', value: 'input[type="checkbox"]' },
      ],
      { fallbackTimeout: 100 },
    );

    expect(HealingRegistry.instance.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// uncheck
// ---------------------------------------------------------------------------

test.describe('healPage.uncheck()', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('primary resolves — no heal event', async () => {
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'uncheck primary');

    await hp.uncheck([{ type: 'testId', value: 'cb' }], { fallbackTimeout: 100 });

    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('primary fails, fallback resolves — heal event recorded', async () => {
    const page = mockPage([false, true]);
    const hp = buildHealPage(page, 'uncheck fallback');

    await hp.uncheck(
      [
        { type: 'testId', value: 'cb' },
        { type: 'css', value: 'input[type="checkbox"]' },
      ],
      { fallbackTimeout: 100 },
    );

    expect(HealingRegistry.instance.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// hover
// ---------------------------------------------------------------------------

test.describe('healPage.hover()', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('primary resolves — no heal event', async () => {
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'hover primary');

    await hp.hover([{ type: 'testId', value: 'tooltip-trigger' }], { fallbackTimeout: 100 });

    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('primary fails, fallback resolves — heal event recorded', async () => {
    const page = mockPage([false, true]);
    const hp = buildHealPage(page, 'hover fallback');

    await hp.hover(
      [
        { type: 'testId', value: 'tooltip-trigger' },
        { type: 'css', value: '.tooltip-trigger' },
      ],
      { fallbackTimeout: 100 },
    );

    expect(HealingRegistry.instance.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// doesNotExist — two-strategy probe (MINCRM-230)
// ---------------------------------------------------------------------------

test.describe('doesNotExist two-strategy probe', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('primary present → returns false immediately, no heal event', async () => {
    // waitFor({state:'detached'}) times out → element is present → false
    // Strategy 1 is never reached because we return early.
    const page = mockPage([false]);
    const hp = buildHealPage(page, 'doesNotExist primary present');

    const result = await hp.doesNotExist(
      [
        { type: 'testId', value: 'el' },
        { type: 'role', value: 'button' },
      ],
      100,
    );

    expect(result).toBe(false);
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('both strategies absent → returns true, no heal event', async () => {
    // Strategy 0: waitFor(detached) resolves → strategy0Absent = true
    // Strategy 1: waitFor(attached) rejects → element genuinely absent → true
    const page = mockPage([true, false]);
    const hp = buildHealPage(page, 'doesNotExist both absent');

    const result = await hp.doesNotExist(
      [
        { type: 'testId', value: 'el' },
        { type: 'role', value: 'button' },
      ],
      100,
    );

    expect(result).toBe(true);
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('strategy 0 absent but strategy 1 present → returns false, no heal event (MINCRM-230)', async () => {
    // Primary testId is stale → waitFor(detached) resolves immediately (0 matches).
    // Strategy 1 (role) still finds the element → waitFor(attached) resolves.
    // Must return false (element is actually present). No heal event recorded.
    const page = mockPage([true, true]);
    const hp = buildHealPage(page, 'doesNotExist stale primary');

    const result = await hp.doesNotExist(
      [
        { type: 'testId', value: 'old-testid' },
        { type: 'role', value: 'button' },
      ],
      100,
    );

    expect(result).toBe(false);
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('single strategy absent → returns true, no heal event', async () => {
    // Only one strategy provided — no second probe attempted.
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'doesNotExist single strategy');

    const result = await hp.doesNotExist([{ type: 'testId', value: 'el' }], 100);

    expect(result).toBe(true);
    expect(HealingRegistry.instance.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isNotVisible — two-strategy probe (MINCRM-230)
// ---------------------------------------------------------------------------

test.describe('isNotVisible two-strategy probe', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('primary visible → returns false immediately, no heal event', async () => {
    // waitFor({state:'hidden'}) times out → element is visible → false
    const page = mockPage([false]);
    const hp = buildHealPage(page, 'isNotVisible primary visible');

    const result = await hp.isNotVisible(
      [
        { type: 'testId', value: 'el' },
        { type: 'role', value: 'dialog' },
      ],
      100,
    );

    expect(result).toBe(false);
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('both strategies hidden/absent → returns true, no heal event', async () => {
    // Strategy 0: waitFor(hidden) resolves → strategy0Hidden = true
    // Strategy 1: waitFor(visible) rejects → element genuinely hidden → true
    const page = mockPage([true, false]);
    const hp = buildHealPage(page, 'isNotVisible both hidden');

    const result = await hp.isNotVisible(
      [
        { type: 'testId', value: 'el' },
        { type: 'role', value: 'dialog' },
      ],
      100,
    );

    expect(result).toBe(true);
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('strategy 0 hidden but strategy 1 visible → returns false, no heal event (MINCRM-230)', async () => {
    // Primary testId is stale → waitFor(hidden) resolves immediately (0 matches).
    // Strategy 1 (role) still finds the element visible → waitFor(visible) resolves.
    // Must return false (element is actually visible). No heal event recorded.
    const page = mockPage([true, true]);
    const hp = buildHealPage(page, 'isNotVisible stale primary');

    const result = await hp.isNotVisible(
      [
        { type: 'testId', value: 'old-testid' },
        { type: 'role', value: 'dialog' },
      ],
      100,
    );

    expect(result).toBe(false);
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('single strategy hidden → returns true, no heal event', async () => {
    // Only one strategy provided — no second probe attempted.
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'isNotVisible single strategy');

    const result = await hp.isNotVisible([{ type: 'testId', value: 'el' }], 100);

    expect(result).toBe(true);
    expect(HealingRegistry.instance.count).toBe(0);
  });
});
