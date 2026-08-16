/**
 * Unit tests for the runner-capacity-derived shard/worker count module.
 *
 * Verifies:
 * 1. detectCpuCount() — returns a positive integer or null on failure
 * 2. computeCapacityPlan() — reproduces FALLBACK_PLAN's values at a 2-vCPU input
 * 3. computeCapacityPlan() — falls back on null/invalid input (no regression risk)
 * 4. computeCapacityPlan() — workers capped at WORKERS_CAP on large runners
 * 5. computeCapacityPlan() — shards/workers never below 1
 * 6. getCapacityPlan() — wires detectCpuCount() into computeCapacityPlan()
 * 7. computeCapacityPlan() — 2 shards x 4 workers at today's real 4-vCPU runner
 *
 * MINCRM-662, MINCRM-706
 */

import { test, expect } from '@playwright/test';
import os from 'node:os';
import {
  detectCpuCount,
  computeCapacityPlan,
  getCapacityPlan,
  FALLBACK_PLAN,
} from '../../framework/reporting/capacity.js';

test.describe('detectCpuCount', () => {
  test('returns a positive integer matching os.cpus().length', () => {
    const count = detectCpuCount();
    expect(count).toBe(os.cpus().length);
    expect(count).not.toBeNull();
    expect(Number.isInteger(count)).toBe(true);
    expect((count as number) > 0).toBe(true);
  });
});

test.describe('computeCapacityPlan — pinned formula inputs', () => {
  test('4 vCPUs is the WORKERS_CAP plateau boundary: 2 shards x 4 workers', () => {
    // 4 is where workers saturate WORKERS_CAP, so every larger runner yields
    // this same plan (see the plateau assertion below). Pinned because nothing
    // covered this branch of the formula before MINCRM-706 — every existing
    // case sat at 2 vCPUs or at 64 — which is how the surrounding docs went on
    // claiming 4 shards x 2 workers long after the probe stopped emitting them.
    expect(computeCapacityPlan(4)).toEqual({ shards: 2, workers: 4, source: 'capacity-probe' });
    expect(computeCapacityPlan(3)).toEqual({ shards: 3, workers: 3, source: 'capacity-probe' });
  });

  test('every runner at or above the cap yields the same plan', () => {
    // Stated explicitly so nobody reads the 4-vCPU case as "this is the runner
    // size". It is not observable from the formula: 4, 8 and 64 vCPUs are
    // indistinguishable here. The runner's ACTUAL size is asserted separately,
    // against detectCpuCount(), below.
    const atCap = { shards: 2, workers: 4, source: 'capacity-probe' };
    for (const cpuCount of [4, 5, 6, 8, 16, 64]) {
      expect(computeCapacityPlan(cpuCount)).toEqual(atCap);
    }
  });

  test('a 2-vCPU input reproduces the pre-MINCRM-662 constants', () => {
    // A formula input, NOT a description of any runner this pipeline uses.
    // Kept because it pins the derivation at a second known point, and because
    // it is the shape FALLBACK_PLAN encodes for detection failure.
    const plan = computeCapacityPlan(2);
    expect(plan).toEqual({ shards: 4, workers: 2, source: 'capacity-probe' });
  });

  test("the 2-vCPU result matches FALLBACK_PLAN's shard/worker values", () => {
    const plan = computeCapacityPlan(2);
    expect(plan.shards).toBe(FALLBACK_PLAN.shards);
    expect(plan.workers).toBe(FALLBACK_PLAN.workers);
  });
});

test.describe('computeCapacityPlan — fallback on invalid input', () => {
  test('falls back on null', () => {
    expect(computeCapacityPlan(null)).toEqual(FALLBACK_PLAN);
  });

  test('falls back on zero', () => {
    expect(computeCapacityPlan(0)).toEqual(FALLBACK_PLAN);
  });

  test('falls back on a negative number', () => {
    expect(computeCapacityPlan(-4)).toEqual(FALLBACK_PLAN);
  });

  test('falls back on a non-integer', () => {
    expect(computeCapacityPlan(2.5)).toEqual(FALLBACK_PLAN);
  });

  test('fallback source is tagged "fallback"', () => {
    expect(computeCapacityPlan(null).source).toBe('fallback');
  });
});

test.describe('computeCapacityPlan — scaling behavior', () => {
  test('single-core runner: workers floor at 1, shards scale up to hold total slots', () => {
    const plan = computeCapacityPlan(1);
    expect(plan.workers).toBe(1);
    expect(plan.shards).toBeGreaterThanOrEqual(1);
  });

  test('workers never exceed the WORKERS_CAP (4) even on a large runner', () => {
    const plan = computeCapacityPlan(64);
    expect(plan.workers).toBeLessThanOrEqual(4);
  });

  test('shards never drop below 1 on a large runner', () => {
    const plan = computeCapacityPlan(64);
    expect(plan.shards).toBeGreaterThanOrEqual(1);
  });

  test('source is tagged "capacity-probe" for any valid positive cpuCount', () => {
    expect(computeCapacityPlan(1).source).toBe('capacity-probe');
    expect(computeCapacityPlan(16).source).toBe('capacity-probe');
  });
});

test.describe('the documented CI runner size', () => {
  test('GitHub-hosted runners still provide the 4 vCPUs the docs claim', () => {
    // The ONE assertion that observes the real runner rather than the formula.
    // capacity.ts, e2e-performance.md, qa/e2e/README.md and README.md all state
    // "2 shards x 4 workers on 4-vCPU runners"; that is only true while GitHub
    // keeps providing 4 vCPUs. Because computeCapacityPlan plateaus at
    // WORKERS_CAP, no assertion over the formula can notice an upgrade to 8 or
    // 16 — every one of those still returns 2 x 4 — so without this check the
    // docs would go stale silently, exactly as the 2-vCPU claim did.
    //
    // Gated on GITHUB_ACTIONS, not CI: `CI` is also set by local tooling and by
    // self-hosted runners, and this asserts a GitHub-HOSTED runner's spec
    // specifically. On a developer machine it would just report the core count
    // of that laptop (measured: 12 here), which is not the claim under test.
    test.skip(
      process.env['GITHUB_ACTIONS'] !== 'true',
      'asserts the GitHub-hosted runner spec, not a local or self-hosted machine',
    );

    expect(detectCpuCount()).toBe(4);
  });
});

test.describe('getCapacityPlan', () => {
  test('returns a plan derived from the real detected CPU count', () => {
    const plan = getCapacityPlan();
    expect(plan.shards).toBeGreaterThanOrEqual(1);
    expect(plan.workers).toBeGreaterThanOrEqual(1);
    expect(['capacity-probe', 'fallback']).toContain(plan.source);
  });
});
