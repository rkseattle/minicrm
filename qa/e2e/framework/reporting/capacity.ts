/**
 * Runner-capacity-derived shard/worker count.
 *
 * Kept in framework/reporting/ alongside timing-utils.ts so framework-purity
 * checks see no app-domain strings here.
 *
 * Shard count and per-shard worker count were previously two hand-maintained
 * constants, tuned once for a 2-vCPU runner (4 shards x 2 workers = 8 parallel
 * test slots). This module re-derives both from a measured per-runner CPU
 * count, so parallelism scales automatically across differently-sized runners
 * (self-hosted, a larger nightly box, etc) without manual retuning.
 *
 * On GitHub-hosted ubuntu-latest runners — 4 vCPUs as of 2026-08, verified from
 * run 31962366377's probe output `{"shards":2,"workers":4}` — that yields
 * 2 shards x 4 workers, not the 4 x 2 the original constants encoded. The 4 x 2
 * pair survives only as FALLBACK_PLAN, for when detection fails.
 *
 * That runner size is asserted directly in capacity.spec.ts, under CI. It has to
 * be: this formula plateaus at WORKERS_CAP, so 4, 8 and 64 vCPUs all produce the
 * same plan, and no assertion over the formula alone would notice a runner
 * upgrade making the figures above stale again.
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

/**
 * Values used when CPU count cannot be determined — the pre-probe
 * hardcoded constants, retained as a DETECTION-FAILURE fallback rather than as
 * a description of any current runner.
 *
 * Same TOTAL concurrency as any probed plan (8 slots) — it is not more
 * conservative overall, just differently distributed: fewer workers per shard,
 * more shards. That is the right shape when the machine could not be measured,
 * since per-shard load on the single-threaded test server is the thing an
 * unknown runner might not sustain.
 */
export const FALLBACK_PLAN: Readonly<CapacityPlan> = Object.freeze({
  shards: 4,
  workers: 2,
  source: 'fallback',
});

/** Target total parallel Playwright test slots (shards x workers), carried
 *  forward from the pre-probe baseline (4 shards x 2 workers). Held
 *  constant across runner sizes, so more cores buy wider shards, not more
 *  total concurrency. */
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
 * Falls back to FALLBACK_PLAN if cpuCount is null or not a positive integer.
 *
 * Worked examples, both pinned in capacity.spec.ts:
 *   - 4 vCPUs (today's GitHub-hosted ubuntu-latest): workers=min(4, 4)=4,
 *     shards=round(8/4)=2 → 2 shards x 4 workers.
 *   - 2 vCPUs (a formula input, not a runner this pipeline uses today):
 *     workers=min(4, 2)=2, shards=round(8/2)=4 → reproduces FALLBACK_PLAN.
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
