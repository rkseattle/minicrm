/**
 * Coverage/TIA git-diff change detector. (MINCRM-623)
 *
 * Parses a `base..head` git diff into per-file changed line ranges, the raw
 * material changeUnitResolver.ts turns into changed code UNITS (structural
 * keys) for the mapping query API. This module owns only the diff-to-hunks
 * step; it has no knowledge of functions, ASTs, or unit_key identity.
 *
 * Shells out to `git diff` via execFile with array arguments (never a shell
 * string) — same precedent as coverageReconciliationService.ts's
 * findRenamedPathViaGit and coverageConfig.ts's resolveCommitSha.
 *
 * Uses --unified=0 (no context lines) so every emitted hunk range is exactly
 * the changed lines themselves — context lines would otherwise widen a
 * hunk's reported range beyond what actually changed, causing
 * changeUnitResolver to attribute a change to a function that merely sits
 * next to a real edit.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from '../../logger.js';

const execFileAsync = promisify(execFile);

/** Config/resource file classes handled separately by the dependency-graph step (MINCRM-625), never resolved to code units here. */
const NON_SOURCE_FILE_PATTERN = /\.(ya?ml|json|env)$|(^|\/)migrations\//i;

/** A file that appears anywhere in the diff, classified by how it changed. */
export type FileChangeStatus = 'added' | 'deleted' | 'modified' | 'renamed';

/** One contiguous run of changed lines in the NEW version of a file (half-open [startLine, endLine), 1-based). */
export interface ChangedLineRange {
  startLine: number;
  endLine: number;
}

/** One file's changes as reported by git, before any code-unit resolution. */
export interface FileDiff {
  filePath: string;
  /** Present only when status === 'renamed'. */
  oldFilePath: string | null;
  status: FileChangeStatus;
  /** True for files the dependency-graph step (MINCRM-625) handles instead of unit resolution — config/resource/migration files. */
  isNonSourceFile: boolean;
  /** Changed line ranges in the new version of the file. Empty for a pure rename with no content change, and always empty for a deleted file (there is no "new version"). */
  changedRanges: ChangedLineRange[];
}

/** Raised when `git diff` itself fails (e.g. an invalid ref) — distinct from a diff that succeeds but reports zero changed files. */
export class GitDiffError extends Error {
  readonly code = 'GIT_DIFF_FAILED';
  constructor(baseRef: string, headRef: string, cause: string) {
    super(`git diff ${baseRef}..${headRef} failed: ${cause}`);
    this.name = 'GitDiffError';
  }
}

const HUNK_HEADER_PATTERN = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses one file's `@@ -a,b +c,d @@` hunk headers out of its diff body into
 * changed line ranges on the NEW side. A hunk with no explicit `,d` count
 * means exactly one line (git's own shorthand); a `+c,0` hunk is a pure
 * deletion with nothing added on the new side, so it contributes no range
 * (there is no new-side line to attribute a change to — the deletion's
 * effect on the enclosing function is still detected by changeUnitResolver
 * comparing old/new ASTs, not by a new-side line range).
 */
function parseHunkRanges(fileDiffBody: string): ChangedLineRange[] {
  const ranges: ChangedLineRange[] = [];
  for (const line of fileDiffBody.split('\n')) {
    const match = HUNK_HEADER_PATTERN.exec(line);
    if (!match) continue;

    const startLine = Number(match[1]);
    const lineCount = match[2] !== undefined ? Number(match[2]) : 1;
    if (lineCount === 0) continue;

    ranges.push({ startLine, endLine: startLine + lineCount });
  }
  return ranges;
}

/**
 * Splits `git diff`'s combined stdout into per-file sections. Each file's
 * section starts at a `diff --git a/... b/...` line; this function returns
 * the raw text of each section (header line included) for per-file parsing.
 */
function splitIntoFileSections(diffOutput: string): string[] {
  if (diffOutput.trim() === '') return [];
  const sections = diffOutput.split(/^diff --git /m).slice(1);
  return sections.map((section) => `diff --git ${section}`);
}

const NEW_FILE_MODE_MARKER = '\nnew file mode';
const DELETED_FILE_MODE_MARKER = '\ndeleted file mode';
const RENAME_FROM_PATTERN = /^rename from (.+)$/m;
const RENAME_TO_PATTERN = /^rename to (.+)$/m;
/** Matches the `+++ b/path` line git emits for the new-side path — `/dev/null` for a deleted file. */
const NEW_PATH_PATTERN = /^\+\+\+ b\/(.+)$/m;
/** Matches the `--- a/path` line git emits for the old-side path — `/dev/null` for an added file. */
const OLD_PATH_PATTERN = /^--- a\/(.+)$/m;

/** Parses one `diff --git ...` section into a FileDiff. */
function parseFileSection(section: string): FileDiff {
  const isRenamed = RENAME_FROM_PATTERN.test(section) && RENAME_TO_PATTERN.test(section);
  const isAdded = section.includes(NEW_FILE_MODE_MARKER);
  const isDeleted = section.includes(DELETED_FILE_MODE_MARKER);

  const status: FileChangeStatus = isRenamed
    ? 'renamed'
    : isAdded
      ? 'added'
      : isDeleted
        ? 'deleted'
        : 'modified';

  const newPathMatch = NEW_PATH_PATTERN.exec(section);
  const oldPathMatch = OLD_PATH_PATTERN.exec(section);
  const renameToMatch = RENAME_TO_PATTERN.exec(section);
  const renameFromMatch = RENAME_FROM_PATTERN.exec(section);

  // A deleted file has no "+++ b/..." path (git prints "+++ /dev/null"), so
  // its filePath comes from the "--- a/..." (old) side instead; every other
  // status has a real new-side path.
  const filePath =
    status === 'deleted'
      ? (oldPathMatch?.[1] ?? '')
      : (renameToMatch?.[1] ?? newPathMatch?.[1] ?? '');
  const oldFilePath = status === 'renamed' ? (renameFromMatch?.[1] ?? null) : null;

  return {
    filePath,
    oldFilePath,
    status,
    isNonSourceFile: NON_SOURCE_FILE_PATTERN.test(filePath),
    changedRanges: status === 'deleted' ? [] : parseHunkRanges(section),
  };
}

/**
 * Resolves a diff (base..head) into per-file changed line ranges.
 *
 * @param baseRef - The base ref/SHA to diff from (exclusive).
 * @param headRef - The head ref/SHA to diff to (inclusive).
 * @param cwd - Repository root to run `git diff` in.
 */
export async function parseGitDiff(
  baseRef: string,
  headRef: string,
  cwd: string,
): Promise<FileDiff[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'git',
      ['diff', '--unified=0', '--find-renames=50%', `${baseRef}..${headRef}`],
      { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 },
    ));
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    logger.warn({ baseRef, headRef, cause }, 'diffParser: git diff failed');
    throw new GitDiffError(baseRef, headRef, cause);
  }

  return splitIntoFileSections(stdout).map(parseFileSection);
}
