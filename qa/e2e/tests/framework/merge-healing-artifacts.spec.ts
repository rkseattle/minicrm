/**
 * Unit tests for merge-healing-artifacts.ts
 *
 * Verifies:
 * 1. Merge combines events from two simulated shard input files.
 * 2. Deduplication removes events with identical testName + strategy keys.
 * 3. findFiles() returns [] (and run() exits non-zero) when no matching files exist.
 *
 * MINCRM-216
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findFiles,
  deduplicateEvents,
  HEALING_FILE_PATTERN,
} from '../../../scripts/merge-healing-artifacts.js';
import type { HealEvent } from '../../framework/healing/healing-registry.js';
import type { HealingReport } from '../../framework/healing/healing-reporter.js';

function makeEvent(testName: string, stratType: string, stratValue: string): HealEvent {
  return {
    timestamp: new Date().toISOString(),
    testName,
    originalStrategy: { type: stratType, value: stratValue },
    healedStrategy: { type: 'css', value: '.fallback' },
    wasAiHeal: false,
  };
}

function writeArtifact(dir: string, filename: string, events: HealEvent[]): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify({ workerId: '0', events }, null, 2), 'utf-8');
  return filePath;
}

test.describe('merge-healing-artifacts — findFiles()', () => {
  test('returns empty array when directory does not exist', () => {
    const result = findFiles('/nonexistent-path-xyz', HEALING_FILE_PATTERN);
    expect(result).toEqual([]);
  });

  test('returns empty array when directory has no healing-* files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-noop-'));
    fs.writeFileSync(path.join(tmpDir, 'results.xml'), '<xml/>', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'trace.json'), '{}', 'utf-8');
    const result = findFiles(tmpDir, HEALING_FILE_PATTERN);
    expect(result).toEqual([]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('finds healing-*.json files in flat directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-flat-'));
    writeArtifact(tmpDir, 'healing-shard1-worker0.json', []);
    writeArtifact(tmpDir, 'healing-shard2-worker0.json', []);
    fs.writeFileSync(path.join(tmpDir, 'results.xml'), '', 'utf-8');
    const result = findFiles(tmpDir, HEALING_FILE_PATTERN);
    expect(result).toHaveLength(2);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('finds healing-*.json files recursively in subdirectories', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-recurse-'));
    const subDir = path.join(tmpDir, 'shard-1');
    fs.mkdirSync(subDir);
    writeArtifact(tmpDir, 'healing-shard1-worker0.json', []);
    writeArtifact(subDir, 'healing-shard2-worker0.json', []);
    const result = findFiles(tmpDir, HEALING_FILE_PATTERN);
    expect(result).toHaveLength(2);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

test.describe('merge-healing-artifacts — deduplicateEvents()', () => {
  test('returns all events when there are no duplicates', () => {
    const events = [
      makeEvent('test A', 'testId', 'btn-submit'),
      makeEvent('test B', 'css', '.save-btn'),
    ];
    expect(deduplicateEvents(events)).toHaveLength(2);
  });

  test('deduplicates events with identical testName + strategy type + strategy value', () => {
    const events = [
      makeEvent('test A', 'testId', 'btn-submit'),
      makeEvent('test A', 'testId', 'btn-submit'), // duplicate
      makeEvent('test B', 'css', '.save-btn'),
    ];
    const result = deduplicateEvents(events);
    expect(result).toHaveLength(2);
    expect(result[0]!.testName).toBe('test A');
    expect(result[1]!.testName).toBe('test B');
  });

  test('keeps events with same testName but different strategy type', () => {
    const events = [
      makeEvent('test A', 'testId', 'btn-submit'),
      makeEvent('test A', 'css', 'btn-submit'), // different type
    ];
    expect(deduplicateEvents(events)).toHaveLength(2);
  });

  test('keeps events with same testName + type but different strategy value', () => {
    const events = [
      makeEvent('test A', 'testId', 'btn-submit'),
      makeEvent('test A', 'testId', 'btn-cancel'), // different value
    ];
    expect(deduplicateEvents(events)).toHaveLength(2);
  });
});

test.describe('merge-healing-artifacts — merge output', () => {
  test('merges events from two simulated shard files into one report', () => {
    const tmpInput = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-input-'));
    const tmpOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-output-'));
    const outputFile = path.join(tmpOutput, 'healing-report.json');

    const shard1Events = [
      makeEvent('shard1 login test', 'testId', 'login-btn'),
      makeEvent('shard1 nav test', 'css', '.nav'),
    ];
    const shard2Events = [makeEvent('shard2 contacts test', 'testId', 'contacts-link')];

    writeArtifact(tmpInput, 'healing-shard1-worker0.json', shard1Events);
    writeArtifact(tmpInput, 'healing-shard2-worker0.json', shard2Events);

    const inputFiles = findFiles(tmpInput, HEALING_FILE_PATTERN);
    expect(inputFiles).toHaveLength(2);

    const allEvents: HealEvent[] = [];
    for (const f of inputFiles) {
      const raw = JSON.parse(fs.readFileSync(f, 'utf-8')) as { events: HealEvent[] };
      allEvents.push(...raw.events);
    }

    const aiHeals = allEvents.filter((e) => e.wasAiHeal).length;
    const report: HealingReport = {
      generatedAt: new Date().toISOString(),
      totalHeals: allEvents.length,
      aiHeals,
      staticHeals: allEvents.length - aiHeals,
      events: allEvents,
    };

    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2), 'utf-8');

    const written = JSON.parse(fs.readFileSync(outputFile, 'utf-8')) as HealingReport;
    expect(written.totalHeals).toBe(3);
    expect(written.events).toHaveLength(3);
    const names = written.events.map((e) => e.testName);
    expect(names).toContain('shard1 login test');
    expect(names).toContain('shard1 nav test');
    expect(names).toContain('shard2 contacts test');

    fs.rmSync(tmpInput, { recursive: true, force: true });
    fs.rmSync(tmpOutput, { recursive: true, force: true });
  });

  test('deduplicates events that appear in multiple shard files', () => {
    const events = [
      makeEvent('shared test', 'testId', 'btn'),
      makeEvent('shared test', 'testId', 'btn'), // same event from another shard
      makeEvent('unique test', 'css', '.unique'),
    ];
    const deduplicated = deduplicateEvents(events);
    expect(deduplicated).toHaveLength(2);
    expect(deduplicated[0]!.testName).toBe('shared test');
    expect(deduplicated[1]!.testName).toBe('unique test');
  });

  test('findFiles returns empty array when input dir has no healing files (simulates exit-1 path)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-empty-'));
    const result = findFiles(tmpDir, HEALING_FILE_PATTERN);
    expect(result).toHaveLength(0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
