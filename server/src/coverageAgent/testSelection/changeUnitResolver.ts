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

/** Fallback qualified name for a function-like node with no resolvable name (matching structuralKeyService's own fallback convention) — shared as a constant since it's a sentinel, not a real identifier, and multiple functions in the same file legitimately share it. */
const ANONYMOUS_NAME = '<anonymous>';

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
  /**
   * Structural address: this function's own index among its DIRECT parent
   * function's immediate function-like children (in document/traversal
   * order), preceded by the parent's own path — e.g. `[2, 0, 1]` means "the
   * 2nd top-level function's own 0th child function's own 1st child
   * function". Top-level functions have a single-element path (their own
   * top-level index).
   *
   * Exists ONLY to disambiguate '<anonymous>' boundaries across revisions
   * without relying on body-hash equality — see findRenamedAwayUnits' own
   * docblock for why hash equality is unsound for nested anonymous
   * functions (an outer function's hash cascades whenever ANY nested
   * content changes, even if the outer function's own logic is untouched).
   * A path is stable across an in-place body edit at the SAME nesting slot
   * (the edit doesn't change how many sibling functions came before it),
   * making "same path" a reliable "same anonymous function, wherever its
   * body changed" signal — though NOT reliable across a change that adds/
   * removes an earlier SIBLING anonymous function at the same nesting
   * level, which shifts every later sibling's own index. That residual gap
   * is accepted as a known limitation (documented in ADR-003) rather than
   * over-engineered away — MINCRM-623's own AC only calls for "detectable
   * where possible", not exhaustive AST-diffing.
   */
  path: readonly number[];
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
  return ANONYMOUS_NAME;
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
 * containment range (full node span), body range, and structural path (see
 * FunctionBoundary's own docblock for why these must be tracked separately).
 * Ordered innermost-last is NOT guaranteed; callers that need "most specific
 * enclosing function" must pick the smallest range themselves (see
 * findEnclosingFunction).
 *
 * Path is tracked via a counter stack — one counter per nesting level,
 * incremented each time a function-like child is found at that level,
 * pushed/popped as the walk enters/leaves a function body. This gives every
 * function a document-order structural address independent of its own body
 * content, which is what makes it useful for matching anonymous functions
 * across revisions (see FunctionBoundary.path's own docblock).
 */
function findFunctionBoundaries(sourceFile: ts.SourceFile): FunctionBoundary[] {
  const boundaries: FunctionBoundary[] = [];
  const pathStack: number[] = [];
  const siblingCounters: number[] = [0];

  function visit(node: ts.Node): void {
    if (isFunctionLike(node) && node.body) {
      const ownIndex = siblingCounters[siblingCounters.length - 1];
      siblingCounters[siblingCounters.length - 1] = ownIndex + 1;
      const path = [...pathStack, ownIndex];

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
        path,
      });

      pathStack.push(ownIndex);
      siblingCounters.push(0);
      ts.forEachChild(node, visit);
      siblingCounters.pop();
      pathStack.pop();
      return;
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
    // A pure-deletion hunk (diffParser's own zero-width range,
    // startLine === endLine) has no line strictly inside [startLine,
    // endLine) for the loop below to ever visit — its anchor line itself
    // must still be checked, or a function changed ONLY by deleting lines
    // would resolve to no changed unit at all (found via Greptile PR
    // review). Checked unconditionally alongside the loop rather than
    // folding into the loop bounds, since a NON-zero-width range must
    // still visit every line in [startLine, endLine), not just its start.
    const anchorBoundary = findEnclosingFunction(boundaries, range.startLine);
    if (anchorBoundary) {
      const anchorUnitKey = deriveStructuralUnitKey(
        anchorBoundary.name,
        anchorBoundary.bodyRange,
        sourceText,
      );
      if (anchorUnitKey && !byUnitKey.has(anchorUnitKey)) {
        byUnitKey.set(anchorUnitKey, { boundary: anchorBoundary, unitKey: anchorUnitKey });
      }
    }

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

/**
 * Detects functions present in the OLD revision's boundaries that are truly
 * GONE from the NEW revision — renamed, or removed outright — in either case
 * within an otherwise-retained (not whole-file-deleted) file. classifyChange
 * alone only ever looks FORWARD from a new-side boundary to its old-side
 * namesake, so neither case is otherwise seen from the new side at all: a
 * rename's old name is simply absent (its NEW name gets reported 'new', with
 * the old identity's disappearance never surfaced), and an outright removal
 * has NO new-side boundary whatsoever for changeUnitResolver's line-based
 * resolution to ever reach — a pure-deletion hunk's own zero-width anchor
 * (see resolveEnclosingUnitsForRanges) is checked against the NEW AST only,
 * where a fully-removed function has no boundary to find at all, so the
 * anchor silently resolves to nothing or to an unrelated adjacent function
 * (found via Greptile PR review). This function closes BOTH gaps by walking
 * backward from the old side, independent of whatever diffParser's hunk
 * ranges did or didn't cover.
 *
 * "Still present" is decided PER NAME, matching classifyChange's own
 * forward-pass convention (an edited-in-place NAMED function is correctly
 * NOT reported here — classifyChange already reports it 'in-line' from the
 * new side) — EXCEPT for the '<anonymous>' sentinel name, where name-based
 * presence is meaningless: every anonymous function shares that exact same
 * fallback name (see qualifiedNameOf), so a file with two or more anonymous
 * callbacks would always find SOME '<anonymous>' survivor and wrongly
 * conclude nothing was removed, even when a DIFFERENT anonymous callback was
 * genuinely deleted (found via Greptile PR review).
 *
 * For anonymous boundaries specifically, this compares by BOTH structural
 * PATH (FunctionBoundary.path — see that field's own docblock) AND body
 * hash — "still present" if EITHER matches a new anonymous boundary. Each
 * signal alone is unsound in a different case, so both are checked:
 *  - Path alone fails when an EARLIER anonymous sibling is added/removed:
 *    every later sibling's own path index shifts, so an untouched later
 *    callback's OLD path no longer matches its own NEW path even though its
 *    body never changed — hash correctly catches this case instead (an
 *    unchanged function's hash is stable regardless of its new position).
 *  - Hash alone fails when an OUTER anonymous function's NESTED content
 *    changes: the hash covers the full source text of the function
 *    (nested functions included), so editing only an inner callback's
 *    literal makes the outer callback's own hash look "removed" too, even
 *    though the outer callback's own logic never changed (found during
 *    this fix's own verification — the existing same-line-nested-callback
 *    regression test caught it) — path correctly catches this case
 *    instead (a body edit at the same nesting slot doesn't change how many
 *    sibling functions came before it).
 *
 * A NAMED old boundary whose name is gone is emitted as 'deleted' whether
 * or not its body survives under a different name elsewhere (a rename) —
 * intentional, not just a fallback for the "no rename detected" case:
 * either way the old identity no longer exists in the new file and should
 * be retired from the mapping engine's perspective, exactly like the
 * whole-file-deletion path already does for every unit in a removed file.
 */
function findRenamedAwayUnits(
  oldBoundaries: readonly FunctionBoundary[],
  oldSourceText: string,
  newBoundaries: readonly FunctionBoundary[],
  newSourceText: string,
  filePath: string,
): ChangedUnit[] {
  const newNamedNames = new Set(
    newBoundaries.filter((b) => b.name !== ANONYMOUS_NAME).map((b) => b.name),
  );

  // Anonymous boundaries need a genuine one-to-one PAIRING between old and
  // new, not two independent "does X exist anywhere in Y" set-membership
  // checks — an OR of independent path/hash membership checks can each
  // individually match a DIFFERENT survivor than the one actually being
  // tested, producing a false "still present" (found during this fix's own
  // verification: removing an EARLIER anonymous sibling shifts a later
  // untouched sibling into the removed one's own old path slot, so the
  // removed one's old path spuriously matches the untouched survivor's new
  // path even though hash correctly shows they're different functions).
  //
  // Pairing strategy, in priority order (each pass consumes the new
  // boundaries it matches, so a later pass never re-matches an already-
  // paired one):
  //   1. Exact body-hash match — unambiguous: an unchanged function's hash
  //      is stable regardless of its new position (recovers a later
  //      sibling shifted by an earlier sibling's own removal/addition).
  //   2. Exact path match among what's LEFT after (1) — recovers an
  //      in-place body edit at the same nesting slot, whose hash therefore
  //      changed but whose position didn't (see this function's own
  //      docblock for why hash alone is unsound for nested edits).
  // Any old anonymous boundary left unmatched after both passes is
  // genuinely gone.
  const oldAnonymous = oldBoundaries.filter((b) => b.name === ANONYMOUS_NAME);
  const newAnonymous = newBoundaries.filter((b) => b.name === ANONYMOUS_NAME);
  const oldAnonymousHashes = new Map(
    oldAnonymous.map((b) => [b, deriveStructuralUnitKey(b.name, b.bodyRange, oldSourceText)]),
  );
  const newAnonymousHashes = new Map(
    newAnonymous.map((b) => [b, deriveStructuralUnitKey(b.name, b.bodyRange, newSourceText)]),
  );

  const matchedOldAnonymous = new Set<FunctionBoundary>();
  const unmatchedNewAnonymous = new Set(newAnonymous);

  // Pass 1: exact hash match.
  for (const oldBoundary of oldAnonymous) {
    const oldHash = oldAnonymousHashes.get(oldBoundary);
    if (!oldHash) continue;
    const match = [...unmatchedNewAnonymous].find((nb) => newAnonymousHashes.get(nb) === oldHash);
    if (match) {
      matchedOldAnonymous.add(oldBoundary);
      unmatchedNewAnonymous.delete(match);
    }
  }

  // Pass 2: exact path match, among new boundaries pass 1 didn't already claim.
  for (const oldBoundary of oldAnonymous) {
    if (matchedOldAnonymous.has(oldBoundary)) continue;
    const oldPath = oldBoundary.path.join(',');
    const match = [...unmatchedNewAnonymous].find((nb) => nb.path.join(',') === oldPath);
    if (match) {
      matchedOldAnonymous.add(oldBoundary);
      unmatchedNewAnonymous.delete(match);
    }
  }

  const removedOrRenamedAway: ChangedUnit[] = [];
  for (const oldBoundary of oldBoundaries) {
    const oldUnitKey = deriveStructuralUnitKey(
      oldBoundary.name,
      oldBoundary.bodyRange,
      oldSourceText,
    );
    if (!oldUnitKey) continue;

    const stillPresent =
      oldBoundary.name === ANONYMOUS_NAME
        ? matchedOldAnonymous.has(oldBoundary)
        : newNamedNames.has(oldBoundary.name);
    if (stillPresent) continue;

    removedOrRenamedAway.push({
      filePath,
      unitKey: oldUnitKey,
      branchId: null,
      changeKind: 'deleted',
    });
  }
  return removedOrRenamedAway;
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

  // A function renamed OR removed outright within the diff is otherwise
  // only ever seen (if at all) from the NEW side — a rename's new name
  // reports 'new' above, and an outright removal has no new-side boundary
  // for the loop above to ever reach at all. See findRenamedAwayUnits' own
  // docblock for why this closes both gaps.
  if (oldSourceText !== null) {
    const removedOrRenamedAway = findRenamedAwayUnits(
      oldBoundaries,
      oldSourceText,
      newBoundaries,
      newSourceText,
      fileDiff.filePath,
    );
    units.push(...removedOrRenamedAway);
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
