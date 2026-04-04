/**
 * Public API for the self-healing locator framework (S2, MINCRM-124).
 *
 * Import from this barrel rather than directly from individual files:
 *   import { HealingLocator, HealingRegistry, HealingReporter } from '@framework/healing';
 */

export { HealingLocator, StrategyExhaustedError, STRATEGY_ORDER } from './healing-locator.js';
export type { LocatorStrategy, StrategyType, HealingLocatorOptions } from './healing-locator.js';

export { HealingRegistry } from './healing-registry.js';
export type { HealEvent, LocatorStrategyRecord } from './healing-registry.js';

export { HealingReporter } from './healing-reporter.js';
export type { HealingReport } from './healing-reporter.js';
