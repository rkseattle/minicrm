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
 *
 */

import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type Anthropic from '@anthropic-ai/sdk';
import {
  HealingLocator,
  StrategyExhaustedError,
  AiHealer,
  CONFIDENCE_THRESHOLD,
} from '../../framework/healing/index.js';
import { HealingRegistry } from '../../framework/healing/healing-registry.js';
import {
  parseResponse,
  truncateDomSnapshot,
  MAX_DOM_CHARS,
} from '../../framework/healing/ai-healer.js';
import { withRetry } from '../../framework/healing/retry-utils.js';
import type { AiHealResult } from '../../framework/healing/ai-healer.js';
import type { LocatorStrategyRecord } from '../../framework/healing/healing-registry.js';

// ---------------------------------------------------------------------------
// Mock helpers (mirrors the pattern in healing-locator.spec.ts)
// ---------------------------------------------------------------------------

/**
 * Creates a mock Locator whose waitFor resolves or rejects based on `resolves`.
 */
function mockLocator(resolves: boolean): Locator {
  const loc = {
    waitFor: resolves
      ? () => Promise.resolve()
      : () => Promise.reject(new Error('Timeout waiting for locator')),
  } as unknown as Locator;
  // probeLocator calls locator.first() before waitFor — return self.
  (loc as unknown as Record<string, unknown>)['first'] = () => loc;
  return loc;
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
// PointerTracker and proximity-based DOM scoping unit tests
// ---------------------------------------------------------------------------

test.describe('PointerTracker proximity-based DOM scoping', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('AiHealer.heal() calls page.evaluate twice — once to inject tracker, once to get snapshot', async () => {
    // Verify that heal() calls evaluate with two distinct functions: the tracker
    // injector and the snapshot extractor. We capture the serialised function text
    // to distinguish them (tracker snippet contains "__pointerTrackerInstalled").
    const evaluateCalls: string[] = [];
    const page = {
      getByTestId: () => mockLocator(false),
      getByRole: () => mockLocator(false),
      getByLabel: () => mockLocator(false),
      getByText: () => mockLocator(false),
      locator: () => mockLocator(false),
      evaluate: (fn: unknown) => {
        evaluateCalls.push(String(fn));
        // First call injects tracker (returns void); second returns the snapshot.
        return Promise.resolve(
          evaluateCalls.length === 1 ? undefined : '<form><button>Submit</button></form>',
        );
      },
    } as unknown as Page;

    const originalEnv = process.env['AI_HEALING'];
    process.env['AI_HEALING'] = '1';
    try {
      // Use a mock Anthropic client so no real API call is made.
      const mockClient = {
        messages: {
          create: async () => ({
            content: [{ type: 'text', text: '{"type":"css","value":".btn","confidence":0.9}' }],
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
        },
      } as unknown as Anthropic;

      const healer = new AiHealer({ _client: mockClient, _retryDelays: [] });
      await healer.heal(page, 'Submit button', []);

      expect(evaluateCalls).toHaveLength(2);
      // First call: tracker injection (contains idempotency guard string).
      expect(evaluateCalls[0]).toContain('__pointerTrackerInstalled');
      // Second call: snapshot extraction (contains pointer-tracker container check).
      expect(evaluateCalls[1]).toContain('__pointerTrackerContainer');
    } finally {
      if (originalEnv !== undefined) {
        process.env['AI_HEALING'] = originalEnv;
      } else {
        delete process.env['AI_HEALING'];
      }
    }
  });

  test('proximity-based scoping uses __pointerTrackerContainer when activeElement is body', async () => {
    // Simulate a page where __pointerTrackerContainer is set (last click was inside
    // a <form>), but activeElement is document.body (no keyboard focus transfer).
    // The heal() should use the tracker container, not fall through to document order.
    const trackerHtml = '<form id="contact-create"><input name="email"/></form>';
    const evaluateResponses = [
      // First evaluate: tracker injection (void)
      undefined,
      // Second evaluate: getScopedDomSnippet returns the tracked container
      trackerHtml,
    ];

    const evaluateCalls: string[] = [];
    const page = {
      getByTestId: () => mockLocator(false),
      getByRole: () => mockLocator(false),
      getByLabel: () => mockLocator(false),
      getByText: () => mockLocator(false),
      locator: () => mockLocator(false),
      evaluate: (fn: unknown) => {
        evaluateCalls.push(String(fn));
        return Promise.resolve(evaluateResponses[evaluateCalls.length - 1]);
      },
    } as unknown as Page;

    const originalEnv = process.env['AI_HEALING'];
    process.env['AI_HEALING'] = '1';

    let capturedPrompt = '';
    const mockClient = {
      messages: {
        create: async (params: { messages: Array<{ content: string }> }) => {
          capturedPrompt = params.messages[0]?.content ?? '';
          return {
            content: [
              {
                type: 'text',
                text: '{"type":"css","value":"#contact-create input","confidence":0.9}',
              },
            ],
            usage: { input_tokens: 10, output_tokens: 10 },
          };
        },
      },
    } as unknown as Anthropic;

    try {
      const healer = new AiHealer({ _client: mockClient, _retryDelays: [] });
      await healer.heal(page, 'email input in contact form', []);

      // The DOM snapshot in the prompt must be the tracker container, not a
      // different form that appears first in document order.
      expect(capturedPrompt).toContain(trackerHtml);
      expect(capturedPrompt).toContain('contact-create');
    } finally {
      if (originalEnv !== undefined) {
        process.env['AI_HEALING'] = originalEnv;
      } else {
        delete process.env['AI_HEALING'];
      }
    }
  });

  test('heal() continues gracefully when tracker injection evaluate throws', async () => {
    // If the tracker inject evaluate rejects (e.g. navigated away), the heal should
    // still proceed and use the fallback scoping (activeElement / document order).
    let evalCount = 0;
    const fallbackSnapshot = '<main><button>Fallback</button></main>';
    const page = {
      getByTestId: () => mockLocator(false),
      getByRole: () => mockLocator(false),
      getByLabel: () => mockLocator(false),
      getByText: () => mockLocator(false),
      locator: () => mockLocator(false),
      evaluate: (_fn: unknown) => {
        evalCount++;
        if (evalCount === 1) return Promise.reject(new Error('frame detached'));
        return Promise.resolve(fallbackSnapshot);
      },
    } as unknown as Page;

    const originalEnv = process.env['AI_HEALING'];
    process.env['AI_HEALING'] = '1';

    let capturedPrompt = '';
    const mockClient = {
      messages: {
        create: async (params: { messages: Array<{ content: string }> }) => {
          capturedPrompt = params.messages[0]?.content ?? '';
          return {
            content: [{ type: 'text', text: '{"type":"css","value":"button","confidence":0.9}' }],
            usage: { input_tokens: 5, output_tokens: 5 },
          };
        },
      },
    } as unknown as Anthropic;

    try {
      const healer = new AiHealer({ _client: mockClient, _retryDelays: [] });
      const result = await healer.heal(page, 'Fallback button', []);

      // heal() must not throw — it should fall through to the snapshot evaluate.
      expect(result).not.toBeNull();
      expect(capturedPrompt).toContain(fallbackSnapshot);
    } finally {
      if (originalEnv !== undefined) {
        process.env['AI_HEALING'] = originalEnv;
      } else {
        delete process.env['AI_HEALING'];
      }
    }
  });

  test('PointerTracker injection is idempotent — __pointerTrackerInstalled guard prevents duplicate listeners', async () => {
    // The injected script must contain the idempotency guard. We verify this by
    // inspecting the serialised function text passed to page.evaluate.
    const evaluateCalls: string[] = [];
    const page = {
      getByTestId: () => mockLocator(false),
      evaluate: (fn: unknown) => {
        evaluateCalls.push(String(fn));
        return Promise.resolve(undefined);
      },
    } as unknown as Page;

    const originalEnv = process.env['AI_HEALING'];
    process.env['AI_HEALING'] = '1';
    try {
      // Trigger heal twice on the same page to ensure the guard is present.
      const mockClient = {
        messages: {
          create: async () => ({
            content: [{ type: 'text', text: '{"type":"css","value":".x","confidence":0.9}' }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        },
      } as unknown as Anthropic;

      const healer = new AiHealer({ _client: mockClient, _retryDelays: [] });
      // Both heal() calls will fail at snapshot evaluate (returns undefined → empty
      // string after truncation), but we only care that the injector was called.
      await healer.heal(page, 'intent one', []).catch(() => null);

      const trackerCall = evaluateCalls[0] ?? '';
      // Guard string must be present so that a second injection is a no-op.
      expect(trackerCall).toContain('__pointerTrackerInstalled');
      // Listener registration must only happen when the guard is falsy.
      expect(trackerCall).toContain('if (window.__pointerTrackerInstalled) return');
    } finally {
      if (originalEnv !== undefined) {
        process.env['AI_HEALING'] = originalEnv;
      } else {
        delete process.env['AI_HEALING'];
      }
    }
  });
});

// ---------------------------------------------------------------------------
// parseResponse unit tests
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

  test('parses a markdown-fenced response without triggering the truncation warning', () => {
    // Models sometimes wrap their JSON in fences despite instructions. The truncation
    // check must run after fence-stripping so a fenced-but-complete response is not
    // incorrectly rejected with a "truncated" warning. ($2)
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      const fenced = '```json\n{"type": "css", "value": ".btn", "confidence": 0.9}\n```';
      const result = parseResponse(fenced);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('css');
      expect(warnings).toHaveLength(0);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('returns null for a response below confidence threshold', () => {
    const raw = '{"type": "css", "value": ".btn", "confidence": 0.5}';
    const result = parseResponse(raw);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// truncateDomSnapshot unit tests
// ---------------------------------------------------------------------------

test.describe('truncateDomSnapshot', () => {
  test('returns snapshot unchanged when it is within MAX_DOM_CHARS', () => {
    const small = '<main><button>OK</button></main>';
    expect(truncateDomSnapshot(small, '[data-testid="ok"]')).toBe(small);
  });

  test('truncates an oversized snapshot and logs a warning', () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      // Build a snapshot that exceeds MAX_DOM_CHARS by repeating child nodes.
      const child = '<div>' + 'x'.repeat(500) + '</div>';
      const children = child.repeat(Math.ceil((MAX_DOM_CHARS + 1000) / child.length));
      const snapshot = `<main>${children}</main>`;
      expect(snapshot.length).toBeGreaterThan(MAX_DOM_CHARS);

      const result = truncateDomSnapshot(snapshot, '[data-testid="big-table"]');

      expect(result.length).toBeLessThanOrEqual(MAX_DOM_CHARS + '<!-- truncated -->'.length);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('[data-testid="big-table"]');
      expect(warnings[0]).toContain(String(snapshot.length));
    } finally {
      console.warn = originalWarn;
    }
  });

  test('falls back to substring when the container itself exceeds MAX_DOM_CHARS', () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      // A single text node larger than MAX_DOM_CHARS — no children to trim.
      const snapshot = '<main>' + 'x'.repeat(MAX_DOM_CHARS + 1000) + '</main>';
      const result = truncateDomSnapshot(snapshot, '[data-testid="huge"]');
      expect(result.endsWith('<!-- truncated -->')).toBe(true);
      expect(result.length).toBeLessThanOrEqual(MAX_DOM_CHARS + '<!-- truncated -->'.length);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('substring fallback');
    } finally {
      console.warn = originalWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// withRetry unit tests
// ---------------------------------------------------------------------------

/**
 * Creates a minimal APIError-shaped object with the given status code.
 * The Anthropic SDK's APIError is a class we can construct directly.
 */
async function makeApiError(status: number): Promise<Error> {
  const { APIError } = await import('@anthropic-ai/sdk/error.js');
  return new APIError(status, undefined, `HTTP ${status}`, undefined);
}

test.describe('withRetry', () => {
  test('succeeds on the second attempt after a 429 and logs a warning', async () => {
    const err429 = await makeApiError(429);
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      let callCount = 0;
      const result = await withRetry(async () => {
        callCount++;
        if (callCount === 1) throw err429;
        return 'ok';
      }, [0, 0]);
      expect(result).toBe('ok');
      expect(callCount).toBe(2);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('429');
      expect(warnings[0]).toContain('attempt 1');
    } finally {
      console.warn = originalWarn;
    }
  });

  test('exhausts retries after three 503s and logs an error', async () => {
    const err503 = await makeApiError(503);
    const errors: string[] = [];
    const warnings: string[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };
    try {
      let callCount = 0;
      await expect(
        withRetry(async () => {
          callCount++;
          throw err503;
        }, [0, 0]),
      ).rejects.toThrow();
      expect(callCount).toBe(3); // initial + 2 retries
      expect(warnings).toHaveLength(2); // one per retry attempt
      expect(errors).toHaveLength(1); // final exhaustion log
      expect(errors[0]).toContain('503');
      expect(errors[0]).toContain('exhausted');
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
  });

  test('does not retry on a 400 and propagates the error immediately', async () => {
    const err400 = await makeApiError(400);
    let callCount = 0;
    await expect(
      withRetry(async () => {
        callCount++;
        throw err400;
      }, [0, 0]),
    ).rejects.toThrow();
    expect(callCount).toBe(1); // no retries
  });
});
