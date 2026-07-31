/**
 * Unit tests for coverageHealthService. (MINCRM-637)
 *
 * Runs against the real coverage database. The degraded-db tests mock
 * coverageDb.connect() the same way health.test.ts mocks the product
 * pool's own connect() for /api/health's equivalent failure-mode tests.
 *
 * MINCRM-685: this file used to toggle three feature_flags rows and assert the
 * report's `featureFlags` block. Migration 163 deleted those rows; the report
 * now carries `routers`, read from the same COVERAGE_* env vars that decide at
 * boot whether each router registers its routes. The flag-toggling helper and
 * its afterEach restore loop are gone with them — the loop's own comment
 * claimed it maintained ".env.test's expected baseline for the rest of this
 * worker's test files", and after the DELETE it would have been a silent no-op
 * updating zero rows while still reading as a live cross-file contract. No
 * sibling suite depended on it: the mapping/reporting/pipeline controller specs
 * arrange their own state and no longer touch flags at all.
 *
 * agentRunning is asserted via a mocked coverageAgentRegistry.getCoverageAgent
 * — not by registering/not-registering a real NodeV8CoverageAgent:
 * coverageAgentRegistry has no unregister/reset export, so a real agent
 * registered by this test (or any other file sharing this worker process)
 * would permanently make "no agent registered" unobservable for the rest
 * of the run. Mocking the one function this service actually calls avoids
 * depending on cross-file/cross-test global registry state entirely.
 */

import 'dotenv/config';
import { vi } from 'vitest';
import * as coverageAgentRegistry from '../coverageAgent/coverageAgentRegistry.js';
import * as coverageRetentionScheduler from '../coverageAgent/coverageRetentionScheduler.js';
import { getCoverageHealth } from '../services/coverageHealthService.js';
import coverageDb from '../coverageDb.js';
import {
  COVERAGE_ROUTE_GATES_AT_BOOT,
  type CoverageRouteGateEnvVar,
} from '../coverageAgent/coverageBootGate.js';

/**
 * The env var behind each `routers` field.
 *
 * Typed against CoverageRouteGateEnvVar and asserted below to be members of
 * COVERAGE_ROUTE_GATE_ENV_VARS, rather than restated as free strings — same
 * discipline coverageRouteGating.test.ts follows, and for the same reason: a
 * hand-copied list drifts silently the moment a gate is renamed.
 */
const ROUTER_GATES = {
  pipeline: 'COVERAGE_PIPELINE_INGESTION',
  mapping: 'COVERAGE_MAPPING_QUERY',
  reporting: 'COVERAGE_REPORTING_QUERY',
} as const satisfies Record<string, CoverageRouteGateEnvVar>;

const originalGates = new Map<string, string | undefined>(
  Object.values(ROUTER_GATES).map((key) => [key, process.env[key]]),
);

afterEach(() => {
  vi.restoreAllMocks();
  // Restore whatever .env.test set, so a test that unsets a gate cannot leak
  // into the next one or into another file sharing this worker.
  for (const [key, value] of originalGates) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('getCoverageHealth', () => {
  it('reports agentRunning: true when the registry holds an agent', async () => {
    vi.spyOn(coverageAgentRegistry, 'getCoverageAgent').mockReturnValue(
      {} as ReturnType<typeof coverageAgentRegistry.getCoverageAgent>,
    );

    const health = await getCoverageHealth();

    expect(health.agentRunning).toBe(true);
    expect(health.status).toBe('ok');
    expect(health.db).toBe('ok');
    expect(health.dbError).toBeUndefined();
  });

  it('reports agentRunning: false when the registry holds no agent, without affecting overall status', async () => {
    vi.spyOn(coverageAgentRegistry, 'getCoverageAgent').mockReturnValue(undefined);

    const health = await getCoverageHealth();

    expect(health.agentRunning).toBe(false);
    expect(health.status).toBe('ok');
    expect(health.db).toBe('ok');
  });

  /**
   * `routers` is a BOOT SNAPSHOT (coverageBootGate's COVERAGE_ROUTE_GATES_AT_BOOT),
   * so it cannot be driven from here by mutating process.env — that is the
   * point of it, not a limitation. An earlier revision of these tests did
   * exactly that and passed only because the service read live, which let the
   * report claim every router was live against an app that had registered
   * none.
   *
   * The property worth pinning — that the report agrees with what actually
   * registered — needs one app boot with the gates unset, which is what
   * coverageHealthRouteGating.test.ts does (it already owns the single boot
   * this worker allows). What is left here is the shape of the report and the
   * fact that it reflects the snapshot rather than a hardcoded constant.
   */
  it('reports a routers field per coverage query router, matching the boot snapshot', async () => {
    const health = await getCoverageHealth();

    expect(Object.keys(health.routers).sort()).toEqual(['mapping', 'pipeline', 'reporting']);
    expect(health.routers).toEqual({
      pipeline: COVERAGE_ROUTE_GATES_AT_BOOT.COVERAGE_PIPELINE_INGESTION,
      mapping: COVERAGE_ROUTE_GATES_AT_BOOT.COVERAGE_MAPPING_QUERY,
      reporting: COVERAGE_ROUTE_GATES_AT_BOOT.COVERAGE_REPORTING_QUERY,
    });
  });

  it('does not follow a later process.env change — registration already happened', async () => {
    // The regression this guards: reading live made the report answer with the
    // current env while the routes stayed as registered, so an app booted with
    // the gates off still reported every router enabled.
    const before = (await getCoverageHealth()).routers;

    const previous = process.env[ROUTER_GATES.mapping];
    process.env[ROUTER_GATES.mapping] = previous === 'true' ? 'false' : 'true';
    try {
      const after = (await getCoverageHealth()).routers;
      expect(after).toEqual(before);
    } finally {
      if (previous === undefined) {
        delete process.env[ROUTER_GATES.mapping];
      } else {
        process.env[ROUTER_GATES.mapping] = previous;
      }
    }
  });

  it('does not degrade status on account of unregistered routers — every gate unset is the production default', async () => {
    const health = await getCoverageHealth();

    // Whatever the snapshot holds in this worker, it must not drive status:
    // only coverage-DB unreachability or a failed retention prune do.
    expect(health.status).toBe('ok');
  });

  it('reports status degraded and db error when coverageDb.connect() throws (pool exhaustion / connection refused)', async () => {
    vi.spyOn(coverageDb, 'connect').mockRejectedValue(new Error('Connection refused'));

    const health = await getCoverageHealth();

    expect(health.status).toBe('degraded');
    expect(health.db).toBe('error');
    expect(health.dbError).toBe('Connection refused');
  });

  it('reports status degraded and releases the client when the SELECT 1 query throws (e.g. statement_timeout)', async () => {
    const mockClient = {
      query: vi.fn().mockRejectedValue(new Error('statement timeout')),
      release: vi.fn(),
    };
    vi.spyOn(coverageDb, 'connect').mockResolvedValue(mockClient as never);

    const health = await getCoverageHealth();

    expect(health.status).toBe('degraded');
    expect(health.db).toBe('error');
    expect(health.dbError).toBe('statement timeout');
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  // The former "feature-flag read fails" degraded case is gone with the flag
  // reads themselves (MINCRM-685). It covered isFeatureEnabled rejecting
  // against the PRODUCT database and the report falling back to false rather
  // than 500ing. This report no longer touches the product database at all —
  // see the service's own docblock for why that is correct rather than merely
  // tolerable — so there is no such failure mode left to pin.

  it('omits lastRetentionPrune and stays status ok when the retention cron has not run yet this process (undefined is the normal post-boot state)', async () => {
    vi.spyOn(coverageRetentionScheduler, 'getLastRetentionPruneOutcome').mockReturnValue(undefined);

    const health = await getCoverageHealth();

    expect(health.status).toBe('ok');
    expect(health.lastRetentionPrune).toBeUndefined();
  });

  it("includes lastRetentionPrune without affecting status when the last prune succeeded ('ok' is not itself a degraded condition)", async () => {
    vi.spyOn(coverageRetentionScheduler, 'getLastRetentionPruneOutcome').mockReturnValue({
      ranAt: '2026-07-26T07:00:00.000Z',
      status: 'ok',
      prunedUnitCount: 3,
      prunedLinkCount: 1,
      prunedIngestedDumpCount: 2,
      prunedSessionCount: 5,
    });

    const health = await getCoverageHealth();

    expect(health.status).toBe('ok');
    expect(health.lastRetentionPrune).toEqual({
      ranAt: '2026-07-26T07:00:00.000Z',
      status: 'ok',
      prunedUnitCount: 3,
      prunedLinkCount: 1,
      prunedIngestedDumpCount: 2,
      prunedSessionCount: 5,
    });
  });

  it('reports status degraded when the last scheduled retention prune failed — the one background job this endpoint would otherwise never surface', async () => {
    // Regression test: a failed nightly prune previously only ever reached
    // logger.error, with GET /health continuing to report status: 'ok'
    // indefinitely (found via Greptile branch review).
    vi.spyOn(coverageRetentionScheduler, 'getLastRetentionPruneOutcome').mockReturnValue({
      ranAt: '2026-07-26T07:00:00.000Z',
      status: 'error',
      error: 'coverage db unreachable',
    });

    const health = await getCoverageHealth();

    expect(health.status).toBe('degraded');
    expect(health.lastRetentionPrune).toEqual({
      ranAt: '2026-07-26T07:00:00.000Z',
      status: 'error',
      error: 'coverage db unreachable',
    });
  });
});
