/**
 * Coverage/TIA instrumentation types shared by every coverage agent. (MINCRM-604, MINCRM-606)
 *
 * A CoverageAgent wraps a single in-process coverage source (currently only
 * the backend's own V8 inspector session — see NodeV8CoverageAgent). Coverage
 * collected client-side (the frontend Istanbul agent, MINCRM-605) has no
 * server-side agent to control; it is pulled and submitted by the E2E client
 * itself. See docs/dev/coverage.md for the full backend/frontend split.
 */

/** Coverage payload origin. 'browser' dumps are ingested, not agent-produced. */
export type CoverageDumpSource = 'node-v8' | 'browser-istanbul';

/** Raw coverage payload format, distinct from the dump source for clarity. */
export type CoverageDumpFormat = 'v8-script-coverage' | 'istanbul';

/** Metadata describing a single persisted coverage dump. */
export interface CoverageDump {
  /** Stable identifier for this dump, generated at persist time. */
  dumpId: string;
  /** Which agent produced this dump. */
  agent: CoverageDumpSource;
  /** Caller-supplied label, e.g. a test name or 'shutdown'. */
  label: string;
  /** Commit/build SHA the dump was captured under. */
  commitSha: string;
  /** ISO-8601 timestamp of capture. */
  capturedAt: string;
  /** Raw payload format. */
  format: CoverageDumpFormat;
  /** Path to the raw payload file, relative to the dumps root. */
  path: string;
}

/**
 * Common control surface every in-process coverage agent implements.
 * See MINCRM-606 for the "uniform control API" requirement this mirrors.
 */
export interface CoverageAgent {
  /**
   * Clears accumulated coverage counters.
   *
   * V8's inspector API has no "clear without reading" primitive — for
   * NodeV8CoverageAgent this is implemented by reading and discarding.
   */
  reset(): Promise<void>;

  /**
   * Captures current counters and returns dump metadata without persisting
   * a full artifact to disk (cheap, for quick checks).
   *
   * NOTE: V8's takePreciseCoverage() resets counters as a side effect of
   * reading them, so this call is NOT a non-destructive read despite the
   * name — see docs/dev/coverage.md for the full caveat.
   */
  snapshot(label: string): Promise<CoverageDump>;

  /** Captures current counters, writes a tagged artifact to disk, and resets. */
  dump(label: string): Promise<CoverageDump>;
}
