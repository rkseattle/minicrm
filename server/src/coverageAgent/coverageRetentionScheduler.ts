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
 */

import { pruneCoverageUnits } from '../services/coverageModelService.js';
import logger from '../logger.js';

/** Prunes coverage_units/coverage_test_links rows older than `retentionDays`. */
export async function runCoverageRetentionPruning(retentionDays: number): Promise<void> {
  const { prunedUnitCount, prunedLinkCount } = await pruneCoverageUnits(retentionDays);
  logger.info(
    { retentionDays, prunedUnitCount, prunedLinkCount },
    'Coverage retention pruning complete',
  );
}
