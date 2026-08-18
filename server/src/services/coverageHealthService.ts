/**
 * Coverage/TIA operational health check.
 *
 * Reports what an operator needs to know the framework's own services are
 * working: whether the backend V8 agent is running, whether the coverage
 * database is reachable, which coverage routers actually registered their
 * routes at boot, and the outcome of the most recent scheduled retention
 * prune — the one background job introduced here that runs
 * unattended and would otherwise be invisible here (a failed nightly prune
 * previously only logged an error; this report continued to say
 * status: 'ok' indefinitely — found via Greptile branch review).
 *
 * `routers` reports which coverage routers registered at boot, from
 * coverageBootGate's snapshot. Unregistered routers are NOT a
 * degraded condition: every gate unset is the production default, so treating
 * it as one would leave every normal deployment's check permanently red.
 * `degraded` is driven solely by an unreachable coverage database or a failed
 * retention prune.
 *
 * This report deliberately never touches the product database. The coverage
 * subsystem has no product-DB dependency to report on, so degrading on a
 * product-DB outage would be reporting someone else's failure; app.ts's own
 * /api/health covers that.
 *
 * Not wrapped in a transaction (BEGIN/COMMIT) around the SET LOCAL
 * statement_timeout call — mirrors app.ts's own /api/health implementation
 * exactly, including that same characteristic: SET LOCAL only actually
 * scopes to a transaction, so outside one this is a session-wide SET that
 * a pooled connection carries until it's reset/released, same as the
 * product health check already does. Not fixed here since this function's
 * job is to match established precedent, not to depart from it.
 */

import coverageDb from '../coverageDb.js';
import { getCoverageAgent } from '../coverageAgent/coverageAgentRegistry.js';
import { COVERAGE_ROUTE_GATES_AT_BOOT } from '../coverageAgent/coverageBootGate.js';
import {
  getLastRetentionPruneOutcome,
  type RetentionPruneOutcome,
} from '../coverageAgent/coverageRetentionScheduler.js';

export type CoverageHealthStatus = 'ok' | 'degraded';

export interface CoverageHealthReport {
  status: CoverageHealthStatus;
  agentRunning: boolean;
  db: 'ok' | 'error';
  dbError?: string;
  /** Which coverage routers registered their routes at boot. False means every path under that router 404s. */
  routers: {
    pipeline: boolean;
    mapping: boolean;
    reporting: boolean;
  };
  /** Outcome of the most recent scheduled retention prune, or undefined if it hasn't run yet this process's lifetime (e.g. right after boot, before the daily cron first fires — NOT itself a degraded condition). */
  lastRetentionPrune?: RetentionPruneOutcome;
}

async function checkCoverageDb(): Promise<{ ok: true } | { ok: false; error: string }> {
  let client;
  try {
    client = await coverageDb.connect();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }

  try {
    // SET LOCAL limits this timeout to the current transaction only — see
    // this module's own docblock for why that guarantee doesn't actually
    // apply here, matching app.ts's own /api/health precedent.
    await client.query("SET LOCAL statement_timeout = '2s'");
    await client.query('SELECT 1');
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    client.release();
  }
}

/** Resolves the current operational health of the Coverage/TIA framework's own services. */
export async function getCoverageHealth(): Promise<CoverageHealthReport> {
  const dbResult = await checkCoverageDb();

  const agentRunning = getCoverageAgent() !== undefined;
  // From the BOOT SNAPSHOT, not a live process.env read. "Did this router
  // register?" is a question about the past: registration ran once during
  // module evaluation, and process.env can be mutated afterwards. A live read
  // would answer with the current value while the routes stay as they were —
  // reporting every router enabled against an app that registered none, which
  // is precisely what coverageRouteGating.test.ts produces when it deletes the
  // gates, boots, and restores the environment. Verified: a live read there
  // returned {pipeline: true, mapping: true, reporting: true} while every one
  // of those paths 404'd.
  //
  // Sharing coverageBootGate's snapshot rather than re-deriving it also means
  // this report and registerRoutesIfEnabled cannot disagree about what
  // "enabled" means, and the typed keys make a mistyped var a compile error
  // rather than a silent always-false.
  const routers = {
    pipeline: COVERAGE_ROUTE_GATES_AT_BOOT.COVERAGE_PIPELINE_INGESTION,
    mapping: COVERAGE_ROUTE_GATES_AT_BOOT.COVERAGE_MAPPING_QUERY,
    reporting: COVERAGE_ROUTE_GATES_AT_BOOT.COVERAGE_REPORTING_QUERY,
  };

  // undefined (never run yet this process's lifetime) is NOT a degraded
  // condition — right after boot, before the daily cron first fires at
  // 07:00, is the normal state for every process. Only an actual recorded
  // 'error' outcome degrades the report.
  const lastRetentionPrune = getLastRetentionPruneOutcome();
  const retentionPruneFailed = lastRetentionPrune?.status === 'error';

  if (!dbResult.ok || retentionPruneFailed) {
    return {
      status: 'degraded',
      agentRunning,
      db: dbResult.ok ? 'ok' : 'error',
      ...(!dbResult.ok && { dbError: dbResult.error }),
      routers,
      ...(lastRetentionPrune !== undefined && { lastRetentionPrune }),
    };
  }

  return {
    status: 'ok',
    agentRunning,
    db: 'ok',
    routers,
    ...(lastRetentionPrune !== undefined && { lastRetentionPrune }),
  };
}
