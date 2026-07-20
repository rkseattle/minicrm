/**
 * Module-level registry holding the process's single NodeV8CoverageAgent
 * instance, if coverage instrumentation is enabled. (MINCRM-604, MINCRM-606)
 *
 * server.ts constructs and registers the agent at boot (or leaves it
 * unregistered when COVERAGE_INSTRUMENTATION is off); coverageDumpService
 * reads it here rather than importing server.ts directly, avoiding a
 * server.ts -> service -> server.ts import cycle.
 */

import type { NodeV8CoverageAgent } from './NodeV8CoverageAgent.js';

let agent: NodeV8CoverageAgent | undefined;

/** Registers the process's coverage agent. Called once at server boot. */
export function registerCoverageAgent(instance: NodeV8CoverageAgent): void {
  agent = instance;
}

/** Returns the registered coverage agent, or undefined if instrumentation is disabled. */
export function getCoverageAgent(): NodeV8CoverageAgent | undefined {
  return agent;
}
