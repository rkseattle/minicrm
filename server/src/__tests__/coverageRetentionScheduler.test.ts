/**
 * Integration tests for coverageRetentionScheduler.
 *
 * Runs against a real coverage database — asserts runCoverageRetentionPruning
 * calls through to pruneCoverageUnits/pruneCoverageSessions with the
 * retentionDays it's given, using the real upsert/prune paths rather than
 * mocking coverageModelService/coverageSessionService (those modules' own
 * tests already cover the SQL-level prune/orphan-cleanup behavior in
 * depth). retentionDays is a caller-supplied parameter, not resolved
 * internally via coveragePolicyConfig — see this module's own docblock for
 * why (resolveCoveragePolicy() shells out to `git rev-parse`, which must
 * not re-run on every scheduled cron tick) — so there is no
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
import { startCoverageSession } from '../services/coverageSessionService.js';
import * as coverageSessionService from '../services/coverageSessionService.js';
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
  await coverageDb.query('DELETE FROM coverage_sessions WHERE label LIKE $1', [`${FILE_PREFIX}-%`]);
});

afterEach(async () => {
  await coverageDb.query('DELETE FROM coverage_units WHERE file_path LIKE $1', [
    `${FILE_PREFIX}/%`,
  ]);
  await coverageDb.query('DELETE FROM coverage_sessions WHERE label LIKE $1', [`${FILE_PREFIX}-%`]);
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

  it('prunes coverage_sessions rows older than the given retentionDays, regardless of status', async () => {
    // coverage_sessions.started_by is the "session metadata (possible PII)"
    // the AC names — before this, coverage_sessions had zero
    // retention pruning at all (found via Greptile branch review).
    const session = await startCoverageSession({
      label: `${FILE_PREFIX}-old-session`,
      source: 'manual',
      buildSha: `${FILE_PREFIX}-${randomUUID()}`,
      environment: 'test',
    });
    await coverageDb.query(
      `UPDATE coverage_sessions SET started_at = now() - interval '100 days' WHERE id = $1`,
      [session.id],
    );

    await runCoverageRetentionPruning(30);

    const remaining = await coverageDb.query('SELECT id FROM coverage_sessions WHERE id = $1', [
      session.id,
    ]);
    expect(remaining.rowCount).toBe(0);
  });

  it('does not prune a coverage_sessions row newer than the given retentionDays', async () => {
    const session = await startCoverageSession({
      label: `${FILE_PREFIX}-recent-session`,
      source: 'manual',
      buildSha: `${FILE_PREFIX}-${randomUUID()}`,
      environment: 'test',
    });

    await runCoverageRetentionPruning(30);

    const remaining = await coverageDb.query('SELECT id FROM coverage_sessions WHERE id = $1', [
      session.id,
    ]);
    expect(remaining.rowCount).toBe(1);
  });
});

describe('getLastRetentionPruneOutcome', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records status 'ok' with prunedUnitCount/prunedLinkCount/prunedIngestedDumpCount/prunedSessionCount after a successful run", async () => {
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
      expect(typeof outcome.prunedIngestedDumpCount).toBe('number');
      expect(typeof outcome.prunedSessionCount).toBe('number');
    }
    expect(new Date(outcome!.ranAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("records status 'error' with the failure message, and still re-throws to the caller (server.ts's own cron .catch() must still fire)", async () => {
    // Regression test: the daily cron's failure previously only ever
    // reached logger.error, with GET /health continuing to report
    // status: 'ok' indefinitely — this is the one background job
    // introduces, and a failed run must now be observable on
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

  it('runs pruneCoverageSessions even when pruneCoverageUnits rejects — the two prunes are independent, not one blocking the other', async () => {
    // coverage_units and coverage_sessions are unrelated tables with no
    // cross-dependency — a units-side failure (e.g. the coverage DB having
    // a transient issue specific to that table) must not silently skip
    // pruning the table carrying possible PII (found via Greptile branch
    // review).
    vi.spyOn(coverageModelService, 'pruneCoverageUnits').mockRejectedValue(
      new Error('units prune failed'),
    );
    const session = await startCoverageSession({
      label: `${FILE_PREFIX}-independent-prune`,
      source: 'manual',
      buildSha: `${FILE_PREFIX}-${randomUUID()}`,
      environment: 'test',
    });
    await coverageDb.query(
      `UPDATE coverage_sessions SET started_at = now() - interval '100 days' WHERE id = $1`,
      [session.id],
    );

    await expect(runCoverageRetentionPruning(30)).rejects.toThrow('units prune failed');

    const remaining = await coverageDb.query('SELECT id FROM coverage_sessions WHERE id = $1', [
      session.id,
    ]);
    expect(remaining.rowCount).toBe(0);
  });

  it('runs pruneCoverageUnits even when pruneCoverageSessions rejects, and reports the combined error', async () => {
    vi.spyOn(coverageSessionService, 'pruneCoverageSessions').mockRejectedValue(
      new Error('sessions prune failed'),
    );
    const commitSha = `${FILE_PREFIX}-${randomUUID()}`;
    await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [makeUnit()]);
    await coverageDb.query(
      `UPDATE coverage_units SET last_seen_at = now() - interval '100 days' WHERE commit_sha = $1`,
      [commitSha],
    );

    await expect(runCoverageRetentionPruning(30)).rejects.toThrow('sessions prune failed');

    const stored = await findCoverageUnitsByCommitSha(commitSha);
    expect(stored).toHaveLength(0);

    const outcome = getLastRetentionPruneOutcome();
    expect(outcome?.status).toBe('error');
    if (outcome?.status === 'error') {
      expect(outcome.error).toContain('sessions prune failed');
    }
  });
});
