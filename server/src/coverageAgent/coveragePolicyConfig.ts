/**
 * Coverage/TIA central policy configuration. (MINCRM-637)
 *
 * Aggregates the framework's scattered config surface — granularity,
 * retention, and safety-net thresholds — behind one resolve-once-at-boot
 * function, mirroring coverageConfig.ts's own "resolve once, pass the
 * result down, never re-read process.env per request" precedent
 * (resolveCoverageConfig). Feature-flag state (coverage_pipeline_ingestion,
 * coverage_mapping_query, coverage_reporting_query) is NOT included here —
 * those are per-request DB reads via requireFeatureEnabled, not boot-time
 * env config, and stay where they are.
 *
 * See docs/dev/coverage.md's "Policy Configuration" section for the full
 * table of every env var this resolves.
 */

import { resolveCoverageConfig } from './coverageConfig.js';
import type { CoverageConfig, CoverageGranularity } from './coverageConfig.js';

/**
 * Retention window default, in days. No prior default existed to inherit —
 * coverageModelService.pruneCoverageUnits has always required an explicit
 * argument, with zero production callers before this phase wired up
 * scheduled pruning. Chosen to match webhook_delivery_logs' 30-day window
 * (docs/dev/retention.md) — the shortest existing retention precedent in
 * this repo, and the closest match in kind to coverage/TIA data: disposable,
 * write-heavy, CI-tooling-consumed telemetry with no compliance/audit
 * retention requirement (see docs/dev/coverage.md's "Coverage Database"
 * section).
 */
const DEFAULT_RETENTION_DAYS = 30;

/** Below this confidence, a matched unit is untrustworthy — see safetyNetPolicy.ts. */
const DEFAULT_MIN_CONFIDENCE_THRESHOLD = 0.3;

/** Fraction of unmapped changed units tolerated before targeted mode is distrusted — see safetyNetPolicy.ts. */
const DEFAULT_MAX_UNMAPPED_RATIO = 0.5;

export interface CoveragePolicy {
  /** V8 coverage detail level. */
  granularity: CoverageGranularity;
  /** Commit/build SHA to tag dumps with. */
  commitSha: string;
  /** Days a coverage_units/coverage_test_links row survives without being touched before scheduled pruning removes it. */
  retentionDays: number;
  /** Safety-net confidence floor — see safetyNetPolicy.ts's own SafetyNetPolicyOptions.minConfidenceThreshold. */
  minConfidenceThreshold: number;
  /** Safety-net unmapped-ratio ceiling — see safetyNetPolicy.ts's own SafetyNetPolicyOptions.maxUnmappedRatio. */
  maxUnmappedRatio: number;
}

// Trimmed before the blank check, not just checked with a bare `!raw` —
// Number(' ')/Number('\t')/Number('\n') all coerce to 0, which is a
// "valid" (in-range) input to every resolver below. An untrimmed check
// would let a whitespace-only env value (a trailing space after `=` in a
// .env file, or a blank-resolving CI secret) silently coerce to 0 instead
// of falling back to the default — for the two threshold resolvers below,
// 0 is inside their valid [0, 1] range and would pass straight through,
// silently neutering the safety net this module exists to protect (found
// via Greptile branch review).
function readTrimmedEnv(key: string): string | undefined {
  const raw = process.env[key]?.trim();
  return raw ? raw : undefined;
}

function resolveRetentionDays(): number {
  const raw = readTrimmedEnv('COVERAGE_RETENTION_DAYS');
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  // Integer only — "days a row survives" implies a whole number, and a
  // fractional value would silently flow into pruneCoverageUnits' own
  // `$1 * interval '1 day'` SQL expression as a fractional-day interval.
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

/**
 * Both thresholds below are fractions/scores that only mean something in
 * [0, 1] — safetyNetPolicy.ts's own hasLowConfidenceMatch and unmappedRatio
 * checks compare directly against these values. A misconfigured env var
 * outside that range wouldn't just be a bad number, it would silently
 * neuter the safety net this ticket exists to make configurable: a negative
 * minConfidenceThreshold makes hasLowConfidenceMatch's `< threshold` check
 * never trigger, and a maxUnmappedRatio > 1 makes the unmapped-ratio
 * fallback never trigger (unmappedRatio() can never itself exceed 1). Both
 * therefore fall back to the default the same way an unparseable value
 * already does, rather than silently accepting an out-of-range number.
 */
function isValidUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function resolveMinConfidenceThreshold(): number {
  const raw = readTrimmedEnv('TIA_MIN_CONFIDENCE_THRESHOLD');
  if (!raw) return DEFAULT_MIN_CONFIDENCE_THRESHOLD;
  const parsed = Number(raw);
  return isValidUnitInterval(parsed) ? parsed : DEFAULT_MIN_CONFIDENCE_THRESHOLD;
}

function resolveMaxUnmappedRatio(): number {
  const raw = readTrimmedEnv('TIA_MAX_UNMAPPED_RATIO');
  if (!raw) return DEFAULT_MAX_UNMAPPED_RATIO;
  const parsed = Number(raw);
  return isValidUnitInterval(parsed) ? parsed : DEFAULT_MAX_UNMAPPED_RATIO;
}

/**
 * Resolves the full Coverage/TIA policy from the current environment. Call
 * once at boot (server.ts) or once at script start (select-tests.ts) and
 * pass the result down — do not re-read process.env per request/call.
 *
 * Accepts an already-resolved CoverageConfig rather than always calling
 * resolveCoverageConfig() itself — that call shells out to `git rev-parse
 * HEAD` (coverageConfig.ts's resolveCommitSha), and server.ts already
 * resolves a CoverageConfig of its own a few lines above this call; without
 * the parameter, boot would shell out to git twice for the same commitSha
 * (found via Greptile branch review). select-tests.ts has no CoverageConfig
 * of its own to pass, so the default keeps that call site a single
 * resolution, same as before.
 */
export function resolveCoveragePolicy(
  config: CoverageConfig = resolveCoverageConfig(),
): CoveragePolicy {
  const { granularity, commitSha } = config;
  return {
    granularity,
    commitSha,
    retentionDays: resolveRetentionDays(),
    minConfidenceThreshold: resolveMinConfidenceThreshold(),
    maxUnmappedRatio: resolveMaxUnmappedRatio(),
  };
}
