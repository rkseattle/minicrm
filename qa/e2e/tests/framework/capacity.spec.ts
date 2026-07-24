/**
 * Unit tests for the runner-capacity-derived shard/worker count module.
 *
 * Verifies:
 * 1. detectCpuCount() — returns a positive integer or null on failure
 * 2. computeCapacityPlan() — reproduces FALLBACK_PLAN exactly on today's 2-vCPU baseline
 * 3. computeCapacityPlan() — falls back on null/invalid input (no regression risk)
 * 4. computeCapacityPlan() — workers capped at WORKERS_CAP on large runners
 * 5. computeCapacityPlan() — shards/workers never below 1
 * 6. getCapacityPlan() — wires detectCpuCount() into computeCapacityPlan()
 *
 * MINCRM-662
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

test.describe('computeCapacityPlan — known-good baseline reproduction', () => {
  test('reproduces the pre-MINCRM-662 constants exactly on a 2-vCPU runner', () => {
    const plan = computeCapacityPlan(2);
    expect(plan).toEqual({ shards: 4, workers: 2, source: 'capacity-probe' });
  });

  test("2-vCPU result matches FALLBACK_PLAN's shard/worker values", () => {
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

test.describe('getCapacityPlan', () => {
  test('returns a plan derived from the real detected CPU count', () => {
    const plan = getCapacityPlan();
    expect(plan.shards).toBeGreaterThanOrEqual(1);
    expect(plan.workers).toBeGreaterThanOrEqual(1);
    expect(['capacity-probe', 'fallback']).toContain(plan.source);
  });
});
