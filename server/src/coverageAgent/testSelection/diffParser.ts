/**
 * Coverage/TIA git-diff change detector.
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

/** Config/resource file classes handled separately by the dependency-graph step, never resolved to code units here. */
const NON_SOURCE_FILE_PATTERN = /\.(ya?ml|json|env)$|(^|\/)migrations\//i;

/**
 * Raised when a caller-supplied ref/revision string looks like a git CLI
 * flag rather than a real ref — e.g. a ref beginning with `-`, which git can
 * interpret as an option instead of a revision. Refs are ordinary strings,
 * not filesystem path segments (they legitimately contain `/`, e.g.
 * `origin/main`), so this validates only the one shape that's actually
 * dangerous to pass to a CLI, rather than reusing coverageConfig.ts's
 * SAFE_PATH_SEGMENT_PATTERN (which is deliberately much stricter — built for
 * a single filesystem path segment, not a ref).
 */
export class UnsafeGitRefError extends Error {
  readonly code = 'UNSAFE_GIT_REF';
  constructor(ref: string) {
    super(`Refusing to use "${ref}" as a git ref/revision — refs may not start with "-"`);
    this.name = 'UnsafeGitRefError';
  }
}

/** Throws UnsafeGitRefError if `ref` could be interpreted by git as a CLI flag rather than a revision. */
export function assertSafeGitRef(ref: string): void {
  if (ref.startsWith('-')) {
    throw new UnsafeGitRefError(ref);
  }
}

/** A file that appears anywhere in the diff, classified by how it changed. */
export type FileChangeStatus = 'added' | 'deleted' | 'modified' | 'renamed';

/**
 * One contiguous run of changed lines in the NEW version of a file
 * (half-open [startLine, endLine), 1-based). Can be ZERO-WIDTH
 * (startLine === endLine) for a pure-deletion hunk, where `startLine` is
 * git's own new-side anchor for where the deleted content used to sit —
 * consumers must check this single anchor line rather than assuming a
 * range always has at least one line.
 */
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
  /** True for files the dependency-graph step handles instead of unit resolution — config/resource/migration files. */
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
 * means exactly one line (git's own shorthand).
 *
 * A `+c,0` hunk is a pure deletion — nothing was added on the new side, so
 * there is no genuine new-side LINE to report a range over. It still emits a
 * zero-width anchor range at `{startLine: c, endLine: c}` rather than being
 * dropped entirely: `c` is git's own new-side position for where the
 * deleted content used to sit, and changeUnitResolver's per-line walk (see
 * resolveEnclosingUnitsForRanges) special-cases a zero-width range by
 * checking that single anchor line — otherwise a function changed ONLY by
 * deleting lines (no hunk anywhere in the diff that survives with a
 * positive new-side line count) would resolve to NO changed unit at all,
 * silently omitting its covering tests from selection with no unresolved-
 * change signal either (found via Greptile PR review).
 *
 * `+0,0` is git's own convention for "the deletion happened at the very
 * start of the file" (there is no new-side line 0 — line numbers are
 * 1-based) — clamped to line 1 (the new file's own first surviving line,
 * 1-based) instead of left as 0, which would never resolve to any enclosing
 * function at all (every real line is >= 1) and would incorrectly fall into
 * changeUnitResolver's "no enclosing function found" unresolved bucket
 * instead of anchoring to whatever function now starts the file.
 */
function parseHunkRanges(fileDiffBody: string): ChangedLineRange[] {
  const ranges: ChangedLineRange[] = [];
  for (const line of fileDiffBody.split('\n')) {
    const match = HUNK_HEADER_PATTERN.exec(line);
    if (!match) continue;

    const startLine = Math.max(1, Number(match[1]));
    const lineCount = match[2] !== undefined ? Number(match[2]) : 1;

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
/**
 * Matches the new-side path on the section's own `diff --git a/X b/X` header.
 *
 * The only path a BINARY file's section carries: git prints `Binary files ... differ`
 * in place of the +++/--- pair, so a parser reading only those yields no path at all.
 */
const HEADER_PATH_PATTERN = /^diff --git a\/.+? b\/(.+)$/m;
/**
 * The same header when git C-quotes the pair, which it does whenever a path holds a
 * non-ASCII byte, a tab, or a quote: `diff --git "a/wéird name.png" "b/..."`.
 *
 * A binary section has no +++/--- lines to fall back to, so this is the only shape that
 * would otherwise reach the caller with no path at all.
 */
const QUOTED_HEADER_PATH_PATTERN = /^diff --git "a\/.+?" "b\/(.+)"$/m;

/** Decodes git's C-quoted escapes (`\303\251` → `é`) back into a real path. */
function unquoteGitPath(quoted: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < quoted.length; index += 1) {
    if (quoted[index] !== '\\') {
      bytes.push(quoted.charCodeAt(index));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(quoted.slice(index + 1, index + 4));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      index += 3;
      continue;
    }
    const escaped = quoted[index + 1];
    bytes.push(escaped === 't' ? 9 : escaped === 'n' ? 10 : (escaped?.charCodeAt(0) ?? 92));
    index += 1;
  }
  return Buffer.from(bytes).toString('utf8');
}

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
  const headerPathMatch = HEADER_PATH_PATTERN.exec(section);
  const quotedHeaderMatch = QUOTED_HEADER_PATH_PATTERN.exec(section);
  const headerPath =
    headerPathMatch?.[1] ?? (quotedHeaderMatch ? unquoteGitPath(quotedHeaderMatch[1]) : undefined);
  const filePath =
    status === 'deleted'
      ? (oldPathMatch?.[1] ?? headerPath ?? '')
      : (renameToMatch?.[1] ?? newPathMatch?.[1] ?? headerPath ?? '');
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
  assertSafeGitRef(baseRef);
  assertSafeGitRef(headRef);

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
