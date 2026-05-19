/**
 * Unit tests for heal-trends.ts — cross-run heal count accumulator.
 *
 * Verifies:
 * 1. readTrends() returns empty object when file is absent.
 * 2. readTrends() returns empty object when file is malformed.
 * 3. mergeTrends() creates a new entry on first heal.
 * 4. mergeTrends() increments count on repeated heal of the same locator.
 * 5. mergeTrends() tracks multiple distinct locators independently.
 * 6. writeTrends() creates the output directory and writes valid JSON.
 * 7. writeTrends() + readTrends() round-trips correctly.
 * 8. quarantineCandidates() returns entries meeting or exceeding threshold.
 * 9. quarantineCandidates() excludes entries below threshold.
 * 10. buildTrendKey() uses Unknown/unknown defaults for absent pageObject/method.
 * 11. Full cross-run simulation: three consecutive onEnd() calls accumulate correctly.
 *
 * MINCRM-373
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readTrends,
  mergeTrends,
  writeTrends,
  quarantineCandidates,
  buildTrendKey,
} from '../../framework/healing/heal-trends.js';
import type { HealEvent } from '../../framework/healing/healing-registry.js';
import type { HealTrendEntry } from '../../framework/healing/heal-trends.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHealEvent(overrides: Partial<HealEvent> = {}): HealEvent {
  return {
    timestamp: new Date().toISOString(),
    testName: 'test',
    originalStrategy: { type: 'testId', value: 'save-btn' },
    healedStrategy: { type: 'role', value: 'button' },
    wasAiHeal: false,
    pageObject: 'ContactsPage',
    method: 'saveButton',
    ...overrides,
  };
}

/**
 * Runs a callback with cwd changed to tmpDir, then restores cwd.
 * heal-trends.ts uses `'test-results'` as a relative path so cwd determines
 * where the file lands.
 */
function withTmpDir<T>(tmpDir: string, fn: () => T): T {
  const original = process.cwd();
  process.chdir(tmpDir);
  try {
    return fn();
  } finally {
    process.chdir(original);
  }
}

// ---------------------------------------------------------------------------
// buildTrendKey
// ---------------------------------------------------------------------------

test.describe('buildTrendKey', () => {
  test('includes all four components in the key', () => {
    const event = makeHealEvent({
      pageObject: 'DealsPage',
      method: 'closeButton',
      originalStrategy: { type: 'testId', value: 'close-btn' },
    });
    const key = buildTrendKey(event);
    expect(key).toBe('DealsPage::closeButton::testId::close-btn');
  });

  test('uses "Unknown" default for absent pageObject', () => {
    const event = makeHealEvent({ pageObject: undefined });
    expect(buildTrendKey(event)).toMatch(/^Unknown::/);
  });

  test('uses "unknown" default for absent method', () => {
    const event = makeHealEvent({ method: undefined });
    expect(buildTrendKey(event)).toMatch(/::unknown::/);
  });
});

// ---------------------------------------------------------------------------
// readTrends
// ---------------------------------------------------------------------------

test.describe('readTrends', () => {
  test('returns empty object when heal-trends.json does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-trends-absent-'));
    try {
      const result = withTmpDir(tmpDir, () => readTrends());
      expect(result).toEqual({});
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('returns empty object when file content is malformed JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-trends-bad-json-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'test-results'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'test-results', 'heal-trends.json'), 'NOT JSON', 'utf-8');
      const result = withTmpDir(tmpDir, () => readTrends());
      expect(result).toEqual({});
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('returns empty object when file has no entries field', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-trends-no-entries-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'test-results'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'test-results', 'heal-trends.json'),
        JSON.stringify({ updatedAt: new Date().toISOString() }),
        'utf-8',
      );
      const result = withTmpDir(tmpDir, () => readTrends());
      expect(result).toEqual({});
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// mergeTrends
// ---------------------------------------------------------------------------

test.describe('mergeTrends', () => {
  test('creates a new entry on first heal', () => {
    const event = makeHealEvent({
      pageObject: 'ContactsPage',
      method: 'saveButton',
      originalStrategy: { type: 'testId', value: 'save-btn' },
    });
    const merged = mergeTrends({}, [event]);
    const key = buildTrendKey(event);
    expect(merged[key]).toBeDefined();
    expect(merged[key]!.count).toBe(1);
    expect(merged[key]!.pageObject).toBe('ContactsPage');
    expect(merged[key]!.method).toBe('saveButton');
  });

  test('increments count when the same locator heals again', () => {
    const event = makeHealEvent();
    const key = buildTrendKey(event);
    const existing: Record<string, HealTrendEntry> = {
      [key]: {
        pageObject: 'ContactsPage',
        method: 'saveButton',
        originalStrategyType: 'testId',
        originalStrategyValue: 'save-btn',
        count: 2,
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-02T00:00:00.000Z',
      },
    };
    const merged = mergeTrends(existing, [event]);
    expect(merged[key]!.count).toBe(3);
  });

  test('tracks multiple distinct locators independently', () => {
    const eventA = makeHealEvent({
      pageObject: 'ContactsPage',
      method: 'saveButton',
      originalStrategy: { type: 'testId', value: 'save-btn' },
    });
    const eventB = makeHealEvent({
      pageObject: 'DealsPage',
      method: 'closeButton',
      originalStrategy: { type: 'testId', value: 'close-btn' },
    });
    const merged = mergeTrends({}, [eventA, eventB]);
    expect(Object.keys(merged)).toHaveLength(2);
    expect(merged[buildTrendKey(eventA)]!.count).toBe(1);
    expect(merged[buildTrendKey(eventB)]!.count).toBe(1);
  });

  test('increments each occurrence when the same locator heals multiple times in one run', () => {
    const event = makeHealEvent();
    const key = buildTrendKey(event);
    // Same event appearing twice (e.g. test re-run within the same suite invocation)
    const merged = mergeTrends({}, [event, event]);
    expect(merged[key]!.count).toBe(2);
  });

  test('does not mutate entries that did not heal this run', () => {
    const unchangedKey = 'OtherPage::otherMethod::testId::other-btn';
    const existing: Record<string, HealTrendEntry> = {
      [unchangedKey]: {
        pageObject: 'OtherPage',
        method: 'otherMethod',
        originalStrategyType: 'testId',
        originalStrategyValue: 'other-btn',
        count: 5,
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const event = makeHealEvent(); // different key
    mergeTrends(existing, [event]);
    expect(existing[unchangedKey]!.count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// writeTrends + readTrends round-trip
// ---------------------------------------------------------------------------

test.describe('writeTrends + readTrends', () => {
  test('writes valid JSON and reads it back correctly', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-trends-write-'));
    try {
      const event = makeHealEvent({
        pageObject: 'LeadsPage',
        method: 'submitButton',
        originalStrategy: { type: 'testId', value: 'submit-btn' },
      });
      const key = buildTrendKey(event);
      const entries = mergeTrends({}, [event]);

      withTmpDir(tmpDir, () => {
        writeTrends(entries);
        const readBack = readTrends();
        expect(readBack[key]).toBeDefined();
        expect(readBack[key]!.count).toBe(1);
        expect(readBack[key]!.pageObject).toBe('LeadsPage');
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('creates the test-results directory when absent', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-trends-mkdir-'));
    try {
      expect(fs.existsSync(path.join(tmpDir, 'test-results'))).toBe(false);
      withTmpDir(tmpDir, () => writeTrends({}));
      expect(fs.existsSync(path.join(tmpDir, 'test-results', 'heal-trends.json'))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('written file includes updatedAt timestamp', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-trends-ts-'));
    try {
      withTmpDir(tmpDir, () => {
        writeTrends({});
        const raw = fs.readFileSync(path.join(tmpDir, 'test-results', 'heal-trends.json'), 'utf-8');
        const parsed = JSON.parse(raw) as { updatedAt: string };
        expect(() => new Date(parsed.updatedAt).toISOString()).not.toThrow();
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// quarantineCandidates
// ---------------------------------------------------------------------------

test.describe('quarantineCandidates', () => {
  function makeEntry(count: number): HealTrendEntry {
    return {
      pageObject: 'P',
      method: 'm',
      originalStrategyType: 'testId',
      originalStrategyValue: 'x',
      count,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    };
  }

  test('returns entries whose count equals the threshold', () => {
    const entries = { a: makeEntry(3) };
    const result = quarantineCandidates(entries, 3);
    expect(result).toHaveLength(1);
  });

  test('returns entries whose count exceeds the threshold', () => {
    const entries = { a: makeEntry(7) };
    const result = quarantineCandidates(entries, 3);
    expect(result).toHaveLength(1);
    expect(result[0]!.count).toBe(7);
  });

  test('excludes entries below threshold', () => {
    const entries = { a: makeEntry(2) };
    const result = quarantineCandidates(entries, 3);
    expect(result).toHaveLength(0);
  });

  test('returns empty array when all entries are below threshold', () => {
    const entries = { a: makeEntry(1), b: makeEntry(2) };
    expect(quarantineCandidates(entries, 3)).toEqual([]);
  });

  test('handles empty entries map', () => {
    expect(quarantineCandidates({}, 3)).toEqual([]);
  });

  test('mixes eligible and ineligible entries correctly', () => {
    const entries = {
      below: makeEntry(2),
      at: makeEntry(3),
      above: makeEntry(5),
    };
    const result = quarantineCandidates(entries, 3);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.count).sort((a, b) => a - b)).toEqual([3, 5]);
  });
});

// ---------------------------------------------------------------------------
// AC #2: three-run simulation — quarantine eligibility after 3 heals (MINCRM-373)
// ---------------------------------------------------------------------------

test.describe('cross-run simulation — quarantine eligibility (MINCRM-373 AC #2)', () => {
  test('locator healed 3 times across simulated runs appears in quarantine candidates', () => {
    const event = makeHealEvent({
      pageObject: 'AccountsPage',
      method: 'editButton',
      originalStrategy: { type: 'testId', value: 'edit-btn' },
    });
    const key = buildTrendKey(event);

    // Simulate 3 consecutive runs, each healing the same locator once.
    let trends: Record<string, HealTrendEntry> = {};
    trends = mergeTrends(trends, [event]);
    trends = mergeTrends(trends, [event]);
    trends = mergeTrends(trends, [event]);

    expect(trends[key]!.count).toBe(3);
    const candidates = quarantineCandidates(trends, 3);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.pageObject).toBe('AccountsPage');
    expect(candidates[0]!.method).toBe('editButton');
  });

  test('locator healed only 2 times is not yet quarantine-eligible', () => {
    const event = makeHealEvent();
    let trends: Record<string, HealTrendEntry> = {};
    trends = mergeTrends(trends, [event]);
    trends = mergeTrends(trends, [event]);
    expect(quarantineCandidates(trends, 3)).toHaveLength(0);
  });
});
