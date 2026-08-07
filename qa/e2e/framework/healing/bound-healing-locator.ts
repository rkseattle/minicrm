/**
 * BoundHealingLocator — a thin wrapper around HealingLocator that captures
 * testName at construction time so callers never pass it on each call.
 *
 */

import type { HealingLocator } from './healing-locator.js';
import type { SafeLocator } from '../types/safe-locator.js';

export class BoundHealingLocator {
  constructor(
    private readonly inner: HealingLocator,
    private readonly testName: string,
  ) {}

  /**
   * Resolves the locator — testName is captured at construction, not passed here.
   *
   * @param timeout - Optional per-call probe budget. Callers that already know
   *   an element is slow to appear must be able to say so HERE, not only on the
   *   waitFor that follows: resolution probes each strategy against the default
   *   budget and throws StrategyExhaustedError when they all miss, so a generous
   *   waitFor timeout is never reached. That failure reads as selector drift
   *   when the truth is "not rendered yet".
   */
  async resolve(timeout?: number): Promise<SafeLocator> {
    return this.inner.resolve(this.testName, timeout);
  }

  /**
   * Shorthand: resolve and wait for the given element state.
   *
   * The timeout covers BOTH phases. Passing it only to waitFor was the bug
   * described on resolve() above — the element had to already be present within
   * the default probe budget for the longer wait to ever apply.
   */
  async waitFor(
    state: 'visible' | 'hidden' | 'attached' | 'detached',
    timeout?: number,
  ): Promise<void> {
    const locator = await this.resolve(timeout);
    await locator.waitFor({ state, timeout });
  }
}
