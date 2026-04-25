/**
 * BoundHealingLocator — a thin wrapper around HealingLocator that captures
 * testName at construction time so callers never pass it on each call.
 *
 * MINCRM-209
 */

import type { HealingLocator } from './healing-locator.js';
import type { SafeLocator } from '../types/safe-locator.js';

export class BoundHealingLocator {
  constructor(
    private readonly inner: HealingLocator,
    private readonly testName: string,
  ) {}

  /** Resolves the locator — testName is captured at construction, not passed here. */
  async resolve(): Promise<SafeLocator> {
    return this.inner.resolve(this.testName);
  }

  /** Shorthand: resolve and wait for the given element state. */
  async waitFor(
    state: 'visible' | 'hidden' | 'attached' | 'detached',
    timeout?: number,
  ): Promise<void> {
    const locator = await this.resolve();
    await locator.waitFor({ state, timeout });
  }
}
