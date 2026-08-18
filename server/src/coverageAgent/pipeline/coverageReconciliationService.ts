/**
 * Coverage/TIA build-time reconciliation & confidence scoring.
 *
 * Re-validates coverage_units against the CURRENT source tree and commit
 * history — not the commit_sha a unit was originally ingested at — and:
 *  1. Computes a recency-decayed confidence_score for every unit, so stale
 *     entries are down-weighted without being deleted outright.
 *  2. Prunes units whose file no longer exists anywhere in the current
 *     source tree (deletion handling).
 *  3. Carries a unit's mapping forward (in place — same row, same
 *     accumulated hit_count/history) when its file was renamed/moved,
 *     using git's own rename-detection between the unit's own commit_sha
 *     and current HEAD as the VCS signal call for.
 *
 * File-granularity rename detection (not per-function): 's
 * structural key (name + normalized-body-hash, see structuralKeyService.ts)
 * is ALREADY stable across in-file edits by construction — a function's key
 * survives reformatting and unrelated edits elsewhere in its own file
 * without this service's help. What it does NOT survive on its own is its
 * FILE moving/renaming, since file_path is stored verbatim, not re-derived
 * from the hash. Git's rename detection (`git diff --find-renames`)
 * operates at file granularity, which is exactly the gap this closes —
 * re-deriving each function's own body hash again here would be redundant
 * with what the reconciler already guarantees, not an additional safeguard.
 *
 * No new AST/git library dependency: shells out to `git` via execFileSync
 * with array arguments (never a shell string), mirroring the existing
 * precedent in coverageConfig.ts's resolveCommitSha.
 *
 * Callable on demand only, not scheduled. Note this is no longer the same
 * precedent coverageModelService.pruneCoverageUnits sets — that function is
 * now cron-scheduled (coverageRetentionScheduler.ts), since
 * retention pruning genuinely has no meaningful judgment call to make on a
 * fixed daily cadence. Reconciliation is different: it re-validates against
 * the CURRENT source tree and git history for a caller-supplied commit,
 * which only makes sense at a meaningful build-time boundary (e.g. a CI job
 * for a specific commit), not on a wall-clock schedule with no commit
 * context of its own — wiring it into such a trigger remains the CI/CD
 * Integration epic's concern.
 */

import { access } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import logger from '../../logger.js';
import {
  findCoverageUnitsByCommitSha,
  deleteCoverageUnitById,
  relocateCoverageUnit,
  updateCoverageUnitConfidence,
} from '../../services/coverageModelService.js';
import type { CoverageUnit } from '@minicrm/shared/schemas/coveragePipelineSchema.js';

const execFileAsync = promisify(execFile);

/** Confidence decays linearly from 1.0 to CONFIDENCE_FLOOR over this many days since last_seen_at. */
const CONFIDENCE_DECAY_WINDOW_DAYS = 30;
/** A unit is never scored below this floor purely from age — it remains findable, just deprioritized. */
const CONFIDENCE_FLOOR = 0.1;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ReconciliationResult {
  commitSha: string;
  unitsScored: number;
  unitsPruned: number;
  unitsRelocated: number;
}

/**
 * Computes a recency-decayed confidence score in [CONFIDENCE_FLOOR, 1.0].
 * Linear decay chosen over exponential for this first cut — simple,
 * monotonic, and easy to reason about; revisit if real usage shows linear
 * decay mis-prioritizes results.
 */
export function computeConfidenceScore(lastSeenAt: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - lastSeenAt.getTime()) / MILLISECONDS_PER_DAY);
  const decayFraction = Math.min(1, ageDays / CONFIDENCE_DECAY_WINDOW_DAYS);
  const score = 1 - decayFraction * (1 - CONFIDENCE_FLOOR);
  return Math.round(score * 1000) / 1000;
}

/** True if filePath exists under sourceRoot on the current filesystem. */
async function fileExists(sourceRoot: string, filePath: string): Promise<boolean> {
  try {
    await access(join(sourceRoot, filePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Asks git which current path a historical path was renamed/moved to,
 * between the unit's own commitSha and current HEAD. Returns null when git
 * reports no rename for this path (file is unchanged, was deleted outright
 * with no detected rename, or git itself is unavailable) — callers treat
 * null as "no rename signal", not as an error.
 *
 * Deliberately does NOT restrict the diff to `-- filePath` (an old-side
 * pathspec) — empirically, git's rename-pair association breaks when the
 * diff is pathspec-restricted to the OLD side of a rename: `git diff
 * <sha> HEAD -- old/path.ts` reports no rename at all for a path that
 * `git diff <sha> HEAD` (unrestricted) correctly reports as
 * `R100 old/path.ts new/path.ts`. The full unrestricted diff is asked for
 * instead, then filtered in application code for the specific rename pair
 * whose old-side path matches filePath.
 */
async function findRenamedPathViaGit(
  sourceRoot: string,
  commitSha: string,
  filePath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--find-renames=50%', '--name-status', '--diff-filter=R', commitSha, 'HEAD'],
      { cwd: sourceRoot, encoding: 'utf8' },
    );
    // Rename lines look like: "R100\told/path.ts\tnew/path.ts" (tab-separated).
    for (const line of stdout.split('\n')) {
      if (!line.startsWith('R') || !line.includes('\t')) continue;
      const parts = line.split('\t');
      if (parts.length >= 3 && parts[1] === filePath) {
        return parts[2];
      }
    }
    return null;
  } catch (err) {
    logger.warn(
      { err, commitSha, filePath },
      'coverageReconciliationService: git rename lookup failed — treating as no rename signal',
    );
    return null;
  }
}

/**
 * Reconciles every coverage_units row for a given commit SHA against the
 * current source tree: scores confidence, prunes units whose file is gone
 * with no detected rename, and relocates (in place) units whose file was
 * renamed/moved per git's own rename detection.
 */
export async function reconcileCoverageUnits(
  commitSha: string,
  sourceRoot: string,
): Promise<ReconciliationResult> {
  const units = await findCoverageUnitsByCommitSha(commitSha);
  const now = new Date();

  let unitsPruned = 0;
  let unitsRelocated = 0;
  let unitsScored = 0;

  // Grouped by file_path so a file's existence/rename is resolved once,
  // not once per unit — a file can carry many units (one per branch/function).
  const unitsByFilePath = new Map<string, CoverageUnit[]>();
  for (const unit of units) {
    const existing = unitsByFilePath.get(unit.filePath);
    if (existing) {
      existing.push(unit);
    } else {
      unitsByFilePath.set(unit.filePath, [unit]);
    }
  }

  for (const [filePath, unitsForFile] of unitsByFilePath) {
    // Resolved ONCE per file here, then acted on for every unit in this
    // file below — the single-pass structure this replaced re-resolved
    // the same file's existence/rename twice (once to decide prune/
    // relocate, again in a since-removed separate scoring pass), which was
    // both wasteful (duplicate git subprocess calls) and subtly wrong: the
    // second pass checked the ORIGINAL (pre-relocation) filePath against
    // the filesystem even for units this same loop had already relocated
    // moments earlier, since the in-memory unitsForFile array is never
    // updated to reflect the DB write relocateCoverageUnit just made.
    const stillExists = await fileExists(sourceRoot, filePath);
    let relocatedTo: string | null = null;
    let isPruned = false;

    if (!stillExists) {
      const renamedTo = await findRenamedPathViaGit(sourceRoot, commitSha, filePath);
      if (renamedTo && (await fileExists(sourceRoot, renamedTo))) {
        relocatedTo = renamedTo;
      } else {
        isPruned = true;
      }
    }

    for (const unit of unitsForFile) {
      if (isPruned) {
        await deleteCoverageUnitById(unit.id);
        unitsPruned += 1;
        continue;
      }

      // Defaults to the unit's own id; relocateCoverageUnit below may
      // return a DIFFERENT id if it merged this unit into a pre-existing
      // row at the destination identity (see that function's own
      // docblock) — the confidence update after this block must target
      // whichever row actually survives, or it silently no-ops against a
      // since-deleted id.
      let survivingId = unit.id;

      if (relocatedTo) {
        // unit_key itself is unchanged — the structural key
        // already survives content edits by construction; only file_path
        // needs to move to reflect where git says the file now lives.
        survivingId = await relocateCoverageUnit(unit.id, relocatedTo, unit.unitKey);
        unitsRelocated += 1;
      }

      // Scored whether or not it was just relocated — a rename doesn't
      // reset staleness, a unit is exactly as fresh/stale as its own
      // last_seen_at says regardless of which file_path it now points to.
      const score = computeConfidenceScore(new Date(unit.lastSeenAt), now);
      await updateCoverageUnitConfidence(survivingId, score);
      unitsScored += 1;
    }
  }

  logger.info(
    { commitSha, unitsScored, unitsPruned, unitsRelocated },
    'coverageReconciliationService: reconciled coverage units',
  );

  return { commitSha, unitsScored, unitsPruned, unitsRelocated };
}
