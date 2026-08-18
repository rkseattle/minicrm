/**
 * Module-level registry holding the process's single CoverageAgentPlugin
 * instance, if coverage instrumentation is enabled.
 *
 * server.ts constructs and registers the agent at boot (or leaves it
 * unregistered when COVERAGE_INSTRUMENTATION is off); coverageDumpService
 * reads it here rather than importing server.ts directly, avoiding a
 * server.ts -> service -> server.ts import cycle.
 *
 * Typed to the CoverageAgentPlugin interface, not the concrete
 * NodeV8CoverageAgent class — the SDK contract requires that a
 * second language agent be registerable here without a type error, even
 * though NodeV8CoverageAgent is still the only implementation that exists
 * today.
 */

import type { CoverageAgentPlugin } from './sdk/CoverageAgentPlugin.js';

let agent: CoverageAgentPlugin | undefined;

/** Registers the process's coverage agent. Called once at server boot. */
export function registerCoverageAgent(instance: CoverageAgentPlugin): void {
  agent = instance;
}

/** Returns the registered coverage agent, or undefined if instrumentation is disabled. */
export function getCoverageAgent(): CoverageAgentPlugin | undefined {
  return agent;
}
