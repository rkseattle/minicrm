/**
 * Unit tests for coverageDumpService. (MINCRM-606)
 *
 * Uses a real NodeV8CoverageAgent registered against the service's own
 * COVERAGE_DUMPS_ROOT (not mocked, not a separately-chosen temp dir) so
 * these tests exercise the actual reset/dump delegation and the
 * browser-ingestion path end to end. The two MUST share the same root —
 * see the "single source of truth" comment in coverageAgent/coverageConfig.ts;
 * a divergent root here would silently reintroduce the write/lookup mismatch
 * that motivated centralizing COVERAGE_DUMPS_ROOT in the first place.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rm } from 'fs/promises';
import { NodeV8CoverageAgent } from '../coverageAgent/NodeV8CoverageAgent.js';
import { registerCoverageAgent } from '../coverageAgent/coverageAgentRegistry.js';
import { COVERAGE_DUMPS_ROOT } from '../coverageAgent/coverageConfig.js';
import {
  CoverageNotEnabledError,
  dumpBackendCoverage,
  findCoverageDump,
  ingestBrowserCoverage,
  resetCoverage,
  snapshotCoverage,
} from '../services/coverageDumpService.js';

let agent: NodeV8CoverageAgent | undefined;

afterEach(async () => {
  if (agent) {
    await agent.stop();
    agent = undefined;
  }
  await rm(COVERAGE_DUMPS_ROOT, { recursive: true, force: true });
});

describe('coverageDumpService — agent not registered', () => {
  it('throws CoverageNotEnabledError for reset/snapshot/dump when no agent is registered', async () => {
    await expect(resetCoverage()).rejects.toBeInstanceOf(CoverageNotEnabledError);
    await expect(snapshotCoverage('label')).rejects.toBeInstanceOf(CoverageNotEnabledError);
    await expect(dumpBackendCoverage('label')).rejects.toBeInstanceOf(CoverageNotEnabledError);
  });
});

describe('coverageDumpService — agent registered', () => {
  beforeEach(async () => {
    agent = new NodeV8CoverageAgent({
      dumpsRoot: COVERAGE_DUMPS_ROOT,
      commitSha: 'service-test-sha',
      granularity: 'block',
    });
    await agent.start();
    registerCoverageAgent(agent);
  });

  it('resetCoverage() delegates to the registered agent without throwing', async () => {
    await expect(resetCoverage()).resolves.toBeUndefined();
  });

  it('dumpBackendCoverage() delegates to the agent and the dump is later findable', async () => {
    const dump = await dumpBackendCoverage('service-test-label');
    expect(dump.agent).toBe('node-v8');

    const found = await findCoverageDump(dump.dumpId);
    expect(found?.dumpId).toBe(dump.dumpId);
    expect(found?.label).toBe('service-test-label');
  });

  it('ingestBrowserCoverage() bypasses the agent and stores the payload as-is', async () => {
    const payload = { 'src/App.tsx': { path: 'src/App.tsx', s: { '0': 1 } } };
    const dump = await ingestBrowserCoverage('browser-test-label', payload);

    expect(dump.agent).toBe('browser-istanbul');
    expect(dump.format).toBe('istanbul');

    const found = await findCoverageDump(dump.dumpId);
    expect(found?.agent).toBe('browser-istanbul');
  });
});

describe('findCoverageDump', () => {
  it('returns undefined for an unknown dumpId', async () => {
    await expect(findCoverageDump('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
  });
});
