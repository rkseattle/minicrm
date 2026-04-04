/**
 * Unit tests for HealingRegistry.
 *
 * Verifies:
 * 1. record() increments the count.
 * 2. flush() writes the expected JSON structure to the worker file.
 * 3. flush() creates the output directory if it does not exist.
 * 4. count resets to 0 after _reset().
 *
 * MINCRM-124
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HealingRegistry } from '../../framework/healing/healing-registry.js';
import type { HealEvent } from '../../framework/healing/healing-registry.js';

test.describe('HealingRegistry', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('count starts at 0', () => {
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('record() increments count', () => {
    HealingRegistry.instance.record(
      'my test',
      { type: 'testId', value: 'btn' },
      { type: 'css', value: '.btn' },
    );
    expect(HealingRegistry.instance.count).toBe(1);
  });

  test('record() stores multiple events', () => {
    HealingRegistry.instance.record(
      't1',
      { type: 'testId', value: 'a' },
      { type: 'css', value: '.a' },
    );
    HealingRegistry.instance.record(
      't2',
      { type: 'role', value: 'button' },
      { type: 'xpath', value: '//button' },
    );
    expect(HealingRegistry.instance.count).toBe(2);
  });

  test('flush() writes correct JSON structure', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healing-reg-test-'));
    process.env['PW_WORKER_INDEX'] = '77';

    HealingRegistry.instance.record(
      'flush test',
      { type: 'testId', value: 'x' },
      { type: 'css', value: '.x' },
      false,
    );

    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    HealingRegistry.instance.flush();
    process.chdir(originalCwd);

    const writtenPath = path.join(tmpDir, 'test-results', 'healing-77.json');
    expect(fs.existsSync(writtenPath)).toBe(true);

    const contents = JSON.parse(fs.readFileSync(writtenPath, 'utf-8')) as {
      workerId: string;
      events: HealEvent[];
    };

    expect(contents.workerId).toBe('77');
    expect(contents.events).toHaveLength(1);

    const event = contents.events[0]!;
    expect(event.testName).toBe('flush test');
    expect(event.originalStrategy.type).toBe('testId');
    expect(event.originalStrategy.value).toBe('x');
    expect(event.healedStrategy.type).toBe('css');
    expect(event.healedStrategy.value).toBe('.x');
    expect(event.wasAiHeal).toBe(false);
    expect(typeof event.timestamp).toBe('string');
    // Timestamp should be a valid ISO date string.
    expect(() => new Date(event.timestamp).toISOString()).not.toThrow();

    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env['PW_WORKER_INDEX'];
  });

  test('flush() creates output directory if it does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healing-mkdir-test-'));
    process.env['PW_WORKER_INDEX'] = '55';

    // Ensure test-results does NOT exist inside tmpDir.
    const outputDir = path.join(tmpDir, 'test-results');
    expect(fs.existsSync(outputDir)).toBe(false);

    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    HealingRegistry.instance.flush();
    process.chdir(originalCwd);

    expect(fs.existsSync(outputDir)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env['PW_WORKER_INDEX'];
  });

  test('worker files do not collide — different PW_WORKER_INDEX values produce different file names', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healing-workers-test-'));
    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    process.env['PW_WORKER_INDEX'] = '0';
    HealingRegistry.instance.record(
      'worker 0 test',
      { type: 'testId', value: 'a' },
      { type: 'css', value: '.a' },
    );
    HealingRegistry.instance.flush();
    HealingRegistry.instance._reset();

    process.env['PW_WORKER_INDEX'] = '1';
    HealingRegistry.instance.record(
      'worker 1 test',
      { type: 'testId', value: 'b' },
      { type: 'css', value: '.b' },
    );
    HealingRegistry.instance.flush();
    HealingRegistry.instance._reset();

    process.chdir(originalCwd);

    const outputDir = path.join(tmpDir, 'test-results');
    const files = fs.readdirSync(outputDir).sort();
    expect(files).toEqual(['healing-0.json', 'healing-1.json']);

    // Verify each file contains only its own events.
    const worker0 = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'healing-0.json'), 'utf-8'),
    ) as { events: HealEvent[] };
    expect(worker0.events[0]?.testName).toBe('worker 0 test');

    const worker1 = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'healing-1.json'), 'utf-8'),
    ) as { events: HealEvent[] };
    expect(worker1.events[0]?.testName).toBe('worker 1 test');

    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env['PW_WORKER_INDEX'];
  });

  test('_reset() clears all events', () => {
    HealingRegistry.instance.record(
      't',
      { type: 'testId', value: 'x' },
      { type: 'css', value: '.x' },
    );
    expect(HealingRegistry.instance.count).toBe(1);
    HealingRegistry.instance._reset();
    expect(HealingRegistry.instance.count).toBe(0);
  });
});
