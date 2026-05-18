/**
 * Public API barrel for the performance framework layer.
 */

export { injectWebVitals, collectWebVitals, startApiTimingCollection } from './perf-metrics.js';
export type { WebVitals, ApiTiming, PerfSample } from './perf-metrics.js';

export {
  resolveThresholds,
  checkVitals,
  checkApiTimings,
  DEFAULT_THRESHOLDS,
} from './perf-thresholds.js';
export type { ResolvedThresholds, ThresholdViolation } from './perf-thresholds.js';

export { PerfRegistry } from './perf-registry.js';

export { test as perfTest } from './perf-fixture.js';
export type { PerfFixtures, MeasurePerfOptions, MeasurePerfResult } from './perf-fixture.js';

export { PerfReporter } from './perf-reporter.js';
export type { PerfReport } from './perf-reporter.js';
