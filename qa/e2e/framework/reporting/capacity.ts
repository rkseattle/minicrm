/**
 * Runner-capacity-derived shard/worker count.
 *
 * Kept in framework/reporting/ alongside timing-utils.ts so framework-purity
 * checks see no app-domain strings here.
 *
 * Shard count and per-shard worker count were previously two hand-maintained
 * constants tuned once for GitHub's free-tier 2-vCPU runners (4 shards x 2
 * workers = 8 parallel test slots). This module re-derives both from a
 * measured per-runner CPU count, so parallelism scales automatically if this
 * pipeline ever runs on differently-sized runners (self-hosted, a larger
 * nightly box, etc), while reproducing today's exact values (4 shards, 2
 * workers) on today's exact runner (2 vCPUs) — verified in capacity.spec.ts.
 *
 * Model: every shard in a GitHub Actions matrix runs on an identically-sized
 * runner VM, so ONE capacity probe (run as its own CI step, on that runner
 * class) is representative of every shard's runner. Given that per-runner
 * CPU count, this module computes workers-per-shard first (capped — see
 * WORKERS_CAP), then derives shard count as however many shards are needed
 * to keep total parallel slots at TARGET_TOTAL_SLOTS. This keeps total
 * concurrency roughly constant across runner sizes rather than growing
 * unboundedly with core count.
 *
 * Local empirical testing (see docs/dev/e2e-performance.md) found the E2E
 * server container is a single-threaded Node process that saturates one core
 * regardless of client-side concurrency — CPU core count is therefore an
 * upper bound on useful per-shard worker parallelism, not a guarantee of it.
 * This module intentionally stays conservative (see WORKERS_CAP) rather than
 * scaling workers linearly with cores.
 */

import os from 'node:os';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CapacityPlan {
  /** Number of parallel shard jobs (matrix entries) to run. */
  shards: number;
  /** Number of Playwright workers per shard. */
  workers: number;
  /** How the plan was produced — surfaced for CI logging/debugging. */
  source: 'capacity-probe' | 'fallback';
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Known-good values if capacity can't be determined — the original hardcoded constants. */
export const FALLBACK_PLAN: Readonly<CapacityPlan> = Object.freeze({
  shards: 4,
  workers: 2,
  source: 'fallback',
});

/** Target total parallel Playwright test slots (shards x workers), matching
 *  the original baseline (4 shards x 2 workers) on a 2-vCPU runner. */
const TARGET_TOTAL_SLOTS = FALLBACK_PLAN.shards * FALLBACK_PLAN.workers;

/**
 * Upper bound on workers-per-shard regardless of detected CPU count.
 * The E2E server backing every shard is single-threaded (see module doc);
 * beyond a small number of concurrent workers, additional client-side
 * parallelism just queues requests rather than completing tests faster.
 */
const WORKERS_CAP = 4;

/** Lower bound — always at least 1 shard/worker even on a constrained probe result. */
const MIN_COUNT = 1;

// ── Capacity probe ───────────────────────────────────────────────────────────

/**
 * Returns the logical CPU core count for the current runner, or null if it
 * cannot be determined (os.cpus() throws or returns an empty array on some
 * constrained/sandboxed environments).
 */
export function detectCpuCount(): number | null {
  try {
    const cpus = os.cpus();
    if (!Array.isArray(cpus) || cpus.length === 0) return null;
    return cpus.length;
  } catch {
    return null;
  }
}

/**
 * Computes a CapacityPlan from a measured per-runner CPU count.
 *
 * Falls back to FALLBACK_PLAN (4 shards, 2 workers) if cpuCount is null or
 * not a positive integer — this is a strict improvement with no regression
 * risk. On the documented 2-vCPU GitHub free-tier runner this reproduces the
 * fallback values exactly (workers=min(WORKERS_CAP, 2)=2, shards=8/2=4),
 * verified in capacity.spec.ts.
 */
export function computeCapacityPlan(cpuCount: number | null): CapacityPlan {
  if (cpuCount === null || !Number.isInteger(cpuCount) || cpuCount < 1) {
    return { ...FALLBACK_PLAN };
  }

  const workers = Math.max(MIN_COUNT, Math.min(WORKERS_CAP, cpuCount));
  const shards = Math.max(MIN_COUNT, Math.round(TARGET_TOTAL_SLOTS / workers));

  return { shards, workers, source: 'capacity-probe' };
}

/** Convenience wrapper: probes the current runner and computes its plan. */
export function getCapacityPlan(): CapacityPlan {
  return computeCapacityPlan(detectCpuCount());
}
