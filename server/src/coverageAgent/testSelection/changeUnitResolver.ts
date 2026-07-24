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
import { assertSafeGitRef, type ChangedLineRange, type FileDiff } from './diffParser.js';

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
  /** Full node span (signature through closing brace) — used ONLY for line-containment ("which function encloses this changed line"), matching istanbul's own `decl.start` through `loc.end` convention (see coverageSymbolicationService.ts's qualifiedUnitKeyForLine). */
  containmentRange: StructuralKeyLocation;
  /** Body-only span (istanbul's `loc`, excluding the `function name(...)` signature) — the ONLY range ever passed to deriveStructuralUnitKey, matching the mapping engine's own hash derivation exactly (coverageSymbolicationService.ts's qualifiedUnitKey passes `mapping.loc`, never `mapping.decl`). Hashing the full node (including the name) would make a function's unit_key change on a pure rename with no logic change, which is NOT how the mapping engine itself derives unit_key. */
  bodyRange: StructuralKeyLocation;
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

/** Converts a TS source position to a 1-based-line/0-based-column point, matching StructuralKeyLocation/istanbul's Location shape. */
function toLocation(sourceFile: ts.SourceFile, pos: number): { line: number; column: number } {
  const point = sourceFile.getLineAndCharacterOfPosition(pos);
  return { line: point.line + 1, column: point.character };
}

/**
 * Walks a source file's AST and returns every function-like node's own name,
 * containment range (full node span), and body range (see FunctionBoundary's
 * own docblock for why these must be tracked separately). Ordered
 * innermost-last is NOT guaranteed; callers that need "most specific
 * enclosing function" must pick the smallest range themselves (see
 * findEnclosingFunction).
 */
function findFunctionBoundaries(sourceFile: ts.SourceFile): FunctionBoundary[] {
  const boundaries: FunctionBoundary[] = [];

  function visit(node: ts.Node): void {
    if (isFunctionLike(node) && node.body) {
      boundaries.push({
        name: qualifiedNameOf(node),
        containmentRange: {
          start: toLocation(sourceFile, node.getStart(sourceFile)),
          end: toLocation(sourceFile, node.getEnd()),
        },
        bodyRange: {
          start: toLocation(sourceFile, node.body.getStart(sourceFile)),
          end: toLocation(sourceFile, node.body.getEnd()),
        },
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return boundaries;
}

/**
 * True if `inner`'s range is nested inside (or equal to) `outer`'s range —
 * compares the FULL {line, column} position, not just line, so two
 * function-like nodes sharing identical start/end LINES (routine for
 * same-line nested callbacks, e.g. `items.map((x) => x.foo(() => bar()))`)
 * are still ordered correctly by their column positions rather than tying.
 */
function isNestedWithin(inner: StructuralKeyLocation, outer: StructuralKeyLocation): boolean {
  const startsAfterOrAt =
    inner.start.line > outer.start.line ||
    (inner.start.line === outer.start.line && inner.start.column >= outer.start.column);
  const endsBeforeOrAt =
    inner.end.line < outer.end.line ||
    (inner.end.line === outer.end.line && inner.end.column <= outer.end.column);
  return startsAfterOrAt && endsBeforeOrAt;
}

/**
 * The smallest (most specific) boundary whose range fully contains the
 * given 1-based line, or undefined if the line is outside every function
 * (e.g. top-level module code).
 *
 * Ties on line-span alone (same-line nested functions) are broken by
 * CONTAINMENT (isNestedWithin), not first-encountered order — a boundary
 * that is itself nested inside another candidate is always preferred over
 * its container, regardless of AST traversal order. Line-span remains the
 * primary key so a large enclosing function isn't mistakenly preferred over
 * a smaller nested one that happens to be visited first with an
 * accidentally-equal span.
 */
function findEnclosingFunction(
  boundaries: readonly FunctionBoundary[],
  line: number,
): FunctionBoundary | undefined {
  let best: FunctionBoundary | undefined;
  let bestSpan = Infinity;

  for (const boundary of boundaries) {
    const { containmentRange } = boundary;
    if (line < containmentRange.start.line || line > containmentRange.end.line) continue;
    const span = containmentRange.end.line - containmentRange.start.line;

    if (span < bestSpan) {
      best = boundary;
      bestSpan = span;
    } else if (
      span === bestSpan &&
      best &&
      isNestedWithin(containmentRange, best.containmentRange)
    ) {
      // Same line-span as the current best, but this candidate is actually
      // nested INSIDE it (e.g. an inner one-liner callback) — prefer the
      // more specific, contained boundary.
      best = boundary;
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

      const unitKey = deriveStructuralUnitKey(boundary.name, boundary.bodyRange, sourceText);
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

  const oldUnitKey = deriveStructuralUnitKey(
    oldBoundary.name,
    oldBoundary.bodyRange,
    oldSourceText,
  );
  if (oldUnitKey === newUnitKey) {
    // Same name, same body hash in both revisions — the diff touched this
    // function's range, but its own normalized body is identical, so the
    // effective change is elsewhere (e.g. a sibling function moved a brace).
    return 'refactor';
  }

  return 'in-line';
}

/** The normalized-body-hash suffix of a `${name}#${hash}` structural unit key, or null for a legacy `name@line` key with no `#`. */
function bodyHashOf(unitKey: string): string | null {
  const hashIndex = unitKey.indexOf('#');
  return hashIndex === -1 ? null : unitKey.slice(hashIndex + 1);
}

/**
 * Detects functions present in the OLD revision's boundaries whose name no
 * longer exists anywhere in the NEW revision — i.e. a function that was
 * renamed (or genuinely removed) rather than merely edited. classifyChange
 * alone only ever looks FORWARD from a new-side boundary to its old-side
 * namesake, so a rename (old name absent from the new file) is otherwise
 * only ever seen from the NEW side and reported as 'new' — the old
 * identity's own disappearance is never surfaced. This closes that gap by
 * walking backward from the old side.
 *
 * A renamed function is identified by BODY match (same normalized-body-hash
 * suffix), not by name — the name is exactly what changed in a rename, so
 * matching on it would find nothing. A body match to a name that still
 * exists unchanged elsewhere in the new file (e.g. a genuine duplicate) is
 * treated as "not actually gone" and excluded, since that function's own
 * identity survives under its original name.
 */
function findRenamedAwayUnits(
  oldBoundaries: readonly FunctionBoundary[],
  oldSourceText: string,
  newBoundaries: readonly FunctionBoundary[],
  newSourceText: string,
): ChangedUnit[] {
  const newNames = new Set(newBoundaries.map((b) => b.name));
  const newBodyHashes = new Set(
    newBoundaries
      .map((b) => bodyHashOf(deriveStructuralUnitKey(b.name, b.bodyRange, newSourceText) ?? ''))
      .filter((hash): hash is string => hash !== null),
  );

  const renamedAway: ChangedUnit[] = [];
  for (const oldBoundary of oldBoundaries) {
    if (newNames.has(oldBoundary.name)) continue; // still present under the same name — not a rename.

    const oldUnitKey = deriveStructuralUnitKey(
      oldBoundary.name,
      oldBoundary.bodyRange,
      oldSourceText,
    );
    if (!oldUnitKey) continue;

    const oldBodyHash = bodyHashOf(oldUnitKey);
    if (oldBodyHash !== null && newBodyHashes.has(oldBodyHash)) {
      // Same body survives under a different name elsewhere in the new
      // file — this old unit was renamed, not deleted outright. Surfacing
      // it as 'deleted' retires its stale identity from the mapping
      // engine's perspective, exactly like the whole-file-deletion path
      // already does for every unit in a removed file.
      renamedAway.push({
        filePath: '', // filled in by the caller, which knows the correct (new) filePath.
        unitKey: oldUnitKey,
        branchId: null,
        changeKind: 'deleted',
      });
    }
  }
  return renamedAway;
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
      const unitKey = deriveStructuralUnitKey(boundary.name, boundary.bodyRange, oldSourceText);
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

  // A function renamed within the diff is otherwise only ever seen from the
  // NEW side (reported 'new' above) — its old identity's own disappearance
  // is never surfaced without this pass. See findRenamedAwayUnits' own
  // docblock for why body-hash matching, not name matching, is required.
  if (oldSourceText !== null) {
    const renamedAway = findRenamedAwayUnits(
      oldBoundaries,
      oldSourceText,
      newBoundaries,
      newSourceText,
    ).map((unit) => ({ ...unit, filePath: fileDiff.filePath }));
    units.push(...renamedAway);
  }

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
  assertSafeGitRef(baseRef);
  assertSafeGitRef(headRef);

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
