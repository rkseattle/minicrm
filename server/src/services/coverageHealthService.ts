/**
 * Coverage/TIA operational health check. (MINCRM-637)
 *
 * Reports three things an operator needs to know the framework's own
 * services are working: whether the backend V8 agent is running, whether
 * the coverage database is reachable, and each of the three live feature
 * flags' current org-wide state (coverage_pipeline_ingestion,
 * coverage_mapping_query, coverage_reporting_query — see
 * docs/dev/coverage.md's "Policy Configuration" section for the full list;
 * coverage_instrumentation/coverage_session_management were removed by
 * migration 161 in favor of boot-time env vars, so there is no flag state
 * to report for those two routers here).
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
import { isFeatureEnabled } from './featureFlagService.js';

export type CoverageHealthStatus = 'ok' | 'degraded';

export interface CoverageHealthReport {
  status: CoverageHealthStatus;
  agentRunning: boolean;
  db: 'ok' | 'error';
  dbError?: string;
  featureFlags: {
    coverage_pipeline_ingestion: boolean;
    coverage_mapping_query: boolean;
    coverage_reporting_query: boolean;
  };
  /** Present only when one or more feature-flag reads failed (e.g. the product DB was unreachable) — the corresponding featureFlags field falls back to false rather than the report itself failing. */
  featureFlagsError?: string;
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

/**
 * Resolves a single feature flag's state, never rejecting — isFeatureEnabled
 * (featureFlagService.ts) issues an unguarded pool.query() against the
 * PRODUCT database (this report's flags are product-DB rows, unlike
 * checkCoverageDb's coverage-DB check above) and propagates any rejection.
 * Without this wrapper, a cold flag cache plus a product-DB outage would
 * reject the whole getCoverageHealth() Promise.all and this endpoint would
 * 500 instead of reporting the exact degraded state it exists to surface
 * (found via Greptile branch review). Falls back to `false` on failure,
 * same fail-safe direction isFeatureEnabled itself already takes for an
 * unknown flag key.
 */
async function checkFeatureFlag(
  key: string,
): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }> {
  try {
    return { ok: true, enabled: await isFeatureEnabled(key) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Resolves the current operational health of the Coverage/TIA framework's own services. */
export async function getCoverageHealth(): Promise<CoverageHealthReport> {
  const [dbResult, pipelineResult, mappingResult, reportingResult] = await Promise.all([
    checkCoverageDb(),
    checkFeatureFlag('coverage_pipeline_ingestion'),
    checkFeatureFlag('coverage_mapping_query'),
    checkFeatureFlag('coverage_reporting_query'),
  ]);

  const agentRunning = getCoverageAgent() !== undefined;
  const featureFlags = {
    coverage_pipeline_ingestion: pipelineResult.ok ? pipelineResult.enabled : false,
    coverage_mapping_query: mappingResult.ok ? mappingResult.enabled : false,
    coverage_reporting_query: reportingResult.ok ? reportingResult.enabled : false,
  };
  const featureFlagsError = [pipelineResult, mappingResult, reportingResult].find(
    (r) => !r.ok,
  )?.error;

  if (!dbResult.ok || featureFlagsError !== undefined) {
    return {
      status: 'degraded',
      agentRunning,
      db: dbResult.ok ? 'ok' : 'error',
      ...(!dbResult.ok && { dbError: dbResult.error }),
      featureFlags,
      ...(featureFlagsError !== undefined && { featureFlagsError }),
    };
  }

  return {
    status: 'ok',
    agentRunning,
    db: 'ok',
    featureFlags,
  };
}
