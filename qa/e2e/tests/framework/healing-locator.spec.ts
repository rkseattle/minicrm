/**
 * Unit tests for HealingLocator.
 *
 * Uses a mock Page object so no browser is required. The tests verify:
 * 1. Primary strategy resolves — no heal event recorded.
 * 2. Primary fails, first valid fallback resolves — heal event logged.
 * 3. All strategies exhausted — StrategyExhaustedError thrown with all strategy names.
 * 4. Strategy priority order is enforced regardless of input order.
 * 5. `within` scopes the lookup to a container element (MINCRM-204).
 *
 * MINCRM-124, MINCRM-204
 */

import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  HealingLocator,
  StrategyExhaustedError,
  STRATEGY_ORDER,
} from '../../framework/healing/healing-locator.js';
import { HealingRegistry } from '../../framework/healing/healing-registry.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock Locator whose waitFor resolves (attached) or rejects (timeout)
 * depending on the `resolves` flag. Includes `.first()` returning itself so
 * probeLocator (which calls `locator.first().waitFor(...)`) works correctly.
 */
function mockLocator(resolves: boolean): Locator {
  const locator: Locator = {
    waitFor: resolves
      ? () => Promise.resolve()
      : () => Promise.reject(new Error('Timeout waiting for locator')),
    first: () => locator,
  } as unknown as Locator;
  return locator;
}

/**
 * Builds a mock Page that returns a specific Locator for a given selector/call
 * index. The `resolveMap` maps call order (0-based) to whether the locator resolves.
 *
 * Each Playwright factory method (getByTestId, getByRole, etc.) pops from the
 * map in the order they are invoked — including calls made on container locators
 * returned by getByTestId (the `within` path). This mirrors Playwright's API
 * where Locator exposes the same factory methods as Page.
 */
function mockPage(resolveMap: boolean[]): Page {
  let callIndex = 0;

  // A factory that consumes from the shared resolveMap regardless of whether
  // it is called on the page or on a container locator.
  const factory = () => {
    const resolves = resolveMap[callIndex] ?? false;
    callIndex++;
    return mockLocator(resolves);
  };

  // A container locator: its factory methods share the same call-index queue
  // as the page factories so callers can reason about total call order.
  const containerLocator = {
    getByTestId: factory,
    getByRole: factory,
    getByLabel: factory,
    getByText: factory,
    locator: factory,
  } as unknown as Locator;

  return {
    // When `within` is used, buildLocator calls page.getByTestId(within) first
    // to get the container, then calls a factory method on it. That first call
    // must NOT consume a resolveMap slot — it always succeeds and returns the
    // container locator. We detect the "container lookup" by checking whether
    // the caller will chain further calls on the result.
    //
    // Implementation: getByTestId on the page returns the containerLocator
    // without consuming from resolveMap. Subsequent factory calls on
    // containerLocator consume from the map as usual.
    getByTestId: (_value: string) => containerLocator,
    getByRole: factory,
    getByLabel: factory,
    getByText: factory,
    locator: factory,
  } as unknown as Page;
}

/**
 * Builds a mock Page where `getByTestId` on the page also consumes from the
 * resolveMap — used by tests that exercise the non-`within` testId path to
 * verify that the correct locator is tried first.
 */
function mockPageWithTestId(resolveMap: boolean[]): Page {
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
// Tests
// ---------------------------------------------------------------------------

test.describe('HealingLocator', () => {
  test.beforeEach(() => {
    // Reset the registry singleton between tests so heal counts don't bleed.
    HealingRegistry.instance._reset();
  });

  test('primary strategy resolves — returns locator, no heal event recorded', async () => {
    const page = mockPageWithTestId([true]); // first call resolves
    const locator = await new HealingLocator(page, [
      { type: 'testId', value: 'submit-btn' },
      { type: 'css', value: 'button[type="submit"]' },
    ]).resolve('primary resolves test');

    expect(locator).toBeDefined();
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('primary fails, first fallback resolves — heal event logged', async () => {
    // Call order: testId (fails), css (resolves)
    const page = mockPageWithTestId([false, true]);

    const locator = await new HealingLocator(
      page,
      [
        { type: 'testId', value: 'submit-btn' },
        { type: 'css', value: 'button[type="submit"]' },
      ],
      { fallbackTimeout: 100 },
    ).resolve('fallback resolves test');

    expect(locator).toBeDefined();
    expect(HealingRegistry.instance.count).toBe(1);
  });

  test('heal event records original and healed strategy correctly', async () => {
    // Spy: flush to a temp file then read it back.
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');

    // Point worker file to a temp dir for this test.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healing-test-'));
    process.env['PW_WORKER_INDEX'] = '99';

    const page = mockPageWithTestId([false, true]); // testId fails, css resolves
    await new HealingLocator(
      page,
      [
        { type: 'testId', value: 'my-btn' },
        { type: 'css', value: '.my-btn' },
      ],
      { fallbackTimeout: 100 },
    ).resolve('heal record test');

    // Write to the tmp dir by monkey-patching process.env and calling flush.
    // We need to write to a path we control; override OUTPUT_DIR behaviour by
    // temporarily replacing cwd so the relative path lands in tmpDir.
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      HealingRegistry.instance.flush();
    } finally {
      process.chdir(originalCwd);
    }

    const writtenPath = path.join(tmpDir, 'test-results', 'healing-99.json');
    const contents = JSON.parse(fs.readFileSync(writtenPath, 'utf-8')) as {
      workerId: string;
      events: Array<{
        originalStrategy: { type: string; value: string };
        healedStrategy: { type: string; value: string };
        wasAiHeal: boolean;
      }>;
    };

    expect(contents.workerId).toBe('99');
    expect(contents.events).toHaveLength(1);
    expect(contents.events[0]?.originalStrategy.type).toBe('testId');
    expect(contents.events[0]?.originalStrategy.value).toBe('my-btn');
    expect(contents.events[0]?.healedStrategy.type).toBe('css');
    expect(contents.events[0]?.healedStrategy.value).toBe('.my-btn');
    expect(contents.events[0]?.wasAiHeal).toBe(false);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env['PW_WORKER_INDEX'];
  });

  test('all strategies exhausted — throws StrategyExhaustedError listing all strategies', async () => {
    // All calls fail.
    const page = mockPageWithTestId([false, false, false]);

    await expect(
      new HealingLocator(
        page,
        [
          { type: 'testId', value: 'missing-btn' },
          { type: 'role', value: 'button', options: { name: 'Missing' } },
          { type: 'css', value: '.missing' },
        ],
        { fallbackTimeout: 100 },
      ).resolve('exhaustion test'),
    ).rejects.toThrow(StrategyExhaustedError);
  });

  test('StrategyExhaustedError message lists all attempted strategies', async () => {
    const page = mockPageWithTestId([false, false]);

    let caughtError: unknown;
    try {
      await new HealingLocator(
        page,
        [
          { type: 'testId', value: 'gone' },
          { type: 'css', value: '.gone' },
        ],
        { fallbackTimeout: 100 },
      ).resolve('error message test');
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(StrategyExhaustedError);
    const message = (caughtError as StrategyExhaustedError).message;
    expect(message).toContain('testId');
    expect(message).toContain('"gone"');
    expect(message).toContain('css');
    expect(message).toContain('".gone"');
  });

  test('strategy priority order is enforced — testId tried before role before css', () => {
    // Verify the STRATEGY_ORDER constant has the correct ordering.
    expect(STRATEGY_ORDER.testId).toBeLessThan(STRATEGY_ORDER.role);
    expect(STRATEGY_ORDER.role).toBeLessThan(STRATEGY_ORDER.label);
    expect(STRATEGY_ORDER.label).toBeLessThan(STRATEGY_ORDER.text);
    expect(STRATEGY_ORDER.text).toBeLessThan(STRATEGY_ORDER.css);
    expect(STRATEGY_ORDER.css).toBeLessThan(STRATEGY_ORDER.xpath);
  });

  test('strategies are sorted by priority regardless of input order', async () => {
    // Track which Page factory method was called first.
    // If sorting is applied, getByTestId is called before locator (css).
    // If sorting is NOT applied, locator (css) would be called first because it
    // appears first in the input array.
    const callOrder: string[] = [];

    const trackedPage = {
      getByTestId: (_value: string) => {
        callOrder.push('getByTestId');
        return mockLocator(true); // resolves — stops iteration here
      },
      locator: (_value: string) => {
        callOrder.push('locator');
        return mockLocator(true);
      },
      getByRole: () => mockLocator(false),
      getByLabel: () => mockLocator(false),
      getByText: () => mockLocator(false),
    } as unknown as Page;

    await new HealingLocator(
      trackedPage,
      [
        { type: 'css', value: '.btn' }, // lower priority — should be tried second
        { type: 'testId', value: 'btn' }, // higher priority — should be tried first
      ],
      { fallbackTimeout: 100 },
    ).resolve('sort order test');

    // After sorting, testId (getByTestId) must be attempted before css (locator).
    expect(callOrder[0]).toBe('getByTestId');
    expect(HealingRegistry.instance.count).toBe(0); // primary resolved, no heal
  });

  test('intent field is accessible after construction', () => {
    const page = mockPage([]);
    const hl = new HealingLocator(page, [{ type: 'testId', value: 'x' }], {
      intent: 'The submit button for the login form',
    });
    expect(hl.intent).toBe('The submit button for the login form');
  });

  test('pageObject and method are recorded in heal event when provided (MINCRM-225)', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');

    process.env['PW_WORKER_INDEX'] = '66';
    const page = mockPageWithTestId([false, true]); // primary fails, fallback resolves
    await new HealingLocator(
      page,
      [
        { type: 'testId', value: 'save-btn' },
        { type: 'css', value: '.save-btn' },
      ],
      { fallbackTimeout: 100, pageObject: 'ContactsPage', method: 'saveButton' },
    ).resolve('pageObject method test');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healing-test-po-'));
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      HealingRegistry.instance.flush();
    } finally {
      process.chdir(originalCwd);
    }

    const writtenPath = path.join(tmpDir, 'test-results', 'healing-66.json');
    const contents = JSON.parse(fs.readFileSync(writtenPath, 'utf-8')) as {
      events: Array<{ pageObject?: string; method?: string }>;
    };

    expect(contents.events[0]?.pageObject).toBe('ContactsPage');
    expect(contents.events[0]?.method).toBe('saveButton');

    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env['PW_WORKER_INDEX'];
  });

  test('pageObject and method are absent from heal event when not provided (MINCRM-225)', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');

    process.env['PW_WORKER_INDEX'] = '65';
    const page = mockPageWithTestId([false, true]);
    await new HealingLocator(
      page,
      [
        { type: 'testId', value: 'btn' },
        { type: 'css', value: '.btn' },
      ],
      { fallbackTimeout: 100 },
    ).resolve('no pageObject test');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healing-test-nopo-'));
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      HealingRegistry.instance.flush();
    } finally {
      process.chdir(originalCwd);
    }

    const writtenPath = path.join(tmpDir, 'test-results', 'healing-65.json');
    const contents = JSON.parse(fs.readFileSync(writtenPath, 'utf-8')) as {
      events: Array<Record<string, unknown>>;
    };

    expect(contents.events[0]).not.toHaveProperty('pageObject');
    expect(contents.events[0]).not.toHaveProperty('method');

    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env['PW_WORKER_INDEX'];
  });

  test('wasAiHeal is false for static fallbacks', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');

    process.env['PW_WORKER_INDEX'] = '88';
    const page = mockPageWithTestId([false, true]); // primary fails, fallback resolves
    await new HealingLocator(
      page,
      [
        { type: 'testId', value: 'x' },
        { type: 'css', value: '.x' },
      ],
      { fallbackTimeout: 100 },
    ).resolve('ai heal false test');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healing-test-ai-'));
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      HealingRegistry.instance.flush();
    } finally {
      process.chdir(originalCwd);
    }

    const writtenPath = path.join(tmpDir, 'test-results', 'healing-88.json');
    const contents = JSON.parse(fs.readFileSync(writtenPath, 'utf-8')) as {
      events: Array<{ wasAiHeal: boolean }>;
    };

    expect(contents.events[0]?.wasAiHeal).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env['PW_WORKER_INDEX'];
  });

  // ---------------------------------------------------------------------------
  // `within` scoping (MINCRM-204)
  // ---------------------------------------------------------------------------

  test('within: scoped testId resolves element inside container', async () => {
    // The mock page's getByTestId always returns containerLocator.
    // containerLocator's getByTestId consumes resolveMap[0] = true.
    const page = mockPage([true]);
    const locator = await new HealingLocator(
      page,
      [
        { type: 'testId', value: 'search-input', within: 'nav-drawer' },
        { type: 'css', value: '[data-testid="search-input"]', within: 'nav-drawer' },
      ],
      { fallbackTimeout: 100 },
    ).resolve('within scoped test');

    expect(locator).toBeDefined();
    expect(HealingRegistry.instance.count).toBe(0); // primary resolved, no heal
  });

  test('within: scoped primary fails, scoped fallback resolves — heal event recorded', async () => {
    // resolveMap[0] = false (container's getByTestId fails)
    // resolveMap[1] = true  (container's locator/css resolves)
    const page = mockPage([false, true]);
    const locator = await new HealingLocator(
      page,
      [
        { type: 'testId', value: 'search-input', within: 'nav-drawer' },
        { type: 'css', value: '[data-testid="search-input"]', within: 'nav-drawer' },
      ],
      { fallbackTimeout: 100 },
    ).resolve('within fallback test');

    expect(locator).toBeDefined();
    expect(HealingRegistry.instance.count).toBe(1);
  });

  test('within: heal event record includes `within` field', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');

    process.env['PW_WORKER_INDEX'] = '77';
    const page = mockPage([false, true]); // scoped testId fails, scoped css resolves

    await new HealingLocator(
      page,
      [
        { type: 'testId', value: 'search-input', within: 'nav-drawer' },
        { type: 'css', value: '[data-testid="search-input"]', within: 'nav-drawer' },
      ],
      { fallbackTimeout: 100 },
    ).resolve('within heal record test');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healing-test-within-'));
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      HealingRegistry.instance.flush();
    } finally {
      process.chdir(originalCwd);
    }

    const writtenPath = path.join(tmpDir, 'test-results', 'healing-77.json');
    const contents = JSON.parse(fs.readFileSync(writtenPath, 'utf-8')) as {
      events: Array<{
        originalStrategy: { type: string; value: string; within?: string };
        healedStrategy: { type: string; value: string; within?: string };
      }>;
    };

    expect(contents.events).toHaveLength(1);
    expect(contents.events[0]?.originalStrategy.within).toBe('nav-drawer');
    expect(contents.events[0]?.healedStrategy.within).toBe('nav-drawer');

    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env['PW_WORKER_INDEX'];
  });

  test('within: all strategies exhausted when element absent from container', async () => {
    // Both container factory calls fail — element not in the container.
    const page = mockPage([false, false]);

    await expect(
      new HealingLocator(
        page,
        [
          { type: 'testId', value: 'missing-input', within: 'nav-drawer' },
          { type: 'css', value: '[data-testid="missing-input"]', within: 'nav-drawer' },
        ],
        { fallbackTimeout: 100 },
      ).resolve('within exhausted test'),
    ).rejects.toThrow(StrategyExhaustedError);
  });
});
