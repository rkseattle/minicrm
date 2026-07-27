/**
 * Integration tests for coverageRetentionScheduler. (MINCRM-637)
 *
 * Runs against a real coverage database — asserts runCoverageRetentionPruning
 * calls through to pruneCoverageUnits with the retentionDays it's given,
 * using the real upsert/prune path rather than mocking coverageModelService
 * (that module's own tests already cover the SQL-level prune/orphan-cleanup
 * behavior in depth). retentionDays is a caller-supplied parameter, not
 * resolved internally via coveragePolicyConfig — see this module's own
 * docblock for why (resolveCoveragePolicy() shells out to `git rev-parse`,
 * which must not re-run on every scheduled cron tick) — so there is no
 * env-var-resolution behavior to test here; that belongs to
 * coveragePolicyConfig.test.ts.
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import { vi } from 'vitest';
import {
  runCoverageRetentionPruning,
  getLastRetentionPruneOutcome,
} from '../coverageAgent/coverageRetentionScheduler.js';
import {
  findCoverageUnitsByCommitSha,
  upsertCoverageUnits,
} from '../services/coverageModelService.js';
import * as coverageModelService from '../services/coverageModelService.js';
import type { NormalizedCoverageUnit } from '../coverageAgent/pipeline/normalizedCoverageUnit.js';
import coverageDb from '../coverageDb.js';

const FILE_PREFIX = 'coverage-retention-scheduler';

function makeUnit(overrides: Partial<NormalizedCoverageUnit> = {}): NormalizedCoverageUnit {
  return {
    filePath: `${FILE_PREFIX}/widget.ts`,
    unitKey: 'render@10',
    branchId: '0:0',
    granularity: 'branch',
    hitCount: 1,
    resolved: true,
    unresolvedReason: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await coverageDb.query('DELETE FROM coverage_units WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
});

afterEach(async () => {
  await coverageDb.query('DELETE FROM coverage_units WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
});

describe('runCoverageRetentionPruning', () => {
  it('prunes coverage_units rows older than the given retentionDays', async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [makeUnit()]);
    await coverageDb.query(
      `UPDATE coverage_units SET last_seen_at = now() - interval '100 days' WHERE commit_sha = $1`,
      [commitSha],
    );

    await runCoverageRetentionPruning(30);

    const stored = await findCoverageUnitsByCommitSha(commitSha);
    expect(stored).toHaveLength(0);
  });

  it('does not prune a row newer than the given retentionDays', async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [makeUnit()]);

    await runCoverageRetentionPruning(30);

    const stored = await findCoverageUnitsByCommitSha(commitSha);
    expect(stored).toHaveLength(1);
  });

  it('honors a retentionDays narrower than the coveragePolicyConfig default', async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [makeUnit()]);
    await coverageDb.query(
      `UPDATE coverage_units SET last_seen_at = now() - interval '2 days' WHERE commit_sha = $1`,
      [commitSha],
    );

    await runCoverageRetentionPruning(1);

    const stored = await findCoverageUnitsByCommitSha(commitSha);
    expect(stored).toHaveLength(0);
  });
});

describe('getLastRetentionPruneOutcome', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records status 'ok' with prunedUnitCount/prunedLinkCount after a successful run", async () => {
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [makeUnit()]);
    await coverageDb.query(
      `UPDATE coverage_units SET last_seen_at = now() - interval '100 days' WHERE commit_sha = $1`,
      [commitSha],
    );

    const before = Date.now();
    await runCoverageRetentionPruning(30);
    const outcome = getLastRetentionPruneOutcome();

    expect(outcome?.status).toBe('ok');
    if (outcome?.status === 'ok') {
      expect(outcome.prunedUnitCount).toBeGreaterThanOrEqual(1);
      expect(typeof outcome.prunedLinkCount).toBe('number');
    }
    expect(new Date(outcome!.ranAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("records status 'error' with the failure message, and still re-throws to the caller (server.ts's own cron .catch() must still fire)", async () => {
    // Regression test: the daily cron's failure previously only ever
    // reached logger.error, with GET /health continuing to report
    // status: 'ok' indefinitely — this is the one background job
    // MINCRM-637 introduces, and a failed run must now be observable on
    // the health report too (found via Greptile branch review).
    vi.spyOn(coverageModelService, 'pruneCoverageUnits').mockRejectedValue(
      new Error('coverage db unreachable'),
    );

    await expect(runCoverageRetentionPruning(30)).rejects.toThrow('coverage db unreachable');

    const outcome = getLastRetentionPruneOutcome();
    expect(outcome?.status).toBe('error');
    if (outcome?.status === 'error') {
      expect(outcome.error).toBe('coverage db unreachable');
    }
  });
});
