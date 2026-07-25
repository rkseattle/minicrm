/**
 * Integration tests for coverageReportingService. (MINCRM-629/630/631)
 *
 * Summary/trend/gaps-by-commit tests run against the real coverage test
 * database. findChangedUntestedUnits is exercised against a REAL git
 * repository (mkdtemp + git init/commit), matching changeUnitResolver.test.ts's
 * own precedent, since it shells real `git diff`/`git show` under the hood.
 */

import 'dotenv/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import {
  getCoverageSummary,
  getCoverageTrend,
  findDeadZoneUnits,
  findNeverTakenBranches,
  findChangedUntestedUnits,
  getIssueCoverage,
  getTiaValueMetrics,
  CoverageBuildNotFoundError,
} from '../services/coverageReportingService.js';
import { upsertBuildSummaryForCommit } from '../services/coverageBuildSummaryService.js';
import coverageDb from '../coverageDb.js';

const FILE_PREFIX = 'coverage-reporting-svc';
const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

async function gitRevParseHead(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

async function initRepo(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'coverage-reporting-service-test-'));
  await git(repoRoot, ['init', '--initial-branch=main']);
  await git(repoRoot, ['config', 'user.email', 'test@example.com']);
  await git(repoRoot, ['config', 'user.name', 'Test']);
  return repoRoot;
}

interface UnitInput {
  filePath: string;
  unitKey: string;
  branchId: string | null;
  granularity: 'branch' | 'function';
  agent: 'node-v8' | 'browser-istanbul';
  hitCount: number;
}

async function insertUnits(commitSha: string, units: UnitInput[]): Promise<void> {
  for (const unit of units) {
    await coverageDb.query(
      `INSERT INTO coverage_units
         (commit_sha, file_path, unit_key, branch_id, granularity, agent, hit_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        commitSha,
        unit.filePath,
        unit.unitKey,
        unit.branchId,
        unit.granularity,
        unit.agent,
        unit.hitCount,
      ],
    );
  }
}

async function insertTestLink(
  commitSha: string,
  testId: string,
  unit: { filePath: string; unitKey: string; branchId: string | null; hitCount: number },
): Promise<void> {
  await coverageDb.query(
    `INSERT INTO coverage_test_links
       (commit_sha, unit_key, branch_id, file_path, test_id, hit_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [commitSha, unit.unitKey, unit.branchId, unit.filePath, testId, unit.hitCount],
  );
}

async function insertSessionAndDump(params: {
  issueKey: string | null;
  source: 'automated-e2e' | 'manual';
  testId: string;
  buildSha?: string;
}): Promise<void> {
  const sessionResult = await coverageDb.query<{ id: string }>(
    `INSERT INTO coverage_sessions (label, source, build_sha, environment, issue_key)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      `${FILE_PREFIX} session`,
      params.source,
      params.buildSha ?? `${FILE_PREFIX}-sha`,
      'test',
      params.issueKey,
    ],
  );
  const sessionId = sessionResult.rows[0].id;

  await coverageDb.query(
    `INSERT INTO coverage_session_dumps (session_id, dump_id, correlation_id, test_id)
     VALUES ($1, $2, gen_random_uuid(), $3)`,
    [sessionId, randomUUID(), params.testId],
  );
}

async function upsertSummary(commitSha: string): Promise<void> {
  const client = await coverageDb.connect();
  try {
    await client.query('BEGIN');
    await upsertBuildSummaryForCommit(client, commitSha);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixtures(): Promise<void> {
  await coverageDb.query('DELETE FROM coverage_build_summary WHERE commit_sha LIKE $1', [
    `${FILE_PREFIX}-%`,
  ]);
  await coverageDb.query('DELETE FROM coverage_test_links WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
  await coverageDb.query('DELETE FROM coverage_session_dumps WHERE test_id LIKE $1', [
    `${FILE_PREFIX}::%`,
  ]);
  await coverageDb.query('DELETE FROM coverage_sessions WHERE label = $1', [
    `${FILE_PREFIX} session`,
  ]);
  await coverageDb.query('DELETE FROM coverage_units WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
}

beforeEach(cleanupFixtures);
afterAll(cleanupFixtures);

describe('coverageReportingService', () => {
  describe('getCoverageSummary', () => {
    it('returns overall + per-tier coverage percentages for a build', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      await insertUnits(commitSha, [
        {
          filePath: `${FILE_PREFIX}/a.ts`,
          unitKey: 'a#1',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 1,
        },
        {
          filePath: `${FILE_PREFIX}/b.ts`,
          unitKey: 'b#1',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 0,
        },
      ]);
      await upsertSummary(commitSha);

      const summary = await getCoverageSummary(commitSha);
      expect(summary.apiUnitCount).toBe(2);
      expect(summary.apiCoveredUnitCount).toBe(1);
      expect(summary.apiCoveragePercent).toBe(50);
      expect(summary.overallCoveragePercent).toBe(50);
    });

    it('throws CoverageBuildNotFoundError for a commit never ingested', async () => {
      await expect(getCoverageSummary(`${FILE_PREFIX}-${randomUUID()}`)).rejects.toThrow(
        CoverageBuildNotFoundError,
      );
    });

    it('reports 0 percent, never NaN, for a tier with zero units', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      await insertUnits(commitSha, [
        {
          filePath: `${FILE_PREFIX}/a.ts`,
          unitKey: 'a#1',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 1,
        },
      ]);
      await upsertSummary(commitSha);

      const summary = await getCoverageSummary(commitSha);
      expect(summary.frontendUnitCount).toBe(0);
      expect(summary.frontendCoveragePercent).toBe(0);
      expect(Number.isNaN(summary.frontendCoveragePercent)).toBe(false);
    });
  });

  describe('getCoverageTrend', () => {
    it('returns summaries most-recent-first, clamped to the requested limit', async () => {
      const commitShaA = `${FILE_PREFIX}-${randomUUID()}`;
      const commitShaB = `${FILE_PREFIX}-${randomUUID()}`;
      for (const sha of [commitShaA, commitShaB]) {
        await insertUnits(sha, [
          {
            filePath: `${FILE_PREFIX}/a.ts`,
            unitKey: 'a#1',
            branchId: null,
            granularity: 'function',
            agent: 'node-v8',
            hitCount: 1,
          },
        ]);
        await upsertSummary(sha);
      }

      const trend = await getCoverageTrend(1);
      expect(trend).toHaveLength(1);
    });
  });

  describe('findDeadZoneUnits', () => {
    it('finds units with hit_count = 0, excluding covered units', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      await insertUnits(commitSha, [
        {
          filePath: `${FILE_PREFIX}/a.ts`,
          unitKey: 'covered#1',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 5,
        },
        {
          filePath: `${FILE_PREFIX}/a.ts`,
          unitKey: 'dead#1',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 0,
        },
      ]);

      const deadZones = await findDeadZoneUnits(commitSha);
      expect(deadZones).toHaveLength(1);
      expect(deadZones[0].unitKey).toBe('dead#1');
    });
  });

  describe('findNeverTakenBranches', () => {
    it('finds only branch-granularity units with hit_count = 0', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      await insertUnits(commitSha, [
        {
          filePath: `${FILE_PREFIX}/a.ts`,
          unitKey: 'fn#1',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 0,
        },
        {
          filePath: `${FILE_PREFIX}/a.ts`,
          unitKey: 'fn#1',
          branchId: '0:0',
          granularity: 'branch',
          agent: 'node-v8',
          hitCount: 0,
        },
        {
          filePath: `${FILE_PREFIX}/a.ts`,
          unitKey: 'fn#1',
          branchId: '0:1',
          granularity: 'branch',
          agent: 'node-v8',
          hitCount: 3,
        },
      ]);

      const neverTaken = await findNeverTakenBranches(commitSha);
      expect(neverTaken).toHaveLength(1);
      expect(neverTaken[0]).toMatchObject({ branchId: '0:0', granularity: 'branch' });
    });
  });

  describe('findChangedUntestedUnits', () => {
    let repoRoot: string;

    afterEach(async () => {
      await rm(repoRoot, { recursive: true, force: true });
    });

    it('reports a changed function with no coverage_test_links row as untested', async () => {
      repoRoot = await initRepo();
      await writeFile(
        join(repoRoot, 'a.ts'),
        'export function calculateTotal() {\n  return 1;\n}\n',
      );
      await git(repoRoot, ['add', '.']);
      await git(repoRoot, ['commit', '-m', 'base']);
      const baseSha = await gitRevParseHead(repoRoot);

      await writeFile(
        join(repoRoot, 'a.ts'),
        'export function calculateTotal() {\n  return 2;\n}\n',
      );
      await git(repoRoot, ['add', '.']);
      await git(repoRoot, ['commit', '-m', 'edit']);
      const headSha = await gitRevParseHead(repoRoot);

      const untested = await findChangedUntestedUnits(baseSha, headSha, repoRoot);
      const inLine = untested.filter((u) => u.changeKind === 'in-line');
      expect(inLine).toHaveLength(1);
      expect(inLine[0].filePath).toBe('a.ts');
    });

    it('excludes a changed unit that already has a coverage_test_links row at headSha', async () => {
      repoRoot = await initRepo();
      await writeFile(
        join(repoRoot, 'a.ts'),
        'export function calculateTotal() {\n  return 1;\n}\n',
      );
      await git(repoRoot, ['add', '.']);
      await git(repoRoot, ['commit', '-m', 'base']);
      const baseSha = await gitRevParseHead(repoRoot);

      await writeFile(
        join(repoRoot, 'a.ts'),
        'export function calculateTotal() {\n  return 2;\n}\n',
      );
      await git(repoRoot, ['add', '.']);
      await git(repoRoot, ['commit', '-m', 'edit']);
      const headSha = await gitRevParseHead(repoRoot);

      const diffs = await findChangedUntestedUnits(baseSha, headSha, repoRoot);
      const inLine = diffs.find((u) => u.changeKind === 'in-line');
      expect(inLine).toBeDefined();

      await insertTestLink(headSha, `${FILE_PREFIX}::covers-it`, {
        filePath: 'a.ts',
        unitKey: inLine!.unitKey,
        branchId: null,
        hitCount: 1,
      });

      const untested = await findChangedUntestedUnits(baseSha, headSha, repoRoot);
      expect(untested.some((u) => u.unitKey === inLine!.unitKey)).toBe(false);
    });

    it('excludes deleted units — no code remains to test', async () => {
      repoRoot = await initRepo();
      await writeFile(join(repoRoot, 'a.ts'), 'export function toRemove() {\n  return 1;\n}\n');
      await git(repoRoot, ['add', '.']);
      await git(repoRoot, ['commit', '-m', 'base']);
      const baseSha = await gitRevParseHead(repoRoot);

      await execFileAsync('git', ['rm', 'a.ts'], { cwd: repoRoot });
      await git(repoRoot, ['commit', '-m', 'remove']);
      const headSha = await gitRevParseHead(repoRoot);

      const untested = await findChangedUntestedUnits(baseSha, headSha, repoRoot);
      expect(untested).toEqual([]);
    });

    it('clamps the number of returned units to the requested limit', async () => {
      // Regression test: findChangedUntestedUnits previously had no limit
      // parameter at all, contradicting /gaps' own documented "max units
      // per list" contract that findDeadZoneUnits/findNeverTakenBranches
      // already honor.
      repoRoot = await initRepo();
      await writeFile(
        join(repoRoot, 'a.ts'),
        'export function fnOne() {\n  return 1;\n}\nexport function fnTwo() {\n  return 1;\n}\nexport function fnThree() {\n  return 1;\n}\n',
      );
      await git(repoRoot, ['add', '.']);
      await git(repoRoot, ['commit', '-m', 'base']);
      const baseSha = await gitRevParseHead(repoRoot);

      await writeFile(
        join(repoRoot, 'a.ts'),
        'export function fnOne() {\n  return 2;\n}\nexport function fnTwo() {\n  return 2;\n}\nexport function fnThree() {\n  return 2;\n}\n',
      );
      await git(repoRoot, ['add', '.']);
      await git(repoRoot, ['commit', '-m', 'edit all three']);
      const headSha = await gitRevParseHead(repoRoot);

      const unbounded = await findChangedUntestedUnits(baseSha, headSha, repoRoot);
      expect(unbounded.length).toBeGreaterThanOrEqual(3);

      const clamped = await findChangedUntestedUnits(baseSha, headSha, repoRoot, 1);
      expect(clamped.length).toBeLessThanOrEqual(1);
    });
  });

  describe('getIssueCoverage', () => {
    it('rolls up covered units and distinct test IDs for an issue key', async () => {
      const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
      const issueKey = `MINCRM-${randomUUID().slice(0, 8)}`;
      const testId = `${FILE_PREFIX}::issue-test`;
      const unit = {
        filePath: `${FILE_PREFIX}/deals.ts`,
        unitKey: 'createDeal#1',
        branchId: null,
        hitCount: 1,
      };

      await insertSessionAndDump({
        issueKey,
        source: 'automated-e2e',
        testId,
        buildSha: commitSha,
      });
      await insertTestLink(commitSha, testId, unit);

      const coverage = await getIssueCoverage(issueKey, commitSha);
      expect(coverage.sessionCount).toBe(1);
      expect(coverage.coveredUnitCount).toBe(1);
      expect(coverage.testIds).toEqual([testId]);
    });

    it('returns zeroed coverage for an issue key with no sessions', async () => {
      const coverage = await getIssueCoverage(
        `MINCRM-${randomUUID().slice(0, 8)}`,
        `${FILE_PREFIX}-none`,
      );
      expect(coverage.sessionCount).toBe(0);
      expect(coverage.coveredUnitCount).toBe(0);
      expect(coverage.testIds).toEqual([]);
    });

    it('scopes sessionCount to the requested build, excluding sessions from a different build on the same issue', async () => {
      // Regression test: sessionCount used to have no build_sha filter at
      // all, so it silently reflected an issue's ENTIRE history across
      // every build it was ever touched on, while coveredUnitCount/testIds
      // (queried right after) were correctly scoped to just the requested
      // commitSha — a materially misleading mismatch surfaced directly on
      // TraceabilityPage's "Sessions" stat tile.
      const issueKey = `MINCRM-${randomUUID().slice(0, 8)}`;
      const commitShaA = `${FILE_PREFIX}-${randomUUID()}`;
      const commitShaB = `${FILE_PREFIX}-${randomUUID()}`;

      await insertSessionAndDump({
        issueKey,
        source: 'automated-e2e',
        testId: `${FILE_PREFIX}::build-a-test`,
        buildSha: commitShaA,
      });
      await insertSessionAndDump({
        issueKey,
        source: 'automated-e2e',
        testId: `${FILE_PREFIX}::build-b-test`,
        buildSha: commitShaB,
      });

      const coverageForA = await getIssueCoverage(issueKey, commitShaA);
      expect(coverageForA.sessionCount).toBe(1);

      const coverageForB = await getIssueCoverage(issueKey, commitShaB);
      expect(coverageForB.sessionCount).toBe(1);
    });
  });

  describe('getTiaValueMetrics', () => {
    it('averages per-tier coverage percent across a build range', async () => {
      const commitShaA = `${FILE_PREFIX}-${randomUUID()}`;
      const commitShaB = `${FILE_PREFIX}-${randomUUID()}`;

      await insertUnits(commitShaA, [
        {
          filePath: `${FILE_PREFIX}/a.ts`,
          unitKey: 'a#1',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 1,
        },
      ]);
      await upsertSummary(commitShaA);

      await insertUnits(commitShaB, [
        {
          filePath: `${FILE_PREFIX}/b.ts`,
          unitKey: 'b#1',
          branchId: null,
          granularity: 'function',
          agent: 'node-v8',
          hitCount: 0,
        },
      ]);
      await upsertSummary(commitShaB);

      const metrics = await getTiaValueMetrics(commitShaA, commitShaB);
      expect(metrics.totalBuilds).toBe(2);
      expect(metrics.averageApiCoveragePercent).toBe(50);
    });

    it('returns zeroed metrics, not NaN, for an empty range', async () => {
      const metrics = await getTiaValueMetrics(
        `${FILE_PREFIX}-missing-a`,
        `${FILE_PREFIX}-missing-b`,
      );
      expect(metrics.totalBuilds).toBe(0);
      expect(metrics.averageApiCoveragePercent).toBe(0);
      expect(metrics.averageFrontendCoveragePercent).toBe(0);
    });
  });
});
