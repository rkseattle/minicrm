/**
 * Public API for the self-healing locator framework (S2/S3, MINCRM-124, MINCRM-125).
 *
 * Import from this barrel rather than directly from individual files:
 *   import { HealingLocator, HealingRegistry, HealingReporter, AiHealer } from '@framework/healing';
 */

export {
  HealingLocator,
  StrategyExhaustedError,
  STRATEGY_ORDER,
  buildLocator,
} from './healing-locator.js';

export { BoundHealingLocator } from './bound-healing-locator.js';
export type { LocatorStrategy, StrategyType, HealingLocatorOptions } from './healing-locator.js';

export { HealingRegistry } from './healing-registry.js';
export type { HealEvent, LocatorStrategyRecord } from './healing-registry.js';

export { HealingReporter } from './healing-reporter.js';
export type { HealingReport } from './healing-reporter.js';

export { AiHealer, CONFIDENCE_THRESHOLD, DEFAULT_AI_TIMEOUT_MS } from './ai-healer.js';
export type { AiHealResult, AiHealerOptions } from './ai-healer.js';
