/**
 * Unit tests for coverageHealthService. (MINCRM-637)
 *
 * Runs against the real coverage database and the real featureFlagService
 * cache (toggled via setFlagEnabled, same pattern as
 * coveragePipelineController.test.ts). The degraded-db tests mock
 * coverageDb.connect() the same way health.test.ts mocks the product
 * pool's own connect() for /api/health's equivalent failure-mode tests.
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
import { getCoverageHealth } from '../services/coverageHealthService.js';
import { __clearCacheForTest } from '../services/featureFlagService.js';
import coverageDb from '../coverageDb.js';
import pool from '../db.js';

const FLAG_KEYS = [
  'coverage_pipeline_ingestion',
  'coverage_mapping_query',
  'coverage_reporting_query',
] as const;

async function setFlagEnabled(flagKey: string, enabled: boolean): Promise<void> {
  await pool.query(`UPDATE feature_flags SET enabled = $1 WHERE flag_key = $2`, [enabled, flagKey]);
  __clearCacheForTest();
}

afterEach(async () => {
  vi.restoreAllMocks();
  // Restore every flag to enabled — matches .env.test's own expected
  // baseline for the rest of this worker's test files, same restoration
  // discipline coveragePipelineController.test.ts's own afterAll uses.
  for (const key of FLAG_KEYS) {
    await setFlagEnabled(key, true);
  }
});

describe('getCoverageHealth', () => {
  it('reports status ok, db ok, agentRunning true, and every flag true when everything is healthy', async () => {
    vi.spyOn(coverageAgentRegistry, 'getCoverageAgent').mockReturnValue(
      {} as ReturnType<typeof coverageAgentRegistry.getCoverageAgent>,
    );
    for (const key of FLAG_KEYS) {
      await setFlagEnabled(key, true);
    }

    const health = await getCoverageHealth();

    expect(health.status).toBe('ok');
    expect(health.db).toBe('ok');
    expect(health.agentRunning).toBe(true);
    expect(health.featureFlags).toEqual({
      coverage_pipeline_ingestion: true,
      coverage_mapping_query: true,
      coverage_reporting_query: true,
    });
    expect(health.dbError).toBeUndefined();
  });

  it('reports agentRunning: false when the registry holds no agent, without affecting overall status', async () => {
    vi.spyOn(coverageAgentRegistry, 'getCoverageAgent').mockReturnValue(undefined);

    const health = await getCoverageHealth();

    expect(health.agentRunning).toBe(false);
    expect(health.status).toBe('ok');
    expect(health.db).toBe('ok');
  });

  it('reports each flag independently — false for a disabled flag, true for the others', async () => {
    await setFlagEnabled('coverage_mapping_query', false);

    const health = await getCoverageHealth();

    expect(health.featureFlags.coverage_mapping_query).toBe(false);
    expect(health.featureFlags.coverage_pipeline_ingestion).toBe(true);
    expect(health.featureFlags.coverage_reporting_query).toBe(true);
    // A disabled feature flag is a normal operational state, not degraded —
    // only DB unreachability affects overall status.
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

  it('reports status degraded (not a rejected promise) when a feature-flag read fails, falling back to false for every flag', async () => {
    // isFeatureEnabled (featureFlagService.ts) reads the PRODUCT database via
    // an unguarded pool.query() — a cold cache plus a product-DB outage
    // would previously reject getCoverageHealth()'s whole Promise.all,
    // making the health endpoint 500 instead of reporting the exact
    // degraded state it exists to surface (found via Greptile branch
    // review). __clearCacheForTest() forces getCachedRows() to re-query
    // rather than serve the cache set by the beforeEach/afterEach fixtures
    // above. Only the feature_flags query is rejected, not every pool.query
    // call — the afterEach below restores flags to enabled via pool.query
    // too, and scoping this consistently with coverageHealthController.test.ts's
    // equivalent case avoids any dependency on vi.restoreAllMocks() running
    // before that restore loop.
    __clearCacheForTest();
    const realQuery = pool.query.bind(pool);
    vi.spyOn(pool, 'query').mockImplementation(((...args: Parameters<typeof pool.query>) => {
      const sql = typeof args[0] === 'string' ? args[0] : (args[0] as { text: string }).text;
      if (sql.includes('FROM feature_flags')) {
        return Promise.reject(new Error('product db unreachable'));
      }
      return realQuery(...args);
    }) as typeof pool.query);

    const health = await getCoverageHealth();

    expect(health.status).toBe('degraded');
    expect(health.featureFlags).toEqual({
      coverage_pipeline_ingestion: false,
      coverage_mapping_query: false,
      coverage_reporting_query: false,
    });
    expect(health.featureFlagsError).toBe('product db unreachable');
  });
});
