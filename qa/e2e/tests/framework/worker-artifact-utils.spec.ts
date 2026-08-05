/**
 * worker-artifact-utils — unit specs.
 *
 * Covers the two shared readers that replaced five near-identical copies:
 * `readWorkerArtifact` (per-worker JSON artifacts merged into one report) and
 * `readJsonlRecords` (append-only JSONL history).
 *
 * WHY THIS MATTERS
 * ----------------
 * Every copy previously swallowed all failures into an empty array, so a
 * corrupt or unreadable artifact silently dropped that worker's entire
 * contribution from the merged report. That is a wrong result, not a degraded
 * one: healed locators are the evidence used to diagnose selector drift, so
 * reporting fewer than occurred inverts the signal.
 *
 * The distinction these specs pin is absent vs unreadable. Absent is normal — a
 * worker that recorded nothing writes no file — and must stay silent. Present
 * but unusable must say so, while still returning what it can, because these
 * run inside reporters at the end of a suite and failing the run over a
 * reporting problem would be worse than the under-count.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readWorkerArtifact,
  readJsonlRecords,
} from '@framework/reporting/worker-artifact-utils.js';

/**
 * Creates a temp directory removed after the test.
 *
 * @returns Path to the directory.
 */
function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'worker-artifact-'));
}

test.describe('readWorkerArtifact', () => {
  test('returns the payload array', () => {
    const dir = tempDir();
    const file = path.join(dir, 'w.json');
    fs.writeFileSync(file, JSON.stringify({ events: [{ a: 1 }, { a: 2 }] }));

    expect(readWorkerArtifact<{ a: number }>(file, 'events', 'test')).toHaveLength(2);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('returns empty for an absent file without complaining', () => {
    // A worker that recorded nothing writes no file. Warning here would make
    // every clean run noisy.
    const dir = tempDir();

    expect(readWorkerArtifact(path.join(dir, 'missing.json'), 'events', 'test')).toEqual([]);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('returns empty and reports when the file is unparseable', () => {
    const dir = tempDir();
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, 'not json');

    const warnings: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      expect(readWorkerArtifact(file, 'events', 'test')).toEqual([]);
    } finally {
      process.stderr.write = original;
    }

    // The point of the extraction: the shortfall is diagnosable rather than
    // silent.
    expect(warnings.join('')).toContain('could not be read or parsed');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('returns empty and reports when the payload key is not an array', () => {
    const dir = tempDir();
    const file = path.join(dir, 'shape.json');
    fs.writeFileSync(file, JSON.stringify({ events: 'nope' }));

    const warnings: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      expect(readWorkerArtifact(file, 'events', 'test')).toEqual([]);
    } finally {
      process.stderr.write = original;
    }

    expect(warnings.join('')).toContain("no 'events' array");

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test.describe('readJsonlRecords', () => {
  test('reads every well-formed line', () => {
    const dir = tempDir();
    const file = path.join(dir, 'h.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ n: 1 })}\n${JSON.stringify({ n: 2 })}\n`);

    expect(readJsonlRecords<{ n: number }>(file, 'test')).toHaveLength(2);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('skips malformed lines but keeps the rest, and says how many', () => {
    // Deliberately not fatal: these files accumulate across runs, so one bad
    // record must not make the whole history unreadable. But a silent skip and
    // a clean file are otherwise indistinguishable.
    const dir = tempDir();
    const file = path.join(dir, 'mixed.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ n: 1 })}\nBROKEN\n${JSON.stringify({ n: 2 })}\n`);

    const warnings: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    let records: { n: number }[] = [];
    try {
      records = readJsonlRecords<{ n: number }>(file, 'test');
    } finally {
      process.stderr.write = original;
    }

    expect(records).toHaveLength(2);
    expect(warnings.join('')).toContain('skipped 1 malformed line');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('ignores blank lines without counting them as malformed', () => {
    const dir = tempDir();
    const file = path.join(dir, 'blank.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ n: 1 })}\n\n\n`);

    const warnings: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    let records: { n: number }[] = [];
    try {
      records = readJsonlRecords<{ n: number }>(file, 'test');
    } finally {
      process.stderr.write = original;
    }

    expect(records).toHaveLength(1);
    expect(warnings.join('')).toBe('');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('returns empty for an absent file without complaining', () => {
    const dir = tempDir();

    expect(readJsonlRecords(path.join(dir, 'missing.jsonl'), 'test')).toEqual([]);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
