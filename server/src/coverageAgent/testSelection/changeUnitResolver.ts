/**
 * Coverage/TIA changed-code-unit resolver. (MINCRM-623)
 *
 * Takes diffParser.ts's per-file changed line ranges and resolves them to
 * changed UNITS: (filePath, unitKey, branchId) triples keyed exactly the way
 * structuralKeyService.deriveStructuralUnitKey derives coverage_units'
 * own unit_key, so the result can be looked up directly against the mapping
 * query API (MINCRM-621) with no translation step.
 *
 * Function/method boundaries are found via the TypeScript compiler API
 * (ts.createSourceFile + a manual ts.forEachChild walk), not
 * istanbul-lib-instrument — this codebase's coverage pipeline already
 * standardized on the TS compiler API for structural-key derivation (see
 * structuralKeyService.ts's own docblock); istanbul-lib-instrument's
 * visitor is Babel-AST-based and would require a second, redundant parser
 * with no benefit, since deriveStructuralUnitKey only needs a source-text
 * slice and a {start,end} range — both trivially obtained from the TS AST.
 *
 * Only .ts/.tsx/.js/.jsx source is walked. Every other file this resolver is
 * asked about (already filtered to non-"isNonSourceFile" by the caller, per
 * diffParser's classification) is treated as opaque and produces no units —
 * MINCRM-623's AC only calls for "language-aware for MiniCRM's backend and
 * frontend", not universal language support.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import * as ts from 'typescript';
import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from '../../logger.js';
import {
  deriveStructuralUnitKey,
  type StructuralKeyLocation,
} from '../pipeline/structuralKeyService.js';
import type { ChangedLineRange, FileDiff } from './diffParser.js';

const execFileAsync = promisify(execFile);

const SOURCE_EXTENSION_PATTERN = /\.(ts|tsx|js|jsx)$/i;

/** How a changed unit's presence differs between the old and new revision. */
export type ChangeKind = 'new' | 'deleted' | 'in-line' | 'refactor';

/** One changed code unit, ready to look up against the mapping query API. */
export interface ChangedUnit {
  filePath: string;
  unitKey: string;
  branchId: null;
  changeKind: ChangeKind;
}

/** A changed file whose unit(s) could not be resolved to a structural key. */
export interface UnresolvedFileChange {
  filePath: string;
  reason: string;
}

export interface ChangeDetectionResult {
  changedUnits: ChangedUnit[];
  /** Config/resource/migration files from the diff, untouched — MINCRM-625's dependency-graph step owns these. */
  nonSourceFileChanges: FileDiff[];
  unresolvedFileChanges: UnresolvedFileChange[];
}

interface FunctionBoundary {
  name: string;
  range: StructuralKeyLocation;
}

/** Best-effort qualified name for a function-like node: method/property name when available, else '<anonymous>' (matching structuralKeyService's own fallback convention). */
function qualifiedNameOf(node: ts.Node): string {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node)) &&
    node.name
  ) {
    return node.name.getText();
  }
  if (ts.isPropertyAssignment(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  return '<anonymous>';
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/**
 * Walks a source file's AST and returns every function-like node's own name
 * and {start,end} range (1-based line, 0-based column — matching
 * StructuralKeyLocation/istanbul's Location shape). Ordered innermost-last
 * is NOT guaranteed; callers that need "most specific enclosing function"
 * must pick the smallest range themselves (see findEnclosingFunction).
 */
function findFunctionBoundaries(sourceFile: ts.SourceFile): FunctionBoundary[] {
  const boundaries: FunctionBoundary[] = [];

  function visit(node: ts.Node): void {
    if (isFunctionLike(node) && node.body) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      boundaries.push({
        name: qualifiedNameOf(node),
        range: {
          start: { line: start.line + 1, column: start.character },
          end: { line: end.line + 1, column: end.character },
        },
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return boundaries;
}

/** The smallest (most specific) boundary whose range fully contains the given 1-based line, or undefined if the line is outside every function (e.g. top-level module code). */
function findEnclosingFunction(
  boundaries: readonly FunctionBoundary[],
  line: number,
): FunctionBoundary | undefined {
  let best: FunctionBoundary | undefined;
  let bestSpan = Infinity;

  for (const boundary of boundaries) {
    if (line < boundary.range.start.line || line > boundary.range.end.line) continue;
    const span = boundary.range.end.line - boundary.range.start.line;
    if (span < bestSpan) {
      best = boundary;
      bestSpan = span;
    }
  }

  return best;
}

/** Resolves every enclosing function for a set of changed line ranges, deduplicated by unit identity. */
function resolveEnclosingUnitsForRanges(
  boundaries: readonly FunctionBoundary[],
  sourceText: string,
  ranges: readonly ChangedLineRange[],
): Map<string, { boundary: FunctionBoundary; unitKey: string }> {
  const byUnitKey = new Map<string, { boundary: FunctionBoundary; unitKey: string }>();

  for (const range of ranges) {
    // A hunk can span multiple lines; every line in it may fall in a
    // different (or the same) enclosing function, so each line is resolved
    // independently rather than just checking the hunk's start line.
    for (let line = range.startLine; line < range.endLine; line += 1) {
      const boundary = findEnclosingFunction(boundaries, line);
      if (!boundary) continue;

      const unitKey = deriveStructuralUnitKey(boundary.name, boundary.range, sourceText);
      if (!unitKey) continue;

      if (!byUnitKey.has(unitKey)) {
        byUnitKey.set(unitKey, { boundary, unitKey });
      }
    }
  }

  return byUnitKey;
}

/** Reads a file's content at a specific git revision. Returns null if the file didn't exist at that revision (e.g. it's newly added). */
async function readFileAtRevision(
  cwd: string,
  revision: string,
  filePath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `${revision}:${filePath}`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 16,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Classifies a changed unit by comparing its presence/identity across the
 * old and new revisions:
 *  - 'new': the unit's own name has no corresponding function in the old
 *    revision at all (a brand-new function, not just an edited one).
 *  - 'in-line': the unit exists in both revisions under the same name, and
 *    its structural key (name + normalized body hash) actually changed —
 *    an ordinary edit to the function's own logic.
 *  - 'refactor': the unit's name exists in the old revision, but git's own
 *    diff still attributed a change here — used when the enclosing
 *    function's OWN body hash is unchanged (e.g. a change to a sibling
 *    statement inside a shared block was misattributed to this function's
 *    range boundary), signaling the change is likely structural movement
 *    rather than a logic edit. Detectable-only, per the AC — a best-effort
 *    signal, not a guarantee.
 */
function classifyChange(
  newUnitKey: string,
  newBoundaryName: string,
  oldBoundaries: readonly FunctionBoundary[],
  oldSourceText: string,
): ChangeKind {
  const oldBoundary = oldBoundaries.find((b) => b.name === newBoundaryName);
  if (!oldBoundary) {
    return 'new';
  }

  const oldUnitKey = deriveStructuralUnitKey(oldBoundary.name, oldBoundary.range, oldSourceText);
  if (oldUnitKey === newUnitKey) {
    // Same name, same body hash in both revisions — the diff touched this
    // function's range, but its own normalized body is identical, so the
    // effective change is elsewhere (e.g. a sibling function moved a brace).
    return 'refactor';
  }

  return 'in-line';
}

/**
 * Resolves one file's changed line ranges (git diff, "new" side) into
 * changed units, classified new/deleted/in-line/refactor where detectable.
 */
async function resolveFileChange(
  fileDiff: FileDiff,
  cwd: string,
  headRef: string,
  baseRef: string,
): Promise<{ units: ChangedUnit[]; unresolved: UnresolvedFileChange | null }> {
  if (fileDiff.status === 'deleted') {
    const oldSourceText = await readFileAtRevision(cwd, baseRef, fileDiff.filePath);
    if (oldSourceText === null) {
      return {
        units: [],
        unresolved: {
          filePath: fileDiff.filePath,
          reason: 'Deleted file unreadable at base revision',
        },
      };
    }
    const oldSourceFile = ts.createSourceFile(
      fileDiff.filePath,
      oldSourceText,
      ts.ScriptTarget.Latest,
      true,
    );
    const oldBoundaries = findFunctionBoundaries(oldSourceFile);
    const units: ChangedUnit[] = [];
    for (const boundary of oldBoundaries) {
      const unitKey = deriveStructuralUnitKey(boundary.name, boundary.range, oldSourceText);
      if (unitKey) {
        units.push({ filePath: fileDiff.filePath, unitKey, branchId: null, changeKind: 'deleted' });
      }
    }
    return { units, unresolved: null };
  }

  const newSourceText = await readFile(join(cwd, fileDiff.filePath), 'utf8').catch(() => null);
  if (newSourceText === null) {
    return {
      units: [],
      unresolved: { filePath: fileDiff.filePath, reason: 'File unreadable at head revision' },
    };
  }

  const newSourceFile = ts.createSourceFile(
    fileDiff.filePath,
    newSourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const newBoundaries = findFunctionBoundaries(newSourceFile);
  const resolved = resolveEnclosingUnitsForRanges(
    newBoundaries,
    newSourceText,
    fileDiff.changedRanges,
  );

  if (resolved.size === 0 && fileDiff.changedRanges.length > 0) {
    return {
      units: [],
      unresolved: {
        filePath: fileDiff.filePath,
        reason: 'No enclosing function found for any changed line (top-level/module-scope change)',
      },
    };
  }

  if (fileDiff.status === 'added') {
    const units = Array.from(resolved.values()).map(({ unitKey }) => ({
      filePath: fileDiff.filePath,
      unitKey,
      branchId: null,
      changeKind: 'new' as const,
    }));
    return { units, unresolved: null };
  }

  // modified/renamed: classify against the old revision's own boundaries.
  const oldPath = fileDiff.oldFilePath ?? fileDiff.filePath;
  const oldSourceText = await readFileAtRevision(cwd, baseRef, oldPath);
  const oldBoundaries = oldSourceText
    ? findFunctionBoundaries(
        ts.createSourceFile(oldPath, oldSourceText, ts.ScriptTarget.Latest, true),
      )
    : [];

  const units: ChangedUnit[] = Array.from(resolved.values()).map(({ boundary, unitKey }) => ({
    filePath: fileDiff.filePath,
    unitKey,
    branchId: null,
    changeKind:
      oldSourceText === null
        ? 'new'
        : classifyChange(unitKey, boundary.name, oldBoundaries, oldSourceText),
  }));

  return { units, unresolved: null };
}

/**
 * Resolves a full diff (already parsed by diffParser.parseGitDiff) into
 * changed code units, ready for the mapping query API.
 *
 * @param cwd - Repository root; the new-revision file content is read
 *   directly off disk here (assumes headRef is the currently checked-out
 *   revision), while old-revision content is always read via `git show`
 *   regardless of what's checked out.
 */
export async function resolveChangedUnits(
  fileDiffs: readonly FileDiff[],
  cwd: string,
  baseRef: string,
  headRef: string,
): Promise<ChangeDetectionResult> {
  const changedUnits: ChangedUnit[] = [];
  const nonSourceFileChanges: FileDiff[] = [];
  const unresolvedFileChanges: UnresolvedFileChange[] = [];

  for (const fileDiff of fileDiffs) {
    if (fileDiff.isNonSourceFile) {
      nonSourceFileChanges.push(fileDiff);
      continue;
    }

    if (!SOURCE_EXTENSION_PATTERN.test(fileDiff.filePath)) {
      // Not a source file this resolver understands, and not flagged
      // non-source by diffParser either (e.g. a .md doc, an image) — no
      // unit to resolve, and not a dependency-graph concern.
      continue;
    }

    try {
      const { units, unresolved } = await resolveFileChange(fileDiff, cwd, headRef, baseRef);
      changedUnits.push(...units);
      if (unresolved) {
        unresolvedFileChanges.push(unresolved);
        logger.warn(unresolved, 'changeUnitResolver: could not resolve file change to a unit');
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown resolution error';
      unresolvedFileChanges.push({ filePath: fileDiff.filePath, reason });
      logger.warn(
        { err, filePath: fileDiff.filePath },
        'changeUnitResolver: failed to resolve file change',
      );
    }
  }

  return { changedUnits, nonSourceFileChanges, unresolvedFileChanges };
}
