/**
 * Unit tests for AiHealer and its integration into HealingLocator.
 *
 * No real Anthropic API calls are made. AiHealer is injected via the
 * _aiHealer option on HealingLocator so tests can control responses.
 *
 * Tests:
 * 1. AI tier is NOT invoked when a static fallback resolves.
 * 2. AI tier IS invoked when all static strategies fail and intent is set.
 * 3. Sub-0.75 confidence response → clean test failure (StrategyExhaustedError).
 * 4. AI healing is skipped entirely when AI_HEALING env var is absent.
 *
 * MINCRM-125
 */

import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  HealingLocator,
  StrategyExhaustedError,
  AiHealer,
  CONFIDENCE_THRESHOLD,
} from '../../framework/healing/index.js';
import { HealingRegistry } from '../../framework/healing/healing-registry.js';
import { parseResponse } from '../../framework/healing/ai-healer.js';
import type { AiHealResult } from '../../framework/healing/ai-healer.js';
import type { LocatorStrategyRecord } from '../../framework/healing/healing-registry.js';

// ---------------------------------------------------------------------------
// Mock helpers (mirrors the pattern in healing-locator.spec.ts)
// ---------------------------------------------------------------------------

/**
 * Creates a mock Locator whose waitFor resolves or rejects based on `resolves`.
 */
function mockLocator(resolves: boolean): Locator {
  return {
    waitFor: resolves
      ? () => Promise.resolve()
      : () => Promise.reject(new Error('Timeout waiting for locator')),
  } as unknown as Locator;
}

/**
 * Builds a mock Page. Each factory call pops the next boolean from resolveMap.
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
    evaluate: () =>
      Promise.resolve('<main><button data-testid="submit-btn">Submit</button></main>'),
  } as unknown as Page;
}

/**
 * Creates a stub AiHealer whose heal() method returns the given result without
 * making any real API calls. Tracks how many times heal() was called.
 */
function stubAiHealer(result: AiHealResult | null): AiHealer & { callCount: number } {
  const healer = Object.create(AiHealer.prototype) as AiHealer & { callCount: number };
  healer.callCount = 0;
  healer.heal = async (
    _page: Page,
    _intent: string,
    _attempted: LocatorStrategyRecord[],
  ): Promise<AiHealResult | null> => {
    healer.callCount++;
    return result;
  };
  return healer;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('AiHealer integration into HealingLocator', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  // -------------------------------------------------------------------------
  // Test 1: AI tier NOT invoked when a static fallback resolves
  // -------------------------------------------------------------------------
  test('AI tier is NOT invoked when a static fallback resolves', async () => {
    // testId (primary) fails; css (fallback) resolves — AI should never be called.
    const page = mockPage([false, true]);
    const aiHealer = stubAiHealer({
      type: 'css',
      value: '.never-used',
      confidence: 0.9,
    });

    await new HealingLocator(
      page,
      [
        { type: 'testId', value: 'submit-btn' },
        { type: 'css', value: 'button[type="submit"]' },
      ],
      {
        intent: 'Submit form button',
        fallbackTimeout: 100,
        _aiHealer: aiHealer,
      },
    ).resolve('static fallback resolves test');

    expect(aiHealer.callCount).toBe(0);
    // Heal count is 1 — the static fallback fired, not AI
    expect(HealingRegistry.instance.count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 2: AI tier IS invoked when all static strategies fail and intent set
  // -------------------------------------------------------------------------
  test('AI tier IS invoked when all static strategies fail and intent is set', async () => {
    // All static strategies fail; AI healer returns a confident result that resolves.
    // resolveMap: testId (false), css (false), then AI result's css locator (true)
    const page = mockPage([false, false, true]);
    const aiHealer = stubAiHealer({
      type: 'css',
      value: '.submit-btn-ai',
      confidence: 0.9,
    });

    const locator = await new HealingLocator(
      page,
      [
        { type: 'testId', value: 'submit-btn' },
        { type: 'css', value: 'button[type="submit"]' },
      ],
      {
        intent: 'Submit form button',
        fallbackTimeout: 100,
        _aiHealer: aiHealer,
      },
    ).resolve('ai tier invoked test');

    expect(aiHealer.callCount).toBe(1);
    expect(locator).toBeDefined();
    // AI heal recorded with wasAiHeal: true
    expect(HealingRegistry.instance.count).toBe(1);
  });

  test('AI heal event is recorded with wasAiHeal: true', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');

    process.env['PW_WORKER_INDEX'] = '77';

    // All static fail, AI resolves.
    const page = mockPage([false, false, true]);
    const aiHealer = stubAiHealer({
      type: 'css',
      value: '.ai-found',
      confidence: 0.85,
    });

    await new HealingLocator(
      page,
      [
        { type: 'testId', value: 'btn' },
        { type: 'css', value: '.btn' },
      ],
      {
        intent: 'A button element',
        fallbackTimeout: 100,
        _aiHealer: aiHealer,
      },
    ).resolve('wasAiHeal true test');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-healer-test-'));
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      HealingRegistry.instance.flush();
    } finally {
      process.chdir(originalCwd);
    }

    const writtenPath = path.join(tmpDir, 'test-results', 'healing-77.json');
    const contents = JSON.parse(fs.readFileSync(writtenPath, 'utf-8')) as {
      events: Array<{ wasAiHeal: boolean; healedStrategy: { type: string; value: string } }>;
    };

    expect(contents.events).toHaveLength(1);
    expect(contents.events[0]?.wasAiHeal).toBe(true);
    expect(contents.events[0]?.healedStrategy.type).toBe('css');
    expect(contents.events[0]?.healedStrategy.value).toBe('.ai-found');

    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env['PW_WORKER_INDEX'];
  });

  // -------------------------------------------------------------------------
  // Test 3: Sub-0.75 confidence → clean test failure, not wrong-element match
  // -------------------------------------------------------------------------
  test('sub-0.75 confidence response results in StrategyExhaustedError, not wrong match', async () => {
    // All static strategies fail; AI returns null (sub-threshold confidence
    // is handled inside AiHealer.heal() which returns null in that case).
    const page = mockPage([false, false]);
    const aiHealer = stubAiHealer(null); // simulates sub-0.75 or no confident result

    await expect(
      new HealingLocator(
        page,
        [
          { type: 'testId', value: 'missing-btn' },
          { type: 'css', value: '.missing' },
        ],
        {
          intent: 'A button that no longer exists',
          fallbackTimeout: 100,
          _aiHealer: aiHealer,
        },
      ).resolve('low confidence test'),
    ).rejects.toThrow(StrategyExhaustedError);

    // AI was invoked (intent was set), but result was null — no heal recorded
    expect(aiHealer.callCount).toBe(1);
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('CONFIDENCE_THRESHOLD constant is 0.75', () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.75);
  });

  // -------------------------------------------------------------------------
  // Test 4: AI healing skipped entirely when AI_HEALING env var is unset
  // -------------------------------------------------------------------------
  test('AI healing is skipped when AI_HEALING env var is absent', async () => {
    // Ensure AI_HEALING is unset for this test.
    const originalValue = process.env['AI_HEALING'];
    delete process.env['AI_HEALING'];

    try {
      // Use a real AiHealer (no stub) — it should return null due to the env guard.
      // We verify indirectly: all static strategies fail, intent is set, but
      // StrategyExhaustedError is thrown (not a successful AI heal).
      const page = mockPage([false, false]);

      await expect(
        new HealingLocator(
          page,
          [
            { type: 'testId', value: 'gated-btn' },
            { type: 'css', value: '.gated' },
          ],
          {
            intent: 'A gated button',
            fallbackTimeout: 100,
            // No _aiHealer override — uses real AiHealer, which checks AI_HEALING
          },
        ).resolve('ai_healing env unset test'),
      ).rejects.toThrow(StrategyExhaustedError);

      // No heal events — AI was gated by the env var
      expect(HealingRegistry.instance.count).toBe(0);
    } finally {
      // Restore env state
      if (originalValue !== undefined) {
        process.env['AI_HEALING'] = originalValue;
      }
    }
  });

  test('AI tier is skipped when intent is empty string', async () => {
    // When intent is not set (empty string), AI tier is bypassed entirely.
    const page = mockPage([false, false]);
    const aiHealer = stubAiHealer({
      type: 'css',
      value: '.should-not-be-called',
      confidence: 0.99,
    });

    await expect(
      new HealingLocator(
        page,
        [
          { type: 'testId', value: 'x' },
          { type: 'css', value: '.x' },
        ],
        {
          // No intent — AI tier must not fire
          fallbackTimeout: 100,
          _aiHealer: aiHealer,
        },
      ).resolve('no intent test'),
    ).rejects.toThrow(StrategyExhaustedError);

    expect(aiHealer.callCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MINCRM-222: parseResponse unit tests
// ---------------------------------------------------------------------------

test.describe('parseResponse', () => {
  test('returns null and logs a warning when response is truncated (no closing brace)', () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      const truncated = '{"type": "css", "value": ".btn", "confidence": 0.9';
      const result = parseResponse(truncated);
      expect(result).toBeNull();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('truncated');
      expect(warnings[0]).toContain(truncated);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('returns a valid AiHealResult for a well-formed response', () => {
    const raw = '{"type": "css", "value": ".submit-btn", "confidence": 0.9}';
    const result = parseResponse(raw);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('css');
    expect(result?.value).toBe('.submit-btn');
    expect(result?.confidence).toBe(0.9);
  });

  test('returns null for a response below confidence threshold', () => {
    const raw = '{"type": "css", "value": ".btn", "confidence": 0.5}';
    const result = parseResponse(raw);
    expect(result).toBeNull();
  });
});
