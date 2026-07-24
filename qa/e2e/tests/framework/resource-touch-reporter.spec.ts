/**
 * Unit tests for BaseResourceTouchReporter and its JSONL helpers.
 *
 * Verifies:
 * 1. appendResourceTouchRecord/readResourceTouchRecords round-trip
 * 2. readResourceTouchRecords skips malformed lines and returns [] for a missing file
 * 3. onTestEnd — records a match returned by a subclass's lookup
 * 4. onTestEnd — writes nothing when the lookup returns null (untracked test)
 * 5. onTestEnd — skips non-final retry attempts, records the final attempt only
 * 6. RESOURCE_TOUCH_JSONL_PATH env var overrides the default output path
 *
 * MINCRM-661
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendResourceTouchRecord,
  readResourceTouchRecords,
} from '../../framework/reporting/resource-touch-utils.js';
import type {
  ResourceTouchRecord,
  ResourceTouchLookup,
} from '../../framework/reporting/resource-touch-utils.js';
import { BaseResourceTouchReporter } from '../../framework/reporting/resource-touch-reporter.js';
import type { FullConfig, TestCase, TestResult } from '@playwright/test/reporter';

// ---------------------------------------------------------------------------
// Minimal stub factories
// ---------------------------------------------------------------------------

function makeTestCase(overrides: {
  file?: string;
  titlePath?: string[];
  retries?: number;
}): TestCase {
  const titlePath = overrides.titlePath ?? ['a test'];
  return {
    location: {
      file: overrides.file ?? '/repo/qa/e2e/tests/apps/minicrm/functional/foo.spec.ts',
      line: 1,
      column: 0,
    },
    retries: overrides.retries ?? 0,
    titlePath: () => titlePath,
  } as unknown as TestCase;
}

function makeResult(overrides: { status: TestResult['status']; retry?: number }): TestResult {
  return {
    status: overrides.status,
    retry: overrides.retry ?? 0,
  } as unknown as TestResult;
}

function makeConfig(): FullConfig {
  return {} as unknown as FullConfig;
}

/** Minimal concrete subclass for testing the abstract base class. */
class TestReporter extends BaseResourceTouchReporter {
  protected lookup: ResourceTouchLookup;

  constructor(lookup: ResourceTouchLookup) {
    super();
    this.lookup = lookup;
  }
}

// ---------------------------------------------------------------------------
// JSONL helpers
// ---------------------------------------------------------------------------

test.describe('resource-touch-utils — JSONL round-trip', () => {
  test('appendResourceTouchRecord then readResourceTouchRecords returns the same record', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-touch-test-'));
    try {
      const filePath = path.join(tmpDir, 'resource-touch.jsonl');
      const record: ResourceTouchRecord = {
        runId: 123,
        file: 'qa/e2e/tests/apps/minicrm/functional/foo.spec.ts',
        title: 'a test',
        reads: ['settings.nav_layout'],
        writes: ['settings.nav_layout'],
        ts: '2026-01-01T00:00:00.000Z',
      };
      appendResourceTouchRecord(filePath, record);
      const read = readResourceTouchRecords(filePath);
      expect(read).toEqual([record]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('appends multiple records across calls', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-touch-test-'));
    try {
      const filePath = path.join(tmpDir, 'resource-touch.jsonl');
      const base: Omit<ResourceTouchRecord, 'title'> = {
        runId: 1,
        file: 'a.spec.ts',
        reads: [],
        writes: [],
        ts: '2026-01-01T00:00:00.000Z',
      };
      appendResourceTouchRecord(filePath, { ...base, title: 'first' });
      appendResourceTouchRecord(filePath, { ...base, title: 'second' });
      const read = readResourceTouchRecords(filePath);
      expect(read.map((r) => r.title)).toEqual(['first', 'second']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('readResourceTouchRecords returns [] for a missing file', () => {
    expect(readResourceTouchRecords('/nonexistent/path/resource-touch.jsonl')).toEqual([]);
  });

  test('readResourceTouchRecords skips malformed lines', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-touch-test-'));
    try {
      const filePath = path.join(tmpDir, 'resource-touch.jsonl');
      fs.writeFileSync(
        filePath,
        '{"runId":1,"file":"a.spec.ts","title":"ok","reads":[],"writes":[],"ts":"2026-01-01T00:00:00.000Z"}\n' +
          'not valid json\n' +
          '\n',
        'utf-8',
      );
      const read = readResourceTouchRecords(filePath);
      expect(read).toHaveLength(1);
      expect(read[0]?.title).toBe('ok');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// BaseResourceTouchReporter
// ---------------------------------------------------------------------------

test.describe('BaseResourceTouchReporter — onTestEnd', () => {
  test('records a match returned by the subclass lookup', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-touch-reporter-'));
    try {
      const jsonlPath = path.join(tmpDir, 'resource-touch.jsonl');
      process.env['RESOURCE_TOUCH_JSONL_PATH'] = jsonlPath;
      const reporter = new TestReporter((_file, title) =>
        title.includes('tracked') ? { reads: ['fixture.read'], writes: ['fixture.write'] } : null,
      );
      reporter.onBegin(makeConfig());
      reporter.onTestEnd(
        makeTestCase({ titlePath: ['a tracked test'] }),
        makeResult({ status: 'passed' }),
      );
      const records = readResourceTouchRecords(jsonlPath);
      expect(records).toHaveLength(1);
      expect(records[0]?.reads).toEqual(['fixture.read']);
      expect(records[0]?.writes).toEqual(['fixture.write']);
    } finally {
      delete process.env['RESOURCE_TOUCH_JSONL_PATH'];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('writes nothing when the lookup returns null (untracked test)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-touch-reporter-'));
    try {
      const jsonlPath = path.join(tmpDir, 'resource-touch.jsonl');
      process.env['RESOURCE_TOUCH_JSONL_PATH'] = jsonlPath;
      const reporter = new TestReporter(() => null);
      reporter.onBegin(makeConfig());
      reporter.onTestEnd(
        makeTestCase({ titlePath: ['an untracked test'] }),
        makeResult({ status: 'passed' }),
      );
      expect(fs.existsSync(jsonlPath)).toBe(false);
    } finally {
      delete process.env['RESOURCE_TOUCH_JSONL_PATH'];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('skips a non-final retry attempt, records the final attempt', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-touch-reporter-'));
    try {
      const jsonlPath = path.join(tmpDir, 'resource-touch.jsonl');
      process.env['RESOURCE_TOUCH_JSONL_PATH'] = jsonlPath;
      const reporter = new TestReporter(() => ({ reads: ['x'], writes: [] }));
      reporter.onBegin(makeConfig());
      const testCase = makeTestCase({ retries: 1 });
      reporter.onTestEnd(testCase, makeResult({ status: 'failed', retry: 0 })); // not final
      expect(fs.existsSync(jsonlPath)).toBe(false);
      reporter.onTestEnd(testCase, makeResult({ status: 'passed', retry: 1 })); // final
      expect(readResourceTouchRecords(jsonlPath)).toHaveLength(1);
    } finally {
      delete process.env['RESOURCE_TOUCH_JSONL_PATH'];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('records the file path relative to the repo root', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-touch-reporter-'));
    try {
      const jsonlPath = path.join(tmpDir, 'resource-touch.jsonl');
      process.env['RESOURCE_TOUCH_JSONL_PATH'] = jsonlPath;
      let seenFile = '';
      const reporter = new TestReporter((file) => {
        seenFile = file;
        return { reads: ['x'], writes: [] };
      });
      reporter.onBegin(makeConfig());
      reporter.onTestEnd(
        makeTestCase({
          file: path.resolve(__dirname, '../../tests/apps/minicrm/functional/foo/foo.spec.ts'),
        }),
        makeResult({ status: 'passed' }),
      );
      expect(seenFile).toBe('qa/e2e/tests/apps/minicrm/functional/foo/foo.spec.ts');
    } finally {
      delete process.env['RESOURCE_TOUCH_JSONL_PATH'];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('joins titlePath with " > " before passing to the lookup', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-touch-reporter-'));
    try {
      const jsonlPath = path.join(tmpDir, 'resource-touch.jsonl');
      process.env['RESOURCE_TOUCH_JSONL_PATH'] = jsonlPath;
      let seenTitle = '';
      const reporter = new TestReporter((_file, title) => {
        seenTitle = title;
        return { reads: [], writes: [] };
      });
      reporter.onBegin(makeConfig());
      reporter.onTestEnd(
        makeTestCase({ titlePath: ['describe block', 'nested', 'the test'] }),
        makeResult({ status: 'passed' }),
      );
      expect(seenTitle).toBe('describe block > nested > the test');
    } finally {
      delete process.env['RESOURCE_TOUCH_JSONL_PATH'];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
