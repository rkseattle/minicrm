/**
 * Unit tests for DumpIndex. (MINCRM-606)
 *
 * Covers append + warm-cache lookup, cold-scan fallback (fresh instance
 * reading a previously-written index file), and unknown-dumpId misses.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DumpIndex } from '../coverageAgent/dumpIndex.js';
import type { CoverageDump } from '../coverageAgent/CoverageAgent.js';

let dumpsRoot: string;

beforeEach(async () => {
  dumpsRoot = await mkdtemp(join(tmpdir(), 'minicrm-coverage-test-'));
});

afterEach(async () => {
  await rm(dumpsRoot, { recursive: true, force: true });
});

function makeDump(dumpId: string): CoverageDump {
  return {
    dumpId,
    agent: 'node-v8',
    label: 'test-label',
    commitSha: 'abc123',
    capturedAt: new Date().toISOString(),
    format: 'v8-script-coverage',
    path: join('abc123', `${dumpId}.json`),
  };
}

describe('DumpIndex', () => {
  it('returns undefined for an unknown dumpId with no index file yet', async () => {
    const index = new DumpIndex(dumpsRoot);
    await expect(index.lookup('does-not-exist')).resolves.toBeUndefined();
  });

  it('finds an entry via the warm in-process cache after append', async () => {
    const index = new DumpIndex(dumpsRoot);
    const dump = makeDump('dump-1');
    const metaPath = join(dumpsRoot, 'abc123', 'dump-1.meta.json');
    await index.append(dump, metaPath);

    await expect(index.lookup('dump-1')).resolves.toBe(metaPath);
  });

  it('finds an entry via cold-scan when a fresh instance reads a prior index file', async () => {
    const writer = new DumpIndex(dumpsRoot);
    const dump = makeDump('dump-2');
    const metaPath = join(dumpsRoot, 'abc123', 'dump-2.meta.json');
    await writer.append(dump, metaPath);

    const reader = new DumpIndex(dumpsRoot);
    await expect(reader.lookup('dump-2')).resolves.toBe(metaPath);
  });

  it('returns undefined for a dumpId not present in the index', async () => {
    const index = new DumpIndex(dumpsRoot);
    await index.append(makeDump('dump-3'), join(dumpsRoot, 'abc123', 'dump-3.meta.json'));

    await expect(index.lookup('never-appended')).resolves.toBeUndefined();
  });
});
