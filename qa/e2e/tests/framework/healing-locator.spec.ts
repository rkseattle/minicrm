/**
 * Unit tests for HealingLocator.
 *
 * Uses a mock Page object so no browser is required. The tests verify:
 * 1. Primary strategy resolves — no heal event recorded.
 * 2. Primary fails, first valid fallback resolves — heal event logged.
 * 3. All strategies exhausted — StrategyExhaustedError thrown with all strategy names.
 * 4. Strategy priority order is enforced regardless of input order.
 *
 * MINCRM-124
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
 * depending on the `resolves` flag.
 */
function mockLocator(resolves: boolean): Locator {
  return {
    waitFor: resolves
      ? () => Promise.resolve()
      : () => Promise.reject(new Error('Timeout waiting for locator')),
  } as unknown as Locator;
}

/**
 * Builds a mock Page that returns a specific Locator for a given selector/call
 * index. The `resolveMap` maps call order (0-based) to whether the locator resolves.
 *
 * Each Playwright factory method (getByTestId, getByRole, etc.) pops from the
 * map in the order they are invoked.
 */
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
// Tests
// ---------------------------------------------------------------------------

test.describe('HealingLocator', () => {
  test.beforeEach(() => {
    // Reset the registry singleton between tests so heal counts don't bleed.
    HealingRegistry.instance._reset();
  });

  test('primary strategy resolves — returns locator, no heal event recorded', async () => {
    const page = mockPage([true]); // first call resolves
    const locator = await new HealingLocator(page, [
      { type: 'testId', value: 'submit-btn' },
      { type: 'css', value: 'button[type="submit"]' },
    ]).resolve('primary resolves test');

    expect(locator).toBeDefined();
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('primary fails, first fallback resolves — heal event logged', async () => {
    // Call order: testId (fails), css (resolves)
    const page = mockPage([false, true]);

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

    const page = mockPage([false, true]); // testId fails, css resolves
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
    const page = mockPage([false, false, false]);

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
    const page = mockPage([false, false]);

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

  test('wasAiHeal is false for static fallbacks', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');

    process.env['PW_WORKER_INDEX'] = '88';
    const page = mockPage([false, true]); // primary fails, fallback resolves
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
});
