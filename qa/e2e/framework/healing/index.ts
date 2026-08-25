/**
 * Public API for the self-healing locator framework.
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
export type { SafeLocator } from '../types/safe-locator.js';

export { HealingRegistry } from './healing-registry.js';
export type { HealEvent, LocatorStrategyRecord } from './healing-registry.js';

export { HealingReporter } from './healing-reporter.js';
export type { HealingReport } from './healing-reporter.js';

export { AiHealer, CONFIDENCE_THRESHOLD, DEFAULT_AI_TIMEOUT_MS } from './ai-healer.js';
export type { AiHealResult, AiHealerOptions } from './ai-healer.js';

export { generatePatchSuggestions } from './patch-suggester.js';
export type { PatchSuggestion } from './patch-suggester.js';

export {
  readTrends,
  mergeTrends,
  writeTrends,
  quarantineCandidates,
  quarantineThreshold,
  quarantineMaxAgeDays,
  DEFAULT_QUARANTINE_THRESHOLD,
  DEFAULT_QUARANTINE_MAX_AGE_DAYS,
  buildTrendKey,
} from './heal-trends.js';
export type { HealTrendEntry, HealTrendsFile } from './heal-trends.js';

export { inferCallSite } from './call-site-inferrer.js';
export type { CallSite } from './call-site-inferrer.js';
