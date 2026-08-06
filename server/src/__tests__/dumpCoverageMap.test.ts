/**
 * Round-trip tests for the coverage-map serialization contract. (MINCRM-703)
 *
 * WHY THIS EXISTS
 * ---------------
 * loadCoverageMap has thorough tests for every way it rejects a bad file — but
 * they all build their fixtures BY HAND. Nothing asserted that the writer
 * actually produces the shape the reader demands, so a writer change that
 * stopped emitting the trailer, emitted it before the entries, or went back to
 * pretty-printing would pass every test in the suite and surface only in a
 * multi-hour record-mode run.
 *
 * These tests exercise the real writer against a temp path and feed its output
 * straight to the real reader. That round trip is the assertion that pins the
 * two ends together; the hand-built fixtures pin the rejection branches.
 *
 * Never touches qa/coverage-map.jsonl. That file is the authoritative committed
 * artifact, regenerable only by a full record-mode run.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { writeCoverageMap } from '../scripts/dump-coverage-map.js';
import { loadCoverageMap } from '../scripts/load-coverage-map.js';
import {
  loadCoverageTestLinksForCommit,
  findUnitsForTest,
  type CoverageTestLinkExportEntry,
} from '../services/coverageMappingService.js';
import coverageDb from '../coverageDb.js';

const FILE_PREFIX = 'dump-map-test';
const createdShas: string[] = [];

/**
 * Builds an export entry.
 *
 * @param overrides - Fields to override on the default entry.
 * @returns An export entry.
 */
function entry(overrides: Partial<CoverageTestLinkExportEntry> = {}): CoverageTestLinkExportEntry {
  return {
    unitKey: 'render#abc123',
    branchId: null,
    filePath: `${FILE_PREFIX}/widget.ts`,
    testId: `${FILE_PREFIX}::t`,
    testName: null,
    testFile: null,
    hitCount: 1,
    ...overrides,
  };
}

afterEach(async () => {
  if (createdShas.length > 0) {
    await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = ANY($1)', [
      createdShas.splice(0),
    ]);
  }
});

describe('coverage map serialization', () => {
  it('writes a header, compact entries, and an entry-count trailer', async () => {
    const dir = mkdtempSync(joinPath(tmpdir(), 'dump-map-'));
    const mapPath = joinPath(dir, 'coverage-map.jsonl');

    const total = await writeCoverageMap(mapPath, async (onBatch) => {
      await onBatch([entry({ testId: 'a' }), entry({ testId: 'b' })]);
      return 2;
    });

    const lines = readFileSync(mapPath, 'utf-8').trim().split('\n');

    expect(total).toBe(2);
    // header + test dict + unit dict + 2 links + trailer. Both entries share
    // one code unit, so the unit line is written once — the whole point of the
    // normalized layout.
    expect(lines).toHaveLength(7);
    expect(JSON.parse(lines[0])).toMatchObject({ format: 2 });
    expect(JSON.parse(lines[0])).toHaveProperty('generatedAt');
    expect(JSON.parse(lines[lines.length - 1])).toEqual({ entryCount: 2 });
    // A dictionary line must precede any link that references it, since the
    // reader resolves as it streams.
    expect(JSON.parse(lines[1])).toHaveProperty('t');
    expect(JSON.parse(lines[2])).toHaveProperty('u');
    expect(JSON.parse(lines[3])).toHaveProperty('l');
    // Compact, not pretty-printed: indentation was a 2-3x multiplier on a file
    // no human reads, and it is what pushed the old format past the 512MB
    // string ceiling.
    expect(lines[1]).toBe(JSON.stringify(JSON.parse(lines[1])));

    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips through the real reader', async () => {
    // The assertion that actually pins writer to reader. Every other loader
    // test builds its fixture by hand and would keep passing if the writer
    // drifted.
    const dir = mkdtempSync(joinPath(tmpdir(), 'dump-map-'));
    const mapPath = joinPath(dir, 'coverage-map.jsonl');
    const sha = `${FILE_PREFIX}-roundtrip-${randomUUID()}`;
    createdShas.push(sha);

    await writeCoverageMap(mapPath, async (onBatch) => {
      await onBatch([
        entry({ testId: `${FILE_PREFIX}::one`, testFile: 'tests/one.spec.ts', hitCount: 7 }),
        entry({ testId: `${FILE_PREFIX}::two`, branchId: '0:1' }),
      ]);
      return 2;
    });

    await expect(loadCoverageMap(sha, mapPath)).resolves.toBe(2);

    const found = await findUnitsForTest(sha, `${FILE_PREFIX}::one`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ testFile: 'tests/one.spec.ts', hitCount: 7 });

    rmSync(dir, { recursive: true, force: true });
  });

  it('writes each test and unit once, however many links reference them', async () => {
    // The property that keeps the file bounded by entity count rather than by
    // the product of tests and units.
    const dir = mkdtempSync(joinPath(tmpdir(), 'dump-map-'));
    const mapPath = joinPath(dir, 'coverage-map.jsonl');

    await writeCoverageMap(mapPath, async (onBatch) => {
      await onBatch([
        entry({ testId: 'x', unitKey: 'u1' }),
        entry({ testId: 'x', unitKey: 'u2' }),
        entry({ testId: 'y', unitKey: 'u1' }),
        entry({ testId: 'y', unitKey: 'u2' }),
      ]);
      return 4;
    });

    const lines = readFileSync(mapPath, 'utf-8').trim().split('\n');
    const kinds = lines.slice(1, -1).map((l) => Object.keys(JSON.parse(l))[0]);

    // 2 tests + 2 units + 4 links, not 4 fully-spelled entries.
    expect(kinds.filter((k) => k === 't')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'u')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'l')).toHaveLength(4);

    rmSync(dir, { recursive: true, force: true });
  });

  it('writes an empty map that the reader still accepts', async () => {
    // Zero entries is well-formed, not truncated — the reader must load it
    // (clearing the target SHA) rather than reject it.
    const dir = mkdtempSync(joinPath(tmpdir(), 'dump-map-'));
    const mapPath = joinPath(dir, 'coverage-map.jsonl');
    const sha = `${FILE_PREFIX}-empty-${randomUUID()}`;
    createdShas.push(sha);

    await loadCoverageTestLinksForCommit(sha, [entry({ testId: `${FILE_PREFIX}::stale` })]);
    await writeCoverageMap(mapPath, async () => 0);

    await expect(loadCoverageMap(sha, mapPath)).resolves.toBe(0);
    expect(await findUnitsForTest(sha, `${FILE_PREFIX}::stale`)).toHaveLength(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves no file behind when the export fails mid-stream', async () => {
    // Temp-then-rename: a failed export must leave the previous good map
    // untouched rather than replacing it with a truncated one, and must not
    // strand a temp file for the next run to trip over.
    const dir = mkdtempSync(joinPath(tmpdir(), 'dump-map-'));
    const mapPath = joinPath(dir, 'coverage-map.jsonl');

    await expect(
      writeCoverageMap(mapPath, async (onBatch) => {
        await onBatch([entry()]);
        throw new Error('database went away mid-export');
      }),
    ).rejects.toThrow('database went away');

    expect(existsSync(mapPath)).toBe(false);
    // And no orphaned temp file: the cleanup runs on the failure path.
    expect(readdirSync(dir)).toEqual([]);

    rmSync(dir, { recursive: true, force: true });
  });
});
