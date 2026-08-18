/**
 * Coverage/TIA agent SDK — the plugin contract a language-specific coverage
 * agent implements.
 *
 * A CoverageAgentPlugin wraps a single in-process coverage source (today,
 * only the backend's own V8 inspector session — see NodeV8CoverageAgent).
 * Coverage collected client-side (the frontend Istanbul agent)
 * has no server-side agent to control; it is pulled and submitted by the
 * E2E client itself. See docs/dev/coverage.md for the full backend/frontend
 * split, and docs/dev/coverage-tia-sdk.md for how to add a new language
 * agent against this contract.
 *
 * sdkVersion is pre-1.0 and internal-only — this module has no external
 * package consumers to protect, so a breaking change here is recorded as a
 * docs/dev/coverage.md changelog entry, not a major-version bump process.
 */

/** Pre-1.0, internal-only SDK version. Bump on any breaking change to CoverageAgentPlugin or AgentMetadata. */
export const SDK_VERSION = '0.1.0';

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
 * Identity/capability metadata a CoverageAgentPlugin reports about itself —
 * the piece The reference implementation" AC needs so a second
 * language's agent can be told apart from the first at runtime (logging,
 * future multi-agent registries), without the SDK itself needing to know
 * every language in advance.
 *
 * `id` is a free-form string, deliberately NOT typed as CoverageDumpSource:
 * CoverageDumpSource is a closed union because `coverage_units.agent` has a
 * real DB CHECK constraint on exactly 'node-v8' | 'browser-istanbul'
 * (qa/migrations/001_coverage_baseline.js), which per-tier reporting
 * (docs/dev/coverage.md) depends on staying closed. AgentMetadata.id has no
 * such constraint — it exists purely for runtime identity/logging — so a
 * new language agent can freely choose its own id here without touching
 * that union. Widening CoverageDumpSource itself (to let a new agent's
 * dumps actually persist into coverage_units under their own agent value)
 * is a separate, out-of-scope migration-level change — see
 * docs/dev/coverage-tia-sdk.md's "Adding a new language agent" section for
 * the honest scope of what "no core changes" covers here.
 */
export interface AgentMetadata {
  /** Stable identifier for this agent implementation, e.g. 'node-v8'. Free-form — NOT constrained to CoverageDumpSource (see above). */
  readonly id: string;
  /** Human-readable language/runtime this agent instruments, e.g. 'Node.js (V8)'. */
  readonly language: string;
  /** Display name for logs/UI, e.g. 'Node V8 Inspector Coverage Agent'. */
  readonly displayName: string;
}

/**
 * Common control surface every in-process coverage agent implements.
 * See the docs for the "uniform control API" requirement this mirrors,
 * and the plugin/SDK framing this contract now formalizes.
 */
export interface CoverageAgentPlugin {
  /** Identity/capability metadata for this agent implementation. */
  readonly metadata: AgentMetadata;

  /**
   * Clears accumulated coverage counters.
   *
   * V8's inspector API has no "clear without reading" primitive — for
   * NodeV8CoverageAgent this is implemented by reading and discarding. A
   * new language agent must document its own equivalent semantics.
   */
  reset(): Promise<void>;

  /**
   * Captures current counters and returns dump metadata without persisting
   * a full artifact to disk (cheap, for quick checks).
   *
   * NOTE for NodeV8CoverageAgent: V8's takePreciseCoverage() resets
   * counters as a side effect of reading them, so this call is NOT a
   * non-destructive read despite the name — see docs/dev/coverage.md. A new
   * language agent's own reset-on-read behavior (or lack of it) must be
   * documented in its AgentMetadata.language-specific docs.
   */
  snapshot(label: string): Promise<CoverageDump>;

  /** Captures current counters, writes a tagged artifact to disk, and resets. */
  dump(label: string): Promise<CoverageDump>;
}
