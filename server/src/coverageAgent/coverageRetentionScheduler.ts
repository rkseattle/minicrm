/**
 * Coverage/TIA retention pruning entry point. (MINCRM-637)
 *
 * coverageModelService.pruneCoverageUnits has existed since MINCRM-616 but
 * had zero production callers — this wires it into server.ts's daily cron
 * schedule (see server.ts's own runCoverageRetentionPruning call site).
 * Runs unconditionally, independent of COVERAGE_INSTRUMENTATION: the
 * coverage database's coverage_units/coverage_test_links tables are
 * populated by the pipeline/mapping ingestion path, which can run with the
 * backend V8 agent off.
 *
 * retentionDays is a parameter, not resolved internally via
 * resolveCoveragePolicy() — this function is invoked fresh from the cron
 * closure on every scheduled tick for the life of the process, and
 * resolveCoveragePolicy() -> resolveCoverageConfig() shells out to `git
 * rev-parse HEAD` (coverageConfig.ts) to resolve a commitSha this function
 * doesn't even use. Resolving the policy inside here would re-run that
 * subprocess once a day forever, violating coveragePolicyConfig.ts's own
 * "resolve once at boot, pass the result down" contract. The caller
 * (server.ts) resolves the policy once at boot and passes retentionDays in.
 *
 * Tracks its own last-run outcome as module-level state, mirroring
 * coverageAgentRegistry.ts's own singleton pattern — this is the only
 * scheduled background job MINCRM-637 introduces, and it was otherwise
 * invisible to GET /health: a failed nightly prune only ever logged
 * `cron: coverage retention pruning failed`, with the health report
 * continuing to report status: 'ok' indefinitely (found via Greptile
 * branch review). getLastRetentionPruneOutcome() lets coverageHealthService
 * surface it without this module depending on that service (or vice
 * versa) — a plain read of in-process state set by the one function that
 * ever mutates it.
 */

import { pruneCoverageUnits } from '../services/coverageModelService.js';
import logger from '../logger.js';

export type RetentionPruneOutcome =
  | { ranAt: string; status: 'ok'; prunedUnitCount: number; prunedLinkCount: number }
  | { ranAt: string; status: 'error'; error: string };

let lastOutcome: RetentionPruneOutcome | undefined;

/** The most recent runCoverageRetentionPruning outcome, or undefined if the cron hasn't fired yet this process's lifetime (e.g. right after boot, before 07:00 first hits). */
export function getLastRetentionPruneOutcome(): RetentionPruneOutcome | undefined {
  return lastOutcome;
}

/** Prunes coverage_units/coverage_test_links rows older than `retentionDays`. */
export async function runCoverageRetentionPruning(retentionDays: number): Promise<void> {
  try {
    const { prunedUnitCount, prunedLinkCount } = await pruneCoverageUnits(retentionDays);
    logger.info(
      { retentionDays, prunedUnitCount, prunedLinkCount },
      'Coverage retention pruning complete',
    );
    lastOutcome = {
      ranAt: new Date().toISOString(),
      status: 'ok',
      prunedUnitCount,
      prunedLinkCount,
    };
  } catch (err: unknown) {
    lastOutcome = {
      ranAt: new Date().toISOString(),
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
    throw err;
  }
}
