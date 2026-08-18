/**
 * Integration tests for coverageIngestionService.
 *
 * Exercises the full pipeline end to end against real infrastructure: a
 * real NodeV8CoverageAgent dump (file-based, under the service's own
 * COVERAGE_DUMPS_ROOT — mirrors coverageDumpService.test.ts's approach) and
 * a real PostgreSQL test database for the resulting coverage_units rows.
 * No mocking of v8-to-istanbul or the DB layer — this is the seam where a
 * subtly wrong integration (e.g. the sourceRoot/realpath mismatch found
 * during development) would otherwise only surface at runtime.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { NodeV8CoverageAgent } from '../coverageAgent/NodeV8CoverageAgent.js';
import { registerCoverageAgent } from '../coverageAgent/coverageAgentRegistry.js';
import { __clearSharedDumpIndexesForTest } from '../coverageAgent/dumpIndex.js';
import { COVERAGE_DUMPS_ROOT } from '../coverageAgent/coverageConfig.js';
import { dumpBackendCoverage } from '../services/coverageDumpService.js';
import { findCoverageUnitsByCommitSha } from '../services/coverageModelService.js';
import { findUnitsForTest } from '../services/coverageMappingService.js';
import { findBuildSummaryByCommitSha } from '../services/coverageBuildSummaryService.js';
import {
  startCoverageSession,
  recordCoverageSessionDump,
} from '../services/coverageSessionService.js';
import type { CoverageSessionActor } from '../services/coverageSessionService.js';
import {
  CoverageDumpMalformedError,
  CoverageDumpNotFoundError,
  ingestCoverageDump,
} from '../coverageAgent/pipeline/coverageIngestionService.js';
import coverageDb from '../coverageDb.js';
import logger from '../logger.js';

const TEST_COMMIT_SHA = 'test-ingestion-sha';

let agent: NodeV8CoverageAgent;
let sourceRoot: string;
// Not a real product-DB user — coverage_sessions.started_by is a plain uuid
// with no cross-database foreign key (see qa/migrations/001_coverage_baseline.js),
// so any well-formed UUID is valid attribution here.
const sessionActor: CoverageSessionActor = { id: randomUUID() };

beforeEach(async () => {
  sourceRoot = await mkdtemp(join(tmpdir(), 'minicrm-ingestion-test-'));
  await writeFile(
    join(sourceRoot, 'fixture.js'),
    [
      'function branchy(flag) {',
      '  if (flag) {',
      '    return "yes";',
      '  }',
      '  return "no";',
      '}',
      'module.exports = { branchy };',
    ].join('\n'),
    'utf8',
  );

  agent = new NodeV8CoverageAgent({
    dumpsRoot: COVERAGE_DUMPS_ROOT,
    commitSha: TEST_COMMIT_SHA,
    granularity: 'block',
  });
  await agent.start();
  registerCoverageAgent(agent);
});

afterEach(async () => {
  await agent.stop();
  await rm(COVERAGE_DUMPS_ROOT, { recursive: true, force: true });
  await rm(sourceRoot, { recursive: true, force: true });
  await coverageDb.query('DELETE FROM coverage_units WHERE commit_sha = $1', [TEST_COMMIT_SHA]);
  await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [
    TEST_COMMIT_SHA,
  ]);
  await coverageDb.query(
    'DELETE FROM coverage_session_dumps WHERE correlation_id IN (SELECT correlation_id FROM coverage_sessions WHERE build_sha = $1)',
    [TEST_COMMIT_SHA],
  );
  await coverageDb.query('DELETE FROM coverage_sessions WHERE build_sha = $1', [TEST_COMMIT_SHA]);
  await coverageDb.query('DELETE FROM coverage_build_summary WHERE commit_sha = $1', [
    TEST_COMMIT_SHA,
  ]);
  // Deleting COVERAGE_DUMPS_ROOT above invalidates the shared DumpIndex
  // singleton's in-memory cache for this root — without clearing the
  // registry, the next test's beforeEach recreates the directory but
  // getSharedDumpIndex() would hand back the same (now-stale) instance,
  // reintroducing the exact cross-instance staleness the shared singleton
  // was built to prevent, just across test boundaries instead of across
  // agent/service instances. See dumpIndex.ts's __clearSharedDumpIndexesForTest.
  __clearSharedDumpIndexesForTest();
});

describe('coverageIngestionService', () => {
  it('ingests a real backend dump end to end into coverage_units', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- exercising real V8 coverage requires a real require() call to instrument
    require(join(sourceRoot, 'fixture.js')).branchy(true);
    const dump = await dumpBackendCoverage('ingestion-test');

    const result = await ingestCoverageDump(dump.dumpId, { sourceRoot });

    expect(result.alreadyIngested).toBe(false);
    expect(result.commitSha).toBe(TEST_COMMIT_SHA);
    expect(result.unitCount).toBeGreaterThan(0);

    const stored = await findCoverageUnitsByCommitSha(TEST_COMMIT_SHA);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((unit) => unit.commitSha === TEST_COMMIT_SHA)).toBe(true);
  });

  it('logs completion with dumpId, durationMs, and unitCount', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(join(sourceRoot, 'fixture.js')).branchy(true);
    const dump = await dumpBackendCoverage('logging-test');

    await ingestCoverageDump(dump.dumpId, { sourceRoot });

    const call = infoSpy.mock.calls.find(
      ([, message]) => message === 'coverageIngestionService: ingested coverage dump',
    );
    expect(call).toBeDefined();
    const [fields] = call ?? [];
    expect(fields).toMatchObject({ dumpId: dump.dumpId });
    expect(typeof (fields as { durationMs?: unknown })?.durationMs).toBe('number');
    expect((fields as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof (fields as { unitCount?: unknown })?.unitCount).toBe('number');
    infoSpy.mockRestore();
  });

  it('is idempotent — re-ingesting the same dumpId is a no-op that reports alreadyIngested', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(join(sourceRoot, 'fixture.js')).branchy(false);
    const dump = await dumpBackendCoverage('idempotency-test');

    const first = await ingestCoverageDump(dump.dumpId, { sourceRoot });
    const stored1 = await findCoverageUnitsByCommitSha(TEST_COMMIT_SHA);

    const second = await ingestCoverageDump(dump.dumpId, { sourceRoot });
    const stored2 = await findCoverageUnitsByCommitSha(TEST_COMMIT_SHA);

    expect(first.alreadyIngested).toBe(false);
    expect(second.alreadyIngested).toBe(true);
    // No double-counting: hit_count totals are identical after the no-op re-ingest.
    expect(stored2.reduce((sum, u) => sum + u.hitCount, 0)).toBe(
      stored1.reduce((sum, u) => sum + u.hitCount, 0),
    );
  });

  it('throws CoverageDumpNotFoundError for an unknown dumpId', async () => {
    await expect(ingestCoverageDump(randomUUID(), { sourceRoot })).rejects.toBeInstanceOf(
      CoverageDumpNotFoundError,
    );
  });

  it('throws CoverageDumpMalformedError when the raw dump payload file is corrupt', async () => {
    const dump = await dumpBackendCoverage('malformed-test');
    const payloadPath = join(COVERAGE_DUMPS_ROOT, dump.path);
    await writeFile(payloadPath, '{ not valid json', 'utf8');

    await expect(ingestCoverageDump(dump.dumpId, { sourceRoot })).rejects.toBeInstanceOf(
      CoverageDumpMalformedError,
    );
  });

  describe('test attribution', () => {
    it('links ingested units to the test recorded against the dump via coverage_session_dumps', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(join(sourceRoot, 'fixture.js')).branchy(true);
      const dump = await dumpBackendCoverage('attribution-test');

      const session = await startCoverageSession(
        {
          label: 'attribution-test-session',
          source: 'automated-e2e',
          buildSha: TEST_COMMIT_SHA,
          environment: 'test',
        },
        sessionActor,
      );
      await recordCoverageSessionDump(session.id, dump.dumpId, session.correlationId, {
        testId: 'spec:deals/deal-creation.spec.ts::creates a deal',
        testName: 'creates a deal',
        testFile: 'tests/apps/minicrm/functional/deals/deal-creation.spec.ts',
      });

      const result = await ingestCoverageDump(dump.dumpId, { sourceRoot });
      expect(result.alreadyIngested).toBe(false);

      const links = await findUnitsForTest(
        TEST_COMMIT_SHA,
        'spec:deals/deal-creation.spec.ts::creates a deal',
      );
      expect(links.length).toBeGreaterThan(0);
      expect(links.every((link) => link.testName === 'creates a deal')).toBe(true);
      expect(links.every((link) => link.commitSha === TEST_COMMIT_SHA)).toBe(true);
      // groundwork: testFile must reach coverage_test_links so a
      // selected testId can be resolved back to the spec file that produced it.
      expect(
        links.every(
          (link) => link.testFile === 'tests/apps/minicrm/functional/deals/deal-creation.spec.ts',
        ),
      ).toBe(true);
    });

    it('produces no coverage_test_links rows for a dump with no session attribution', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(join(sourceRoot, 'fixture.js')).branchy(true);
      const dump = await dumpBackendCoverage('no-attribution-test');

      await ingestCoverageDump(dump.dumpId, { sourceRoot });

      const links = await findUnitsForTest(TEST_COMMIT_SHA, 'nonexistent-test-id');
      expect(links).toHaveLength(0);
    });

    it('does not double-count hit_count in coverage_test_links on a repeat ingest of the same dump', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(join(sourceRoot, 'fixture.js')).branchy(true);
      const dump = await dumpBackendCoverage('attribution-idempotency-test');

      const session = await startCoverageSession(
        {
          label: 'attribution-idempotency-session',
          source: 'automated-e2e',
          buildSha: TEST_COMMIT_SHA,
          environment: 'test',
        },
        sessionActor,
      );
      await recordCoverageSessionDump(session.id, dump.dumpId, session.correlationId, {
        testId: 'spec:idempotency.spec.ts::test',
      });

      await ingestCoverageDump(dump.dumpId, { sourceRoot });
      const linksAfterFirst = await findUnitsForTest(
        TEST_COMMIT_SHA,
        'spec:idempotency.spec.ts::test',
      );

      await ingestCoverageDump(dump.dumpId, { sourceRoot });
      const linksAfterSecond = await findUnitsForTest(
        TEST_COMMIT_SHA,
        'spec:idempotency.spec.ts::test',
      );

      expect(linksAfterSecond.reduce((sum, l) => sum + l.hitCount, 0)).toBe(
        linksAfterFirst.reduce((sum, l) => sum + l.hitCount, 0),
      );
    });
  });

  describe('build summary rollup', () => {
    it('upserts a coverage_build_summary row on ingestion, even with no session/test attribution', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(join(sourceRoot, 'fixture.js')).branchy(true);
      const dump = await dumpBackendCoverage('summary-no-attribution-test');

      await ingestCoverageDump(dump.dumpId, { sourceRoot });

      const summary = await findBuildSummaryByCommitSha(TEST_COMMIT_SHA);
      expect(summary).not.toBeNull();
      expect(summary!.apiUnitCount).toBeGreaterThan(0);
    });

    it('recomputes the build summary to reflect a second dump ingested for the same commit', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(join(sourceRoot, 'fixture.js')).branchy(true);
      const firstDump = await dumpBackendCoverage('summary-first-dump');
      await ingestCoverageDump(firstDump.dumpId, { sourceRoot });
      const summaryAfterFirst = await findBuildSummaryByCommitSha(TEST_COMMIT_SHA);

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(join(sourceRoot, 'fixture.js')).branchy(false);
      const secondDump = await dumpBackendCoverage('summary-second-dump');
      await ingestCoverageDump(secondDump.dumpId, { sourceRoot });
      const summaryAfterSecond = await findBuildSummaryByCommitSha(TEST_COMMIT_SHA);

      expect(summaryAfterSecond!.apiCoveredUnitCount).toBeGreaterThanOrEqual(
        summaryAfterFirst!.apiCoveredUnitCount,
      );
    });

    it('does not create a second summary row when re-ingesting an already-ingested dumpId', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(join(sourceRoot, 'fixture.js')).branchy(true);
      const dump = await dumpBackendCoverage('summary-idempotency-test');

      await ingestCoverageDump(dump.dumpId, { sourceRoot });
      const summaryAfterFirst = await findBuildSummaryByCommitSha(TEST_COMMIT_SHA);

      await ingestCoverageDump(dump.dumpId, { sourceRoot });
      const summaryAfterSecond = await findBuildSummaryByCommitSha(TEST_COMMIT_SHA);

      expect(summaryAfterSecond).toEqual(summaryAfterFirst);
    });
  });
});
