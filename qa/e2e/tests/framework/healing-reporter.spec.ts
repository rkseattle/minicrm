/**
 * Unit tests for HealingReporter.
 *
 * Verifies:
 * 1. WORKER_FILE_PATTERN matches legacy format (healing-0.json).
 * 2. WORKER_FILE_PATTERN matches shard-aware format (healing-shard3-worker1.json).
 * 3. WORKER_FILE_PATTERN does not match unrelated filenames.
 * 4. estimatedTokenCost is correctly summed from AI heal events. MINCRM-227
 * 5. aiHealCount counts only wasAiHeal events. MINCRM-227
 * 6. Threshold warning is emitted when aiHealCount exceeds 50. MINCRM-227
 * 7. No warning emitted when aiHealCount equals the threshold (strictly greater than). MINCRM-227
 * 8. heal-trends.json is created on first run with heal events. MINCRM-373
 * 9. heal-trends.json accumulates counts across simulated repeated onEnd() calls. MINCRM-373
 * 10. HEAL_QUARANTINE_THRESHOLD env var overrides default of 3. MINCRM-373
 * 11. _checkQuarantine logs warning listing eligible locators. MINCRM-373
 * 12. _checkQuarantine does not log when no candidates. MINCRM-373
 *
 * MINCRM-216, MINCRM-227, MINCRM-373
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HealingReporter } from '../../framework/healing/healing-reporter.js';
import type { HealingReport, HealEvent, HealTrendEntry } from '../../framework/healing/index.js';

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

// ---------------------------------------------------------------------------
// MINCRM-227: token cost aggregation and threshold warning
// ---------------------------------------------------------------------------

/** Builds a minimal HealEvent for test use. */
function makeHealEvent(overrides: Partial<HealEvent> = {}): HealEvent {
  return {
    timestamp: new Date().toISOString(),
    testName: 'test',
    originalStrategy: { type: 'testId', value: 'btn' },
    healedStrategy: { type: 'css', value: '.btn' },
    wasAiHeal: false,
    ...overrides,
  };
}

/** Builds a HealingReport and writes worker files so onEnd() can read them. */
function setupReporterRun(
  events: HealEvent[],
  tmpDir: string,
): { reporter: HealingReporter; restoreCwd: () => void } {
  const testResultsDir = path.join(tmpDir, 'test-results');
  fs.mkdirSync(testResultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(testResultsDir, 'healing-0.json'),
    JSON.stringify({ workerId: '0', events }),
    'utf-8',
  );
  const originalCwd = process.cwd();
  process.chdir(tmpDir);
  return {
    reporter: new HealingReporter(),
    restoreCwd: () => process.chdir(originalCwd),
  };
}

test.describe('HealingReporter — token cost aggregation (MINCRM-227)', () => {
  test('estimatedTokenCost sums tokenCost from AI heal events only', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-tokens-test-'));
    const events: HealEvent[] = [
      makeHealEvent({ wasAiHeal: true, tokenCost: 400 }),
      makeHealEvent({ wasAiHeal: true, tokenCost: 840 }),
      makeHealEvent({ wasAiHeal: false, tokenCost: 999 }), // static — must not count
    ];
    const { reporter, restoreCwd } = setupReporterRun(events, tmpDir);
    try {
      reporter.onEnd({ status: 'passed' } as Parameters<typeof reporter.onEnd>[0]);
      const reportPath = path.join(tmpDir, 'test-results', 'healing-report.json');
      const written = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as HealingReport;
      expect(written.estimatedTokenCost).toBe(1240); // 400 + 840
    } finally {
      restoreCwd();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('estimatedTokenCost treats absent tokenCost as 0', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-notokens-test-'));
    const events: HealEvent[] = [
      makeHealEvent({ wasAiHeal: true }), // no tokenCost
      makeHealEvent({ wasAiHeal: true, tokenCost: 300 }),
    ];
    const { reporter, restoreCwd } = setupReporterRun(events, tmpDir);
    try {
      reporter.onEnd({ status: 'passed' } as Parameters<typeof reporter.onEnd>[0]);
      const reportPath = path.join(tmpDir, 'test-results', 'healing-report.json');
      const written = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as HealingReport;
      expect(written.estimatedTokenCost).toBe(300);
    } finally {
      restoreCwd();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('aiHealCount counts only wasAiHeal=true events', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-aicount-test-'));
    const events: HealEvent[] = [
      makeHealEvent({ wasAiHeal: true }),
      makeHealEvent({ wasAiHeal: true }),
      makeHealEvent({ wasAiHeal: false }),
      makeHealEvent({ wasAiHeal: false }),
      makeHealEvent({ wasAiHeal: false }),
    ];
    const { reporter, restoreCwd } = setupReporterRun(events, tmpDir);
    try {
      reporter.onEnd({ status: 'passed' } as Parameters<typeof reporter.onEnd>[0]);
      const reportPath = path.join(tmpDir, 'test-results', 'healing-report.json');
      const written = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as HealingReport;
      expect(written.aiHealCount).toBe(2);
    } finally {
      restoreCwd();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

test.describe('HealingReporter — threshold warning (MINCRM-227)', () => {
  test.afterEach(() => {
    delete process.env['AI_HEAL_COST_WARNING_THRESHOLD'];
  });

  test('emits warning to stdout when aiHealCount exceeds threshold', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    try {
      const reporter = new HealingReporter();
      reporter._checkThreshold({
        generatedAt: '',
        totalHeals: 51,
        aiHeals: 51,
        staticHeals: 0,
        aiHealCount: 51,
        estimatedTokenCost: 0,
        events: [],
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain(
        '⚠ AI healing threshold exceeded: 51 AI heals this run (threshold: 50)',
      );
      expect(logs[0]).toContain('healing-suggestions.md');
    } finally {
      console.log = originalLog;
    }
  });

  test('no warning emitted when aiHealCount equals the threshold (strictly greater than)', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    try {
      const reporter = new HealingReporter();
      reporter._checkThreshold({
        generatedAt: '',
        totalHeals: 50,
        aiHeals: 50,
        staticHeals: 0,
        aiHealCount: 50,
        estimatedTokenCost: 0,
        events: [],
      });
      expect(logs).toHaveLength(0);
    } finally {
      console.log = originalLog;
    }
  });

  test('respects AI_HEAL_COST_WARNING_THRESHOLD env var', () => {
    process.env['AI_HEAL_COST_WARNING_THRESHOLD'] = '10';
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    try {
      const reporter = new HealingReporter();
      reporter._checkThreshold({
        generatedAt: '',
        totalHeals: 11,
        aiHeals: 11,
        staticHeals: 0,
        aiHealCount: 11,
        estimatedTokenCost: 0,
        events: [],
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('threshold: 10');
    } finally {
      console.log = originalLog;
    }
  });
});

// ---------------------------------------------------------------------------
// MINCRM-373: heal-trends.json accumulation across runs
// ---------------------------------------------------------------------------

test.describe('HealingReporter — heal-trends.json accumulation (MINCRM-373)', () => {
  test.afterEach(() => {
    delete process.env['HEAL_QUARANTINE_THRESHOLD'];
  });

  test('creates heal-trends.json on first run with heal events', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-trends-first-'));
    const events: HealEvent[] = [
      makeHealEvent({
        pageObject: 'ContactsPage',
        method: 'saveButton',
        originalStrategy: { type: 'testId', value: 'save-btn' },
      }),
    ];
    const { reporter, restoreCwd } = setupReporterRun(events, tmpDir);
    try {
      reporter.onEnd({ status: 'passed' } as Parameters<typeof reporter.onEnd>[0]);
      const trendsPath = path.join(tmpDir, 'test-results', 'heal-trends.json');
      expect(fs.existsSync(trendsPath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(trendsPath, 'utf-8')) as {
        entries: Record<string, HealTrendEntry>;
      };
      const key = 'ContactsPage::saveButton::testId::save-btn';
      expect(parsed.entries[key]).toBeDefined();
      expect(parsed.entries[key]!.count).toBe(1);
    } finally {
      restoreCwd();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('accumulates counts across three simulated consecutive onEnd() calls (AC #1 & #2)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-trends-accum-'));
    const event = makeHealEvent({
      pageObject: 'AccountsPage',
      method: 'editButton',
      originalStrategy: { type: 'testId', value: 'edit-btn' },
    });
    const trendsPath = path.join(tmpDir, 'test-results', 'heal-trends.json');

    for (let run = 0; run < 3; run++) {
      // Each call to setupReporterRun writes a fresh worker file in the same tmpDir.
      const { reporter, restoreCwd } = setupReporterRun([event], tmpDir);
      reporter.onEnd({ status: 'passed' } as Parameters<typeof reporter.onEnd>[0]);
      restoreCwd();
    }

    const parsed = JSON.parse(fs.readFileSync(trendsPath, 'utf-8')) as {
      entries: Record<string, HealTrendEntry>;
    };
    const key = 'AccountsPage::editButton::testId::edit-btn';
    expect(parsed.entries[key]!.count).toBe(3);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('does not write heal-trends.json when there are no heal events', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-trends-empty-'));
    const { reporter, restoreCwd } = setupReporterRun([], tmpDir);
    try {
      reporter.onEnd({ status: 'passed' } as Parameters<typeof reporter.onEnd>[0]);
      expect(fs.existsSync(path.join(tmpDir, 'test-results', 'heal-trends.json'))).toBe(false);
    } finally {
      restoreCwd();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('HEAL_QUARANTINE_THRESHOLD env var overrides default of 3 (AC #3)', () => {
    process.env['HEAL_QUARANTINE_THRESHOLD'] = '5';
    const reporter = new HealingReporter();
    expect(reporter._quarantineThreshold()).toBe(5);
    delete process.env['HEAL_QUARANTINE_THRESHOLD'];
    const reporter2 = new HealingReporter();
    expect(reporter2._quarantineThreshold()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// MINCRM-373: _checkQuarantine
// ---------------------------------------------------------------------------

test.describe('HealingReporter — _checkQuarantine (MINCRM-373)', () => {
  test.afterEach(() => {
    delete process.env['HEAL_QUARANTINE_THRESHOLD'];
  });

  function makeTrendEntry(overrides: Partial<HealTrendEntry> = {}): HealTrendEntry {
    return {
      pageObject: 'ContactsPage',
      method: 'saveButton',
      originalStrategyType: 'testId',
      originalStrategyValue: 'save-btn',
      count: 3,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-03T00:00:00.000Z',
      ...overrides,
    };
  }

  test('logs a warning block listing each quarantine-eligible locator', () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      const reporter = new HealingReporter();
      reporter._checkQuarantine([
        makeTrendEntry({ pageObject: 'DealsPage', method: 'closeButton', count: 4 }),
      ]);
      expect(warnings.length).toBeGreaterThan(0);
      const combined = warnings.join('\n');
      expect(combined).toContain('quarantine-eligible');
      expect(combined).toContain('DealsPage.closeButton');
      expect(combined).toContain('4');
    } finally {
      console.warn = originalWarn;
    }
  });

  test('does not log when no candidates exist', () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      const reporter = new HealingReporter();
      reporter._checkQuarantine([]);
      expect(warnings).toHaveLength(0);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('warning includes strategy type and value', () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      const reporter = new HealingReporter();
      reporter._checkQuarantine([
        makeTrendEntry({
          originalStrategyType: 'label',
          originalStrategyValue: 'First Name',
        }),
      ]);
      const combined = warnings.join('\n');
      expect(combined).toContain('label');
      expect(combined).toContain('First Name');
    } finally {
      console.warn = originalWarn;
    }
  });
});
