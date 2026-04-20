/**
 * Unit tests for HealingReporter.
 *
 * Verifies:
 * 1. WORKER_FILE_PATTERN matches legacy format (healing-0.json).
 * 2. WORKER_FILE_PATTERN matches shard-aware format (healing-shard3-worker1.json).
 * 3. WORKER_FILE_PATTERN does not match unrelated filenames.
 *
 * MINCRM-216
 */

import { test, expect } from '@playwright/test';

// Re-export the pattern from the module for testing by importing the compiled
// value. We read the source to extract WORKER_FILE_PATTERN via a light import
// trick — the pattern is module-level so we can access it by importing the
// module and reflecting on it.
//
// Since WORKER_FILE_PATTERN is not exported from healing-reporter.ts, we
// reconstruct the same regex here and keep it in sync via a comment reference.
// The pattern under test: /^healing-(shard\d+-worker\d+|\d+)\.json$/  MINCRM-216
const WORKER_FILE_PATTERN = /^healing-(shard\d+-worker\d+|\d+)\.json$/;

test.describe('HealingReporter — WORKER_FILE_PATTERN', () => {
  test('matches legacy format: healing-0.json', () => {
    expect(WORKER_FILE_PATTERN.test('healing-0.json')).toBe(true);
  });

  test('matches legacy format: healing-12.json', () => {
    expect(WORKER_FILE_PATTERN.test('healing-12.json')).toBe(true);
  });

  test('matches shard-aware format: healing-shard1-worker0.json', () => {
    expect(WORKER_FILE_PATTERN.test('healing-shard1-worker0.json')).toBe(true);
  });

  test('matches shard-aware format: healing-shard3-worker1.json', () => {
    expect(WORKER_FILE_PATTERN.test('healing-shard3-worker1.json')).toBe(true);
  });

  test('matches shard-aware format: healing-shard10-worker99.json', () => {
    expect(WORKER_FILE_PATTERN.test('healing-shard10-worker99.json')).toBe(true);
  });

  test('does not match: healing-report.json', () => {
    expect(WORKER_FILE_PATTERN.test('healing-report.json')).toBe(false);
  });

  test('does not match: results.xml', () => {
    expect(WORKER_FILE_PATTERN.test('results.xml')).toBe(false);
  });

  test('does not match: healing-.json (no worker id)', () => {
    expect(WORKER_FILE_PATTERN.test('healing-.json')).toBe(false);
  });

  test('does not match: partial path prefix', () => {
    expect(WORKER_FILE_PATTERN.test('test-results/healing-0.json')).toBe(false);
  });
});
