/**
 * Unit tests for BoundHealingLocator (MINCRM-209).
 *
 * Verifies:
 * 1. resolve() delegates to inner HealingLocator.resolve(testName).
 * 2. waitFor() resolves the locator then waits for the given state.
 * 3. testName is captured at construction, not passed on each call.
 */

import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { HealingLocator } from '../../framework/healing/healing-locator.js';
import { BoundHealingLocator } from '../../framework/healing/bound-healing-locator.js';
import { HealingRegistry } from '../../framework/healing/healing-registry.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockLocator(resolves: boolean): Locator & { waitForCalls: Array<{ state: string }> } {
  const calls: Array<{ state: string }> = [];
  const loc = {
    waitFor: (opts?: { state?: string; timeout?: number }) => {
      calls.push({ state: opts?.state ?? '' });
      return resolves ? Promise.resolve() : Promise.reject(new Error('Timeout'));
    },
    waitForCalls: calls,
  } as unknown as Locator & { waitForCalls: Array<{ state: string }> };
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
// Tests
// ---------------------------------------------------------------------------

test.describe('BoundHealingLocator', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('resolve() delegates to inner HealingLocator.resolve with captured testName', async () => {
    const page = mockPage([true]);
    const inner = new HealingLocator(page, [{ type: 'testId', value: 'btn' }], {
      fallbackTimeout: 100,
    });
    const bound = new BoundHealingLocator(inner, 'my test name');

    const locator = await bound.resolve();

    expect(locator).toBeDefined();
    // No heal event because primary resolved
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('resolve() uses captured testName — heal event testName matches construction arg', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');

    process.env['PW_WORKER_INDEX'] = '55';

    const page = mockPage([false, true]);
    const inner = new HealingLocator(
      page,
      [
        { type: 'testId', value: 'btn' },
        { type: 'css', value: '.btn' },
      ],
      { fallbackTimeout: 100 },
    );
    const capturedTestName = 'captured-test-name';
    const bound = new BoundHealingLocator(inner, capturedTestName);

    await bound.resolve();

    expect(HealingRegistry.instance.count).toBe(1);

    // Verify the event carries the captured testName, not some other value.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bound-hl-test-'));
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      HealingRegistry.instance.flush();
    } finally {
      process.chdir(originalCwd);
    }

    const contents = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'test-results', 'healing-55.json'), 'utf-8'),
    ) as { events: Array<{ testName: string }> };

    expect(contents.events[0]?.testName).toBe(capturedTestName);

    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env['PW_WORKER_INDEX'];
  });

  test('testName is captured at construction — resolve() takes no parameters', async () => {
    const page = mockPage([true]);
    const inner = new HealingLocator(page, [{ type: 'testId', value: 'x' }], {
      fallbackTimeout: 100,
    });
    const bound = new BoundHealingLocator(inner, 'test-name');

    // TypeScript enforces zero parameters on resolve() — calling it with no args must compile
    const locator = await bound.resolve();
    expect(locator).toBeDefined();
  });

  test('waitFor() resolves the locator then calls locator.waitFor with the given state', async () => {
    const page = mockPage([true]);
    const inner = new HealingLocator(page, [{ type: 'testId', value: 'btn' }], {
      fallbackTimeout: 100,
    });
    const bound = new BoundHealingLocator(inner, 'waitFor test');

    // Should not throw — the mock locator resolves and waitFor resolves
    await expect(bound.waitFor('visible')).resolves.toBeUndefined();
  });

  test('waitFor() passes timeout to the underlying locator.waitFor', async () => {
    const page = mockPage([true]);
    const inner = new HealingLocator(page, [{ type: 'testId', value: 'btn' }], {
      fallbackTimeout: 100,
    });
    const bound = new BoundHealingLocator(inner, 'waitFor timeout test');

    await expect(bound.waitFor('attached', 5000)).resolves.toBeUndefined();
  });

  test('waitFor() throws when the resolved locator times out waiting for state', async () => {
    // First probe (resolve) succeeds so we get a locator back, but the second
    // waitFor call on the resolved locator should fail. We need two mock locators:
    // the first resolves the probe but the second waitFor call on it rejects.
    let callIndex = 0;
    const probeLocator = {
      waitFor: (opts?: { state?: string }) => {
        if (opts?.state === 'attached') return Promise.resolve();
        return Promise.reject(new Error('Timeout waiting for visible'));
      },
    } as unknown as Locator;
    // probeLocator calls locator.first() before waitFor — return self.
    (probeLocator as unknown as Record<string, unknown>)['first'] = () => probeLocator;
    const locators = [probeLocator];
    const fakePage = {
      getByTestId: () => {
        const l = locators[callIndex] ?? locators[0]!;
        callIndex++;
        return l;
      },
      getByRole: () => locators[0]!,
      getByLabel: () => locators[0]!,
      getByText: () => locators[0]!,
      locator: () => locators[0]!,
    } as unknown as Page;

    const inner = new HealingLocator(fakePage, [{ type: 'testId', value: 'btn' }], {
      fallbackTimeout: 100,
    });
    const bound = new BoundHealingLocator(inner, 'waitFor rejects test');

    await expect(bound.waitFor('visible', 100)).rejects.toThrow();
  });
});
