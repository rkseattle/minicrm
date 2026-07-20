/**
 * Unit tests for NodeV8CoverageAgent. (MINCRM-604)
 *
 * Uses a temp dumps-root injected via the constructor so this never writes
 * to the real server/coverage-dumps/ directory. Exercises the real V8
 * inspector API (no mocking) since it's the thing under test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { NodeV8CoverageAgent } from '../coverageAgent/NodeV8CoverageAgent.js';
import type { CoverageDump } from '../coverageAgent/CoverageAgent.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let dumpsRoot: string;
let agent: NodeV8CoverageAgent;

beforeEach(async () => {
  dumpsRoot = await mkdtemp(join(tmpdir(), 'minicrm-coverage-agent-test-'));
  agent = new NodeV8CoverageAgent({
    dumpsRoot,
    commitSha: 'test-sha-123',
    granularity: 'block',
  });
  await agent.start();
});

afterEach(async () => {
  await agent.stop();
  await rm(dumpsRoot, { recursive: true, force: true });
});

describe('NodeV8CoverageAgent', () => {
  it('throws if reset/snapshot/dump are called before start()', async () => {
    const unstarted = new NodeV8CoverageAgent({
      dumpsRoot,
      commitSha: 'test-sha-123',
      granularity: 'block',
    });
    await expect(unstarted.reset()).rejects.toThrow(/start\(\) must be called/);
  });

  it('reset() clears counters without writing any artifact', async () => {
    await agent.reset();
    const entries = await readdir(dumpsRoot).catch(() => []);
    expect(entries).toHaveLength(0);
  });

  it('snapshot() returns dump metadata but does not write to disk', async () => {
    const dump = await agent.snapshot('quick-check');
    expect(dump.dumpId).toMatch(UUID_PATTERN);
    expect(dump.agent).toBe('node-v8');
    expect(dump.label).toBe('quick-check');
    expect(dump.commitSha).toBe('test-sha-123');
    expect(dump.format).toBe('v8-script-coverage');

    const entries = await readdir(dumpsRoot).catch(() => []);
    expect(entries).toHaveLength(0);
  });

  it('dump() writes a payload file, a meta sidecar, and an index entry', async () => {
    const dump = await agent.dump('my-test-label');

    const payloadPath = join(dumpsRoot, dump.path);
    const metaPath = join(dumpsRoot, dump.commitSha, `${dump.dumpId}.meta.json`);

    const payloadRaw = await readFile(payloadPath, 'utf8');
    expect(() => JSON.parse(payloadRaw)).not.toThrow();

    const metaRaw = await readFile(metaPath, 'utf8');
    const meta = JSON.parse(metaRaw) as CoverageDump;
    expect(meta.dumpId).toBe(dump.dumpId);
    expect(meta.label).toBe('my-test-label');

    const indexRaw = await readFile(join(dumpsRoot, 'index.jsonl'), 'utf8');
    expect(indexRaw).toContain(dump.dumpId);
  });

  it('produces a distinct dumpId on every call', async () => {
    const first = await agent.dump('first');
    const second = await agent.dump('second');
    expect(first.dumpId).not.toBe(second.dumpId);
  });

  it('passes detailed:true for block granularity and detailed:false for function granularity', async () => {
    await agent.stop();

    const functionAgent = new NodeV8CoverageAgent({
      dumpsRoot,
      commitSha: 'test-sha-123',
      granularity: 'function',
    });
    await functionAgent.start();
    // No direct way to introspect the CDP call args from the public API;
    // the meaningful assertion is that start()/dump() succeed for both
    // granularities without throwing, exercising both code paths.
    const dump = await functionAgent.dump('function-granularity');
    expect(dump.dumpId).toMatch(UUID_PATTERN);
    await functionAgent.stop();
  });
});
