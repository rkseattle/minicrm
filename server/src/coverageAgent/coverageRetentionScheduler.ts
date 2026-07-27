/**
 * Coverage/TIA retention pruning entry point. (MINCRM-637)
 *
 * coverageModelService.pruneCoverageUnits has existed since MINCRM-616 but
 * had zero production callers — this wires it (and coverageSessionService's
 * sibling pruneCoverageSessions) into server.ts's daily cron schedule (see
 * server.ts's own runCoverageRetentionPruning call site). Runs
 * unconditionally, independent of COVERAGE_INSTRUMENTATION: the coverage
 * database's tables are populated by the pipeline/mapping/session-recorder
 * ingestion paths, all of which can run with the backend V8 agent off.
 *
 * pruneCoverageSessions covers coverage_sessions (whose started_by column
 * is the "session metadata (possible PII)" MINCRM-637's own AC names) and,
 * via ON DELETE CASCADE, coverage_session_dumps. Before this, only
 * coverage_units/coverage_test_links/coverage_ingested_dumps had any
 * retention at all — coverage_sessions had none (found via Greptile branch
 * review). coverage_build_summary remains deliberately unpruned — it is a
 * rolled-up aggregate, not raw per-dump telemetry, and grows at one row per
 * commit rather than per-dump/per-unit.
 *
 * The two prunes run independently (one's failure doesn't block the
 * other) and their counts are aggregated into one outcome — an operator
 * reading GET /health doesn't need to know there are two underlying
 * queries, only whether retention as a whole is healthy.
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
import { pruneCoverageSessions } from '../services/coverageSessionService.js';
import logger from '../logger.js';

export type RetentionPruneOutcome =
  | {
      ranAt: string;
      status: 'ok';
      prunedUnitCount: number;
      prunedLinkCount: number;
      prunedIngestedDumpCount: number;
      prunedSessionCount: number;
    }
  | { ranAt: string; status: 'error'; error: string };

let lastOutcome: RetentionPruneOutcome | undefined;

/** The most recent runCoverageRetentionPruning outcome, or undefined if the cron hasn't fired yet this process's lifetime (e.g. right after boot, before 07:00 first hits). */
export function getLastRetentionPruneOutcome(): RetentionPruneOutcome | undefined {
  return lastOutcome;
}

/** Prunes coverage_units/coverage_test_links/coverage_ingested_dumps and coverage_sessions/coverage_session_dumps rows older than `retentionDays`. */
export async function runCoverageRetentionPruning(retentionDays: number): Promise<void> {
  // Two independent settled calls, not a plain sequential await inside one
  // try — coverage_units and coverage_sessions are unrelated tables with no
  // cross-dependency (unlike coverage_units -> coverage_test_links within
  // pruneCoverageUnits itself, which IS a single transaction because that
  // relationship is real), so pruneCoverageUnits throwing must not prevent
  // pruneCoverageSessions from running, or vice versa.
  const [unitsSettled, sessionsSettled] = await Promise.allSettled([
    pruneCoverageUnits(retentionDays),
    pruneCoverageSessions(retentionDays),
  ]);

  if (unitsSettled.status === 'rejected' || sessionsSettled.status === 'rejected') {
    const errors = [unitsSettled, sessionsSettled]
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
    const combinedError = errors.join('; ');
    lastOutcome = { ranAt: new Date().toISOString(), status: 'error', error: combinedError };
    throw new Error(combinedError);
  }

  const { prunedUnitCount, prunedLinkCount, prunedIngestedDumpCount } = unitsSettled.value;
  const prunedSessionCount = sessionsSettled.value;

  logger.info(
    {
      retentionDays,
      prunedUnitCount,
      prunedLinkCount,
      prunedIngestedDumpCount,
      prunedSessionCount,
    },
    'Coverage retention pruning complete',
  );
  lastOutcome = {
    ranAt: new Date().toISOString(),
    status: 'ok',
    prunedUnitCount,
    prunedLinkCount,
    prunedIngestedDumpCount,
    prunedSessionCount,
  };
}
