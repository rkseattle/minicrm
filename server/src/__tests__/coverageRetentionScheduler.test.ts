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
import { runCoverageRetentionPruning } from '../coverageAgent/coverageRetentionScheduler.js';
import {
  findCoverageUnitsByCommitSha,
  upsertCoverageUnits,
} from '../services/coverageModelService.js';
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
