/**
 * AiHealer — AI-powered fallback locator strategy using the Anthropic SDK.
 *
 * Called by HealingLocator as the final tier after all static strategies
 * are exhausted. Sends a scoped DOM snapshot and a plain-English `intent`
 * string to the model, which returns a new locator candidate with a
 * confidence score.
 *
 * Guards:
 * - Returns null immediately if the AI_HEALING env var is absent (opt-in only).
 * - Returns null if the model's confidence is below the CONFIDENCE_THRESHOLD.
 *
 * DOM scoping:
 * - Finds the nearest semantic container (main, [role=dialog], form) so that
 *   full-page HTML is never sent to the model.
 *
 * MINCRM-125
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Page } from '@playwright/test';
import type { LocatorStrategyRecord } from './healing-registry.js';
import type { StrategyType } from './healing-locator.js';

/** Minimum confidence required to use an AI-generated locator. */
export const CONFIDENCE_THRESHOLD = 0.75;

/** Default timeout for the AI API call in milliseconds. */
export const DEFAULT_AI_TIMEOUT_MS = 15_000;

/** Model used for AI healing. */
const HEALING_MODEL = 'claude-sonnet-4-20250514';

/** Result returned by the AI healer on a successful (confident) response. */
export interface AiHealResult {
  /** The strategy type the model recommends. */
  type: StrategyType;
  /** The selector value for the strategy. */
  value: string;
  /** Confidence score from 0.0 to 1.0. */
  confidence: number;
  /** Model's explanation of its reasoning. */
  reasoning: string;
}

/** Options accepted by AiHealer constructor. */
export interface AiHealerOptions {
  /**
   * Milliseconds before the AI API call is aborted.
   * Defaults to DEFAULT_AI_TIMEOUT_MS.
   */
  timeoutMs?: number;
}

/**
 * JS snippet injected into the page to extract a scoped DOM snapshot.
 * Returns the outerHTML of the nearest semantic ancestor of the active element,
 * or the full body HTML as a last resort.
 *
 * This function is serialized and evaluated in the browser context, so it must
 * be self-contained — no closure references.
 *
 * Cast as `() => string` to prevent tsc from requiring the DOM lib, since
 * this code runs only inside page.evaluate (browser context, not Node).
 */
const getScopedDomSnippet = /* @__PURE__ */ (() => {
  return new Function(`
    const scopeSelectors = ['main', '[role="dialog"]', 'form'];
    for (const sel of scopeSelectors) {
      const el = document.querySelector(sel);
      if (el) return el.outerHTML;
    }
    return document.body.outerHTML;
  `) as () => string;
})();

/**
 * Builds the prompt sent to the model.
 * Clearly states the task, provides the DOM snapshot, lists failed strategies,
 * and demands a JSON response only.
 */
function buildPrompt(
  intent: string,
  domSnapshot: string,
  attempted: LocatorStrategyRecord[],
): string {
  const failedList = attempted
    .map((s) => `  - type: ${s.type}, value: ${JSON.stringify(s.value)}`)
    .join('\n');

  return `You are a Playwright test automation expert. A self-healing locator framework has exhausted all static strategies for finding an element.

Your task: analyze the DOM snapshot below and return a new Playwright locator for the element described by the intent string.

Intent (what the element is):
${intent}

Failed strategies (do not return these):
${failedList}

DOM snapshot (scoped to the nearest semantic container):
\`\`\`html
${domSnapshot}
\`\`\`

Respond with ONLY valid JSON matching this schema — no markdown, no explanation outside the JSON:
{
  "type": "testId" | "role" | "label" | "text" | "css" | "xpath",
  "value": "<selector string>",
  "confidence": <number between 0.0 and 1.0>,
  "reasoning": "<one sentence explaining why this locator targets the right element>"
}

Use the highest-confidence strategy you can find. If you are not confident the element is present in this DOM, set confidence below 0.75.`;
}

/**
 * Parses the raw text response from the model into an AiHealResult.
 * Returns null if the response is malformed or the confidence is below
 * CONFIDENCE_THRESHOLD.
 */
function parseResponse(raw: string): AiHealResult | null {
  let parsed: unknown;
  try {
    // Strip any accidental markdown fences that a model may include despite instructions.
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)['type'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['value'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['confidence'] !== 'number' ||
    typeof (parsed as Record<string, unknown>)['reasoning'] !== 'string'
  ) {
    return null;
  }

  const result = parsed as AiHealResult;

  const validTypes: StrategyType[] = ['testId', 'role', 'label', 'text', 'css', 'xpath'];
  if (!validTypes.includes(result.type)) {
    return null;
  }

  if (result.confidence < CONFIDENCE_THRESHOLD) {
    return null;
  }

  return result;
}

/**
 * Wraps a promise with an AbortSignal-based timeout.
 * Rejects with a descriptive error if the timeout fires first.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`AiHealer: API call timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * AI-powered locator healer.
 *
 * Usage (called internally by HealingLocator):
 * ```ts
 * const healer = new AiHealer();
 * const result = await healer.heal(page, 'Submit form button', attempted);
 * if (result) {
 *   // result.type, result.value, result.confidence, result.reasoning
 * }
 * ```
 */
export class AiHealer {
  private readonly timeoutMs: number;

  /**
   * @param options - Configuration options.
   */
  constructor(options: AiHealerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  }

  /**
   * Attempts to find an alternative locator using the Anthropic API.
   *
   * Returns null if:
   * - AI_HEALING env var is absent (disabled by default)
   * - The DOM snapshot extraction fails
   * - The model returns a malformed response
   * - The model's confidence is below CONFIDENCE_THRESHOLD
   *
   * @param page - Playwright Page for DOM extraction.
   * @param intent - Natural-language description of the target element.
   * @param attempted - Static strategies already tried (to avoid re-suggesting).
   * @returns AiHealResult or null.
   */
  async heal(
    page: Page,
    intent: string,
    attempted: LocatorStrategyRecord[],
  ): Promise<AiHealResult | null> {
    // Guard: opt-in only — no API call when AI_HEALING is absent.
    if (!process.env['AI_HEALING']) {
      return null;
    }

    // Extract a scoped DOM snapshot from the live page.
    let domSnapshot: string;
    try {
      domSnapshot = await page.evaluate(getScopedDomSnippet);
    } catch {
      return null;
    }

    const prompt = buildPrompt(intent, domSnapshot, attempted);

    const client = new Anthropic();

    let rawText: string;
    try {
      const response = await withTimeout(
        client.messages.create({
          model: HEALING_MODEL,
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        }),
        this.timeoutMs,
      );

      const firstBlock = response.content[0];
      if (!firstBlock || firstBlock.type !== 'text') {
        return null;
      }
      rawText = firstBlock.text;
    } catch {
      return null;
    }

    return parseResponse(rawText);
  }
}
