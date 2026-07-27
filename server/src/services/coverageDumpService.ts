/**
 * Coverage/TIA dump service. (MINCRM-604, MINCRM-606)
 *
 * Not a DB-backed service — dump metadata is file-based (see
 * coverageAgent/dumpIndex.ts) since phase 1 has no per-owner semantics and
 * no downstream consumer of a queryable dump table yet. Kept as a service
 * module (not inline in the controller) so the controller still only does
 * request/response shaping, per repo convention, even though there's no SQL
 * here — this module is the boundary for "how dumps get persisted."
 *
 * Handles two origins uniformly:
 *  - Backend dumps: delegates to the registered NodeV8CoverageAgent.
 *  - Browser dumps: the E2E client already pulled window.__coverage__
 *    itself and POSTs the raw Istanbul payload here to be tagged and
 *    stored identically to a backend dump — no agent is invoked.
 */

import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { getCoverageAgent } from '../coverageAgent/coverageAgentRegistry.js';
import { getSharedDumpIndex } from '../coverageAgent/dumpIndex.js';
import { COVERAGE_DUMPS_ROOT, resolveCoverageConfig } from '../coverageAgent/coverageConfig.js';
import type { CoverageDump } from '../coverageAgent/sdk/CoverageAgentPlugin.js';
import logger from '../logger.js';

// Resolved lazily on each use, NOT bound to a module-level const — a
// const captured once at import time would keep referencing whatever
// DumpIndex instance existed at that moment even after
// __clearSharedDumpIndexesForTest() (test-only) replaces the registry's
// entry with a fresh instance, silently reintroducing the exact
// two-divergent-instances bug getSharedDumpIndex exists to prevent
// (this module's stale binding vs. a freshly-constructed
// NodeV8CoverageAgent's fresh lookup in a later test). Shared, not a
// private instance — must match the root the registered agent itself was
// constructed with, or dumps written by one and looked up by the other
// would silently miss (see coverageConfig.ts's "single source of truth"
// note on COVERAGE_DUMPS_ROOT).
function dumpIndex() {
  return getSharedDumpIndex(COVERAGE_DUMPS_ROOT);
}

/** Thrown when a coverage operation is requested but the backend agent never started. */
export class CoverageNotEnabledError extends Error {
  readonly code = 'COVERAGE_NOT_ENABLED';
  constructor() {
    super(
      'Coverage instrumentation is not running on this server. ' +
        'Set COVERAGE_INSTRUMENTATION=true at boot to enable the backend agent.',
    );
  }
}

function requireAgent() {
  const agent = getCoverageAgent();
  if (!agent) {
    throw new CoverageNotEnabledError();
  }
  return agent;
}

/** Resets the backend agent's coverage counters. */
export async function resetCoverage(): Promise<void> {
  await requireAgent().reset();
}

/** Reads current backend counters without persisting an artifact. */
export async function snapshotCoverage(label: string): Promise<CoverageDump> {
  return requireAgent().snapshot(label);
}

/** Persists a tagged backend dump. */
export async function dumpBackendCoverage(label: string): Promise<CoverageDump> {
  return requireAgent().dump(label);
}

/**
 * Ingests an already-collected browser (Istanbul) coverage payload,
 * tagging and storing it identically to a backend dump. Does not touch
 * the backend agent.
 */
export async function ingestBrowserCoverage(
  label: string,
  payload: Record<string, unknown>,
): Promise<CoverageDump> {
  const commitSha = resolveCoverageConfig().commitSha;
  const dumpId = randomUUID();
  const capturedAt = new Date().toISOString();
  const relativePath = join(commitSha, `${dumpId}.json`);

  const dump: CoverageDump = {
    dumpId,
    agent: 'browser-istanbul',
    label,
    commitSha,
    capturedAt,
    format: 'istanbul',
    path: relativePath,
  };

  const payloadPath = join(COVERAGE_DUMPS_ROOT, relativePath);
  const metaPath = join(COVERAGE_DUMPS_ROOT, commitSha, `${dumpId}.meta.json`);
  await mkdir(dirname(payloadPath), { recursive: true });
  await writeFile(payloadPath, JSON.stringify(payload), 'utf8');
  await writeFile(metaPath, JSON.stringify(dump, null, 2), 'utf8');
  await dumpIndex().append(dump, metaPath);

  return dump;
}

/** Looks up metadata for a previously produced dump. Returns undefined if not found. */
export async function findCoverageDump(dumpId: string): Promise<CoverageDump | undefined> {
  const metaPath = await dumpIndex().lookup(dumpId);
  if (!metaPath) return undefined;

  try {
    const raw = await readFile(metaPath, 'utf8');
    return JSON.parse(raw) as CoverageDump;
  } catch (err) {
    // The index has an entry for this dumpId, so the metadata file was
    // expected to exist and parse cleanly — a failure here means disk
    // corruption or a partial write, not "dump never existed". Still
    // returns undefined (the controller maps that to 404) but logs so
    // it's distinguishable from a genuine unknown-dumpId lookup.
    logger.warn({ err, dumpId, metaPath }, 'findCoverageDump: meta file missing or unparseable');
    return undefined;
  }
}
