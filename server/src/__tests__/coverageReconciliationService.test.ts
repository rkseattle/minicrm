/**
 * Tests for coverageReconciliationService. (MINCRM-620)
 *
 * computeConfidenceScore is pure and tested directly. reconcileCoverageUnits
 * is exercised against a REAL git repository (mkdtemp + git init/commit/mv)
 * and the real coverage test database — no mocking of `git` itself, since
 * this service's entire "carry renames via VCS signals" requirement is
 * exactly the seam a mocked git command would fail to catch a wrong
 * --find-renames invocation in.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import {
  computeConfidenceScore,
  reconcileCoverageUnits,
} from '../coverageAgent/pipeline/coverageReconciliationService.js';
import {
  upsertCoverageUnits,
  findCoverageUnitsByCommitSha,
} from '../services/coverageModelService.js';
import type { NormalizedCoverageUnit } from '../coverageAgent/pipeline/normalizedCoverageUnit.js';
import coverageDb from '../coverageDb.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

async function gitRevParseHead(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

function makeUnit(overrides: Partial<NormalizedCoverageUnit> = {}): NormalizedCoverageUnit {
  return {
    filePath: 'src/widget.ts',
    unitKey: 'render#abc123',
    branchId: '0:0',
    granularity: 'branch',
    hitCount: 1,
    resolved: true,
    unresolvedReason: null,
    ...overrides,
  };
}

describe('computeConfidenceScore', () => {
  const now = new Date('2026-07-22T00:00:00Z');

  it('returns 1.0 for a unit seen right now', () => {
    expect(computeConfidenceScore(now, now)).toBe(1);
  });

  it('decays linearly partway through the decay window', () => {
    const fifteenDaysAgo = new Date('2026-07-07T00:00:00Z');
    const score = computeConfidenceScore(fifteenDaysAgo, now);
    // Halfway through a 30-day window, halfway between 1.0 and the floor.
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(0.6);
  });

  it('floors at the confidence floor for a unit older than the decay window', () => {
    const sixtyDaysAgo = new Date('2026-05-23T00:00:00Z');
    const score = computeConfidenceScore(sixtyDaysAgo, now);
    expect(score).toBe(0.1);
  });

  it('never scores below the floor even for a very old unit', () => {
    const oneYearAgo = new Date('2025-07-22T00:00:00Z');
    const score = computeConfidenceScore(oneYearAgo, now);
    expect(score).toBe(0.1);
  });
});

describe('reconcileCoverageUnits', () => {
  let repoRoot: string;
  let commitSha: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'minicrm-reconciliation-test-'));
    await git(repoRoot, ['init', '-q']);
    await git(repoRoot, ['config', 'user.email', 'test@example.com']);
    await git(repoRoot, ['config', 'user.name', 'Test']);

    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'widget.ts'), 'export function render() {}\n', 'utf8');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-q', '-m', 'initial']);

    // A real commit SHA in THIS repo, not a synthetic string — reconciliation
    // diffs `git diff <commitSha> HEAD`, which requires commitSha to
    // actually resolve as a revision in the repo being reconciled against.
    // Each test gets its OWN fresh tmpdir repo (see mkdtemp above), so this
    // SHA can never collide with another test's coverage_units rows even
    // without an added random suffix.
    commitSha = await gitRevParseHead(repoRoot);
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await coverageDb.query('DELETE FROM coverage_units WHERE commit_sha = $1', [commitSha]);
  });

  it('scores confidence but leaves file_path/unit_key untouched when the file still exists', async () => {
    await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [makeUnit()]);

    const result = await reconcileCoverageUnits(commitSha, repoRoot);

    expect(result.unitsScored).toBe(1);
    expect(result.unitsPruned).toBe(0);
    expect(result.unitsRelocated).toBe(0);

    const stored = await findCoverageUnitsByCommitSha(commitSha);
    expect(stored).toHaveLength(1);
    expect(stored[0].filePath).toBe('src/widget.ts');
    expect(stored[0].confidenceScore).toBeCloseTo(1, 2);
    expect(stored[0].lastReconciledAt).not.toBeNull();
  });

  it('prunes a unit whose file was deleted outright with no git rename signal', async () => {
    await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [makeUnit()]);

    await rm(join(repoRoot, 'src', 'widget.ts'));
    await git(repoRoot, ['add', '-A']);
    await git(repoRoot, ['commit', '-q', '-m', 'delete widget']);

    const result = await reconcileCoverageUnits(commitSha, repoRoot);

    expect(result.unitsPruned).toBe(1);
    expect(result.unitsScored).toBe(0);
    expect(result.unitsRelocated).toBe(0);

    const stored = await findCoverageUnitsByCommitSha(commitSha);
    expect(stored).toHaveLength(0);
  });

  it('relocates (in place) a unit whose file was renamed, carrying hit_count and identity forward', async () => {
    const dumpId = randomUUID();
    await upsertCoverageUnits(dumpId, commitSha, 'node-v8', [makeUnit({ hitCount: 7 })]);
    const before = await findCoverageUnitsByCommitSha(commitSha);
    const unitId = before[0].id;

    await git(repoRoot, ['mv', 'src/widget.ts', 'src/renamed-widget.ts']);
    await git(repoRoot, ['commit', '-q', '-m', 'rename widget']);

    const result = await reconcileCoverageUnits(commitSha, repoRoot);

    expect(result.unitsRelocated).toBe(1);
    expect(result.unitsPruned).toBe(0);
    expect(result.unitsScored).toBe(1);

    const stored = await findCoverageUnitsByCommitSha(commitSha);
    expect(stored).toHaveLength(1);
    // Same row (same id), carried forward — not deleted + reinserted.
    expect(stored[0].id).toBe(unitId);
    expect(stored[0].filePath).toBe('src/renamed-widget.ts');
    expect(stored[0].unitKey).toBe('render#abc123');
    expect(stored[0].hitCount).toBe(7);
  });

  it('scores the SURVIVING row (not the deleted moving row) when a rename target collides with an existing coverage_units row', async () => {
    // Regression test: relocateCoverageUnit merges-and-deletes the moving
    // row when the destination identity already has its own row (see that
    // function's own docblock). reconcileCoverageUnits must then score
    // confidence on the row that actually SURVIVES (the destination), not
    // the original unit's own (now-deleted) id — an UPDATE against a
    // deleted id silently matches zero rows rather than erroring, which
    // would leave the surviving row's confidence_score/last_reconciled_at
    // stale without any visible failure.
    await writeFile(
      join(repoRoot, 'src', 'renamed-widget.ts'),
      'export function render() {}\n',
      'utf8',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-q', '-m', 'add renamed-widget with its own coverage already']);

    await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [makeUnit({ hitCount: 7 })]);
    await upsertCoverageUnits(randomUUID(), commitSha, 'node-v8', [
      makeUnit({ filePath: 'src/renamed-widget.ts', hitCount: 5 }),
    ]);

    const beforeAll = await findCoverageUnitsByCommitSha(commitSha);
    const destinationUnit = beforeAll.find((u) => u.filePath === 'src/renamed-widget.ts')!;
    expect(destinationUnit.confidenceScore).toBe(1);

    await git(repoRoot, ['rm', '-q', 'src/widget.ts']);
    await git(repoRoot, [
      'commit',
      '-q',
      '-m',
      'delete widget (git sees this as a rename to renamed-widget)',
    ]);

    const result = await reconcileCoverageUnits(commitSha, repoRoot);

    expect(result.unitsRelocated).toBe(1);
    expect(result.unitsScored).toBeGreaterThanOrEqual(1);

    const stored = await findCoverageUnitsByCommitSha(commitSha);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(destinationUnit.id);
    expect(stored[0].hitCount).toBe(12);
    // The surviving row's own confidence_score/last_reconciled_at were
    // actually updated by this reconciliation run, not silently skipped.
    expect(stored[0].lastReconciledAt).not.toBeNull();
  });

  it('is a no-op for a commitSha with no coverage_units rows', async () => {
    const result = await reconcileCoverageUnits(commitSha, repoRoot);
    expect(result).toEqual({
      commitSha,
      unitsScored: 0,
      unitsPruned: 0,
      unitsRelocated: 0,
    });
  });
});
