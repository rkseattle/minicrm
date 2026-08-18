/**
 * Coverage/TIA agent SDK tests.
 *
 * Asserts coverageAgentRegistry accepts any object satisfying the
 * CoverageAgentPlugin interface — not just the concrete NodeV8CoverageAgent
 * class — which is the runtime consequence of The reference
 * implementation, not a hardcoded singleton" SDK framing: a second
 * language's agent must be able to register without a type error.
 */

import { describe, expect, it } from 'vitest';
import { getCoverageAgent, registerCoverageAgent } from '../coverageAgent/coverageAgentRegistry.js';
import type {
  AgentMetadata,
  CoverageAgentPlugin,
  CoverageDump,
} from '../coverageAgent/sdk/CoverageAgentPlugin.js';

// AgentMetadata.id is deliberately a free-form string, NOT constrained to
// CoverageDumpSource ('node-v8' | 'browser-istanbul') — this test double
// uses an id outside that closed union to prove the two are decoupled.
// CoverageDump.agent below stays 'node-v8' since it IS the closed,
// DB-CHECK-constrained union (see CoverageAgentPlugin.ts's own docblock).
const TEST_DOUBLE_METADATA: AgentMetadata = {
  id: 'test-double-language',
  language: 'Test Double',
  displayName: 'Test Double Coverage Agent',
};

/** Minimal CoverageAgentPlugin implementation — not a NodeV8CoverageAgent instance. */
class TestDoubleCoverageAgent implements CoverageAgentPlugin {
  readonly metadata = TEST_DOUBLE_METADATA;

  async reset(): Promise<void> {}

  async snapshot(label: string): Promise<CoverageDump> {
    return this.makeDump(label);
  }

  async dump(label: string): Promise<CoverageDump> {
    return this.makeDump(label);
  }

  private makeDump(label: string): CoverageDump {
    return {
      dumpId: 'test-double-dump-id',
      agent: 'node-v8',
      label,
      commitSha: 'test-sha',
      capturedAt: new Date(0).toISOString(),
      format: 'v8-script-coverage',
      path: 'test-double/dump.json',
    };
  }
}

describe('coverageAgentRegistry', () => {
  it('accepts a CoverageAgentPlugin implementation that is not the concrete NodeV8CoverageAgent class', async () => {
    const testDouble = new TestDoubleCoverageAgent();
    registerCoverageAgent(testDouble);

    const registered = getCoverageAgent();
    expect(registered).toBe(testDouble);
    expect(registered?.metadata).toEqual(TEST_DOUBLE_METADATA);

    const dump = await registered?.dump('sdk-widening-check');
    expect(dump?.label).toBe('sdk-widening-check');
  });
});
