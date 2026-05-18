/**
 * perf-thresholds.ts — Absolute threshold definitions and assertion helpers.
 *
 * Design choice: absolute thresholds over a committed-baseline regression gate.
 *
 * A regression gate (compare against a baseline JSON committed to the repo)
 * sounds appealing but has two failure modes in practice:
 *   1. Baselines go stale: fast dev machines write baselines that slow CI
 *      containers can never match, causing permanent spurious failures.
 *   2. Baseline PRs: every perf improvement requires a separate "update baseline"
 *      PR that reviewers rubber-stamp without scrutiny.
 *
 * Absolute thresholds with conservative (CI-appropriate) values sidestep both
 * problems. The values here are intentionally generous — the goal is catching
 * regressions like 200ms → 2000ms, not enforcing Lighthouse scores.
 *
 * Thresholds are overridable via environment variables so CI can tighten or
 * loosen them without code changes during calibration.
 *
 */

// ---------------------------------------------------------------------------
// Threshold defaults
// ---------------------------------------------------------------------------

/** Conservative CI-appropriate thresholds. All values are in milliseconds
 *  unless noted. Set conservatively so variable CI load doesn't cause false
 *  positives — these catch order-of-magnitude regressions, not minor variance.
 */
export const DEFAULT_THRESHOLDS = {
  /**
   * Largest Contentful Paint. Google's "needs improvement" boundary is 4s;
   * we use 5s to account for cold CI containers.
   */
  lcpMs: 5_000,

  /**
   * Cumulative Layout Shift (score, not ms). Google's "needs improvement"
   * boundary is 0.25; we use 0.5 for CI tolerance.
   */
  clsScore: 0.5,

  /**
   * Time to First Byte for page navigation. 2s is generous but catches
   * server hangs or missing DB indexes.
   */
  ttfbMs: 2_000,

  /**
   * Interaction to Next Paint. Google's "needs improvement" boundary is 500ms;
   * we use 1000ms for CI tolerance.
   */
  inpMs: 1_000,

  /**
   * API response TTFB. Catches query regressions (200ms → 2000ms).
   * Conservative for CI — real target is ~200ms on warm DB.
   */
  apiTtfbMs: 3_000,
} as const;

export type ThresholdKey = keyof typeof DEFAULT_THRESHOLDS;

/** Resolved thresholds, merging defaults with env-var overrides. */
export interface ResolvedThresholds {
  lcpMs: number;
  clsScore: number;
  ttfbMs: number;
  inpMs: number;
  apiTtfbMs: number;
}

/**
 * Returns thresholds merged with optional env-var overrides.
 *
 * Environment variables (all optional):
 *   PERF_THRESHOLD_LCP_MS     — LCP threshold in ms
 *   PERF_THRESHOLD_CLS        — CLS score threshold
 *   PERF_THRESHOLD_TTFB_MS    — page TTFB threshold in ms
 *   PERF_THRESHOLD_INP_MS     — INP threshold in ms
 *   PERF_THRESHOLD_API_TTFB_MS — API TTFB threshold in ms
 */
export function resolveThresholds(overrides?: Partial<ResolvedThresholds>): ResolvedThresholds {
  const fromEnv = (key: string, defaultVal: number): number => {
    const raw = process.env[key];
    if (raw === undefined) return defaultVal;
    const parsed = Number(raw);
    return isNaN(parsed) ? defaultVal : parsed;
  };

  return {
    lcpMs: overrides?.lcpMs ?? fromEnv('PERF_THRESHOLD_LCP_MS', DEFAULT_THRESHOLDS.lcpMs),
    clsScore: overrides?.clsScore ?? fromEnv('PERF_THRESHOLD_CLS', DEFAULT_THRESHOLDS.clsScore),
    ttfbMs: overrides?.ttfbMs ?? fromEnv('PERF_THRESHOLD_TTFB_MS', DEFAULT_THRESHOLDS.ttfbMs),
    inpMs: overrides?.inpMs ?? fromEnv('PERF_THRESHOLD_INP_MS', DEFAULT_THRESHOLDS.inpMs),
    apiTtfbMs:
      overrides?.apiTtfbMs ?? fromEnv('PERF_THRESHOLD_API_TTFB_MS', DEFAULT_THRESHOLDS.apiTtfbMs),
  };
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/** A single threshold violation. */
export interface ThresholdViolation {
  metric: string;
  actual: number;
  threshold: number;
  message: string;
}

/**
 * Checks a set of Web Vitals against resolved thresholds.
 * Returns all violations found (empty array = pass).
 */
export function checkVitals(
  vitals: { lcp: number | null; cls: number | null; ttfb: number | null; inp: number | null },
  thresholds: ResolvedThresholds,
  scenario: string,
): ThresholdViolation[] {
  const violations: ThresholdViolation[] = [];

  if (vitals.lcp !== null && vitals.lcp > thresholds.lcpMs) {
    violations.push({
      metric: 'LCP',
      actual: vitals.lcp,
      threshold: thresholds.lcpMs,
      message: `[${scenario}] LCP ${vitals.lcp.toFixed(0)}ms exceeds threshold ${thresholds.lcpMs}ms`,
    });
  }

  if (vitals.cls !== null && vitals.cls > thresholds.clsScore) {
    violations.push({
      metric: 'CLS',
      actual: vitals.cls,
      threshold: thresholds.clsScore,
      message: `[${scenario}] CLS ${vitals.cls.toFixed(3)} exceeds threshold ${thresholds.clsScore}`,
    });
  }

  if (vitals.ttfb !== null && vitals.ttfb > thresholds.ttfbMs) {
    violations.push({
      metric: 'TTFB',
      actual: vitals.ttfb,
      threshold: thresholds.ttfbMs,
      message: `[${scenario}] TTFB ${vitals.ttfb.toFixed(0)}ms exceeds threshold ${thresholds.ttfbMs}ms`,
    });
  }

  if (vitals.inp !== null && vitals.inp > thresholds.inpMs) {
    violations.push({
      metric: 'INP',
      actual: vitals.inp,
      threshold: thresholds.inpMs,
      message: `[${scenario}] INP ${vitals.inp.toFixed(0)}ms exceeds threshold ${thresholds.inpMs}ms`,
    });
  }

  return violations;
}

/**
 * Checks API timings against the API TTFB threshold.
 * Returns all violations found (empty array = pass).
 */
export function checkApiTimings(
  timings: { url: string; ttfb: number }[],
  thresholds: ResolvedThresholds,
  scenario: string,
): ThresholdViolation[] {
  const violations: ThresholdViolation[] = [];

  for (const t of timings) {
    if (t.ttfb > thresholds.apiTtfbMs) {
      violations.push({
        metric: 'API_TTFB',
        actual: t.ttfb,
        threshold: thresholds.apiTtfbMs,
        message: `[${scenario}] API TTFB ${t.ttfb.toFixed(0)}ms for ${t.url} exceeds threshold ${thresholds.apiTtfbMs}ms`,
      });
    }
  }

  return violations;
}
