/**
 * Coverage/TIA changed-code-unit resolver.
 *
 * Takes diffParser.ts's per-file changed line ranges and resolves them to
 * changed UNITS: (filePath, unitKey, branchId) triples keyed exactly the way
 * structuralKeyService.deriveStructuralUnitKey derives coverage_units'
 * own unit_key, so the result can be looked up directly against the mapping
 * query API with no translation step.
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
 * the AC only calls for "language-aware for MiniCRM's backend and
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

/**
 * How a changed unit's presence differs between the old and new revision.
 * 'ambiguous' means: this name has 2+ same-named boundaries in the old
 * revision and the new boundary's own body hash doesn't exactly match any
 * of them — there is no sound way to know WHICH old same-named sibling (if
 * any) this new boundary actually corresponds to, so no specific claim
 * ('new'/'in-line'/'refactor') is made. See classifyChange's own docblock
 * for why this is preferred over guessing via structural position.
 */
export type ChangeKind = 'new' | 'deleted' | 'in-line' | 'refactor' | 'ambiguous';

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
  /** Config/resource/migration files from the diff, untouched — the dependency-graph step owns these. */
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
 * containment range (full node span), and body range (see FunctionBoundary's
 * own docblock for why the two ranges must be tracked separately). Ordered
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

      ts.forEachChild(node, visit);
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
 *  - 'new': no old boundary shares the new boundary's name at all (a
 *    brand-new function, not just an edited one).
 *  - 'in-line': exactly one old boundary AND exactly one new boundary
 *    share the name, and the structural key (name + normalized body hash)
 *    actually changed — an ordinary edit to the function's own logic.
 *  - 'refactor': exactly one old boundary AND exactly one new boundary
 *    share the name, and the body hash is UNCHANGED — used when git's own
 *    diff still attributed a change here even though the enclosing
 *    function's own body is identical (e.g. a change to a sibling
 *    statement inside a shared block was misattributed to this function's
 *    range boundary), signaling the change is likely structural movement
 *    rather than a logic edit. Detectable-only, per the AC — a best-effort
 *    signal, not a guarantee.
 *  - 'ambiguous': 2+ boundaries share the name on EITHER side (old, new,
 *    or both) — see below for why 'refactor'/'in-line' can never be a
 *    sound claim in this case, regardless of whether some sibling's hash
 *    happens to match.
 *
 * ONLY exact body-hash matching disambiguates which old same-named
 * boundary (if any) a new boundary corresponds to — NOT structural
 * position. Position (a function's index among same-named siblings,
 * tracked in an earlier version of this module as `FunctionBoundary.path`)
 * was tried first and found unsound in this exact spot too (found via a
 * second, independent adversarial review — path-based disambiguation had
 * already been rejected for findRenamedAwayUnits for the identical reason,
 * see that function's own docblock, but was initially believed "safe as a
 * preference, falling back to first-match" here specifically): whenever a
 * same-named sibling is deleted, added, or both in the same diff, every
 * LATER same-named sibling's own path index shifts, so "same path" stops
 * meaning "same function" the moment membership changes at all — verified
 * with a live repro where an earlier same-named class was deleted and a
 * later one was independently added, netting an unchanged name-group
 * size; path-preferring classification still classified the genuinely-new
 * boundary as `'in-line'` (comparing it against an unrelated old boundary
 * that merely happened to share its shifted path) instead of `'new'`. The
 * `path` field itself has since been removed from FunctionBoundary —
 * nothing in this module reads structural position anymore.
 *
 * Crucially, 'refactor' requires comparing a boundary against ITS OWN old
 * self — that's what makes "hash unchanged" mean "this specific function's
 * logic didn't change". With 2+ same-named old candidates there is no
 * sound way to know which one (if any) is "its own old self", so even
 * finding an EXACT hash match against ONE of several candidates proves
 * nothing about whether the reported boundary's own logic changed: the
 * match may simply be a coincidence between two unrelated, differently-
 * edited siblings that happen to produce identical bodies (found via a
 * third independent adversarial review, live-repro'd — editing ClassB's
 * render() to a body byte-identical to ClassA's own always-untouched
 * render() previously reported ClassB's genuine edit as 'refactor', i.e.
 * "no real logic change", which is exactly backwards: ClassB's logic DID
 * change, from ClassA's perspective nothing changed at all, and the two
 * cannot be told apart from hash alone). An earlier version of this
 * function returned 'refactor' whenever ANY of the 2+ candidates' hashes
 * matched — that version is what produced the backwards result above.
 * 2+ candidates can therefore only ever yield 'ambiguous', never
 * 'refactor', regardless of whether some candidate's hash happens to
 * match.
 *
 * `newSameNameCount` (how many NEW boundaries — including this one —
 * share `newBoundaryName`) exists because old-side count alone is not
 * enough: a version of this function that only ever looked at
 * `oldBoundaries.length` would see exactly one old candidate and
 * confidently report 'in-line'/'refactor' even when a BRAND-NEW same-named
 * sibling was added alongside an untouched old namesake in the same diff —
 * this specific new boundary might be the brand-new one, not the old
 * namesake's own successor, and there is no way to tell which from the old
 * side's count alone (found via a fifth independent adversarial review,
 * live-repro'd: old file has only `ClassA.render()`; new file adds an
 * untouched-old-`ClassA` PLUS a brand-new `ClassB.render()` — resolving
 * ClassB's own insertion previously reported `'in-line'`, or `'refactor'`
 * if ClassB's body coincidentally matched ClassA's, for a function that
 * never existed before at all). Requiring BOTH sides' same-name count to
 * be exactly 1 closes this gap symmetrically with `findRenamedAwayUnits`,
 * which has always operated on both sides' boundaries together.
 */
function classifyChange(
  newUnitKey: string,
  newBoundaryName: string,
  oldBoundaries: readonly FunctionBoundary[],
  oldSourceText: string,
  newSameNameCount: number,
): ChangeKind {
  const sameNameCandidates = oldBoundaries.filter((b) => b.name === newBoundaryName);
  if (sameNameCandidates.length === 0) {
    return 'new';
  }

  if (sameNameCandidates.length === 1 && newSameNameCount === 1) {
    // Unambiguous — exactly one same-named boundary on EACH side, no risk
    // of comparing against the wrong sibling in either direction.
    const oldHash = deriveStructuralUnitKey(
      sameNameCandidates[0].name,
      sameNameCandidates[0].bodyRange,
      oldSourceText,
    );
    return oldHash === newUnitKey ? 'refactor' : 'in-line';
  }

  // 2+ boundaries share this name on at least one side — see this
  // function's own docblock for why 'refactor'/'in-line' are never sound
  // claims here, even when one of the candidates' hashes matches: this
  // NEW boundary isn't necessarily the one old candidate's own successor
  // when 2+ new boundaries share the name too (a brand-new same-named
  // sibling added alongside an untouched old namesake would otherwise be
  // misclassified as an edit to that old namesake, since old-side count
  // alone can't see the new-side collision).
  return 'ambiguous';
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
 * "Still present" requires a genuine one-to-one PAIRING between old and new
 * boundaries of the SAME NAME, not a "does this name exist anywhere in the
 * new file" set-membership check — a plain name check is unsound whenever
 * TWO OR MORE boundaries share a name, which is exactly the situation for
 * EVERY '<anonymous>' function (they all share that one fallback name — see
 * qualifiedNameOf) but is not exclusive to anonymous functions: two
 * DIFFERENTLY-BODIED named functions sharing a real qualified name (e.g. two
 * unrelated `render` methods on different classes) hit the identical false-
 * survivor bug (found via Greptile PR review, after an earlier version of
 * this fix wrongly special-cased '<anonymous>' as the only name capable of
 * colliding). Every name — anonymous or real — is therefore grouped and
 * paired the same way, with no special case for the sentinel name.
 *
 * Pairing strategy per name group, for EVERY group size (including 1-old/
 * 1-new): EXACT BODY-HASH MATCH ONLY, full stop — no special case for any
 * particular count. An earlier version of this function special-cased
 * "exactly one old and exactly one new boundary share this name" as an
 * unconditional pairing, reasoned as unambiguous "by construction, no
 * sibling to confuse either one with". That reasoning only rules out
 * confusion with another candidate present in the SAME diff's SAME name
 * group at pairing time — it does not rule out the group's own counts
 * merely coincidentally collapsing to 1-and-1 because an unrelated
 * same-named old boundary was independently deleted while an unrelated
 * same-named new boundary was independently added elsewhere in the same
 * group, netting an unchanged count of 1 on each side (found via a fourth
 * independent adversarial review, live-repro'd: old `foo` (body A)
 * deleted, an unrelated new `foo` (body B) added elsewhere in the same
 * file, in the same diff — the 1:1 shortcut paired them unconditionally,
 * and old `foo`'s real deletion silently never appeared as a 'deleted'
 * entry at all — a genuine silent MISS, not just over-reporting, and
 * exactly the failure mode this whole function exists to prevent). An
 * even earlier version added a structural-position pass (each boundary's
 * index among same-named siblings, previously tracked as
 * `FunctionBoundary.path`) for 2+ groups whose old/new counts happened to
 * match, which a THIRD independent adversarial review separately found
 * unsound for the identical reason (sibling rotation defeats any count
 * guard). There is no group size — not even 1-and-1 — for which "same
 * name" alone, or any positional/count-based signal derived from it, is a
 * sound stand-in for "same function"; only an exact body-hash match is,
 * and the `path` field has been removed from FunctionBoundary entirely —
 * nothing in this module reads structural position anymore.
 *
 * Any old boundary left unpaired is emitted as 'deleted' — whether or not
 * its body survives under a different name elsewhere (a rename), and
 * whether or not it was actually just shifted in position by an unrelated
 * sibling change: there is no sound positional signal to say otherwise,
 * and over-reporting a spurious 'deleted' is the intentionally safe
 * direction here (a stale mapping-engine entry gets retired a build early
 * and reconciliation repopulates it on next ingest; a missed 'deleted'
 * would silently drop real test coverage from selection).
 *
 * KNOWN, ACCEPTED LIMITATION (found via a fifth independent adversarial
 * review, live-repro'd): hash-only matching cannot distinguish "old
 * boundary X1 was renamed/moved to become new boundary X3" from "X1 was
 * deleted outright, and X3 is an entirely unrelated new boundary that
 * happens to have a byte-identical body" — e.g. old `X1.render()`
 * (body "A") is deleted while `X2.render()` (body "B") survives
 * untouched, and an unrelated brand-new `X3.render()` (body "A",
 * coincidentally identical to X1's OLD body) is added in the same diff:
 * hash-matching pairs X1↔X3 and X2↔X2, reporting ZERO deletions, even
 * though X1 is genuinely gone. This is NOT fixable by adding a positional/
 * containment tie-breaker (e.g. "which class each `render` belongs to")
 * — that is structurally the same move as the sibling-index/path-matching
 * approaches already tried and rejected above, and is defeated the same
 * way (e.g. if X1's own enclosing class is *also* renamed in the same
 * commit). It is the exact same fundamental ceiling `git diff
 * --find-renames` itself has when pairing deleted/added FILES by content
 * similarity (see diffParser.ts's own use of `--find-renames=50%`) — a
 * purely content-addressed signal cannot, even in principle, distinguish
 * "same content because same entity" from "same content, coincidentally,
 * for a different entity" without consulting information this module
 * doesn't have access to (authorial intent, cross-file usage/call-site
 * graphs). Accepted as an unavoidable false-negative in the identical
 * spirit as the module's own over-reporting tradeoff: rare in practice
 * (requires a genuinely byte-identical body collision across unrelated
 * same-named siblings in one diff), and bounded in blast radius by the
 * same reconciliation safety net that already handles every other
 * under/over-reporting edge case here.
 */
function findRenamedAwayUnits(
  oldBoundaries: readonly FunctionBoundary[],
  oldSourceText: string,
  newBoundaries: readonly FunctionBoundary[],
  newSourceText: string,
  filePath: string,
): ChangedUnit[] {
  const oldHashes = new Map(
    oldBoundaries.map((b) => [b, deriveStructuralUnitKey(b.name, b.bodyRange, oldSourceText)]),
  );
  const newHashes = new Map(
    newBoundaries.map((b) => [b, deriveStructuralUnitKey(b.name, b.bodyRange, newSourceText)]),
  );

  const newBoundariesByName = new Map<string, FunctionBoundary[]>();
  for (const nb of newBoundaries) {
    const group = newBoundariesByName.get(nb.name);
    if (group) {
      group.push(nb);
    } else {
      newBoundariesByName.set(nb.name, [nb]);
    }
  }

  const matchedOld = new Set<FunctionBoundary>();
  const unmatchedNewByName = new Map<string, Set<FunctionBoundary>>();
  for (const [name, group] of newBoundariesByName) {
    unmatchedNewByName.set(name, new Set(group));
  }

  const oldBoundariesByName = new Map<string, FunctionBoundary[]>();
  for (const ob of oldBoundaries) {
    const group = oldBoundariesByName.get(ob.name);
    if (group) {
      group.push(ob);
    } else {
      oldBoundariesByName.set(ob.name, [ob]);
    }
  }

  for (const [name, oldGroup] of oldBoundariesByName) {
    const unmatchedNew = unmatchedNewByName.get(name);
    if (!unmatchedNew) continue; // name doesn't exist at all in the new file — every boundary in this group is gone.

    // Exact hash match only, regardless of this name group's old/new
    // counts — including the 1-old/1-new case. An earlier version of this
    // pass special-cased "exactly one old and exactly one new boundary
    // share this name" as an unconditional pairing (reasoned as
    // unambiguous "by construction, no sibling to confuse it with"). That
    // reasoning only rules out confusion with another SAME-DIFF candidate
    // — it does not rule out the group's counts merely coincidentally
    // collapsing to 1-and-1 because an unrelated same-named old boundary
    // was independently deleted elsewhere in the SAME name group while an
    // unrelated same-named new boundary was independently added elsewhere
    // in it, netting an unchanged count of 1 on each side (found via a
    // fourth independent adversarial review, live-repro'd: old `foo`
    // (body A) deleted, an unrelated new `foo` (body B) added elsewhere in
    // the same file, in the same diff — the 1:1 shortcut paired them
    // unconditionally, and old `foo`'s real deletion silently never
    // appeared as a 'deleted' entry at all — a genuine silent MISS, not
    // just over-reporting, and exactly the failure mode this whole
    // function exists to prevent). There is no group size — not even
    // 1-and-1 — for which "same name" alone is a sound stand-in for "same
    // function"; only an exact body-hash match is.
    for (const oldBoundary of oldGroup) {
      const oldHash = oldHashes.get(oldBoundary);
      if (!oldHash) continue;
      const match = [...unmatchedNew].find((nb) => newHashes.get(nb) === oldHash);
      if (match) {
        matchedOld.add(oldBoundary);
        unmatchedNew.delete(match);
      }
    }
  }

  const removedOrRenamedAway: ChangedUnit[] = [];
  for (const oldBoundary of oldBoundaries) {
    if (matchedOld.has(oldBoundary)) continue;

    const oldUnitKey = oldHashes.get(oldBoundary);
    if (!oldUnitKey) continue;

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

  if (fileDiff.status === 'added') {
    if (resolved.size === 0 && fileDiff.changedRanges.length > 0) {
      return {
        units: [],
        unresolved: {
          filePath: fileDiff.filePath,
          reason:
            'No enclosing function found for any changed line (top-level/module-scope change)',
        },
      };
    }
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

  // Same-name counts on the NEW side — classifyChange needs this
  // alongside the old side's own count (see its own docblock for why
  // old-side count alone isn't enough).
  const newSameNameCounts = new Map<string, number>();
  for (const nb of newBoundaries) {
    newSameNameCounts.set(nb.name, (newSameNameCounts.get(nb.name) ?? 0) + 1);
  }

  const units: ChangedUnit[] = Array.from(resolved.values()).map(({ boundary, unitKey }) => ({
    filePath: fileDiff.filePath,
    unitKey,
    branchId: null,
    changeKind:
      oldSourceText === null
        ? 'new'
        : classifyChange(
            unitKey,
            boundary.name,
            oldBoundaries,
            oldSourceText,
            newSameNameCounts.get(boundary.name) ?? 0,
          ),
  }));

  // A function renamed OR removed outright within the diff is otherwise
  // only ever seen (if at all) from the NEW side — a rename's new name
  // reports 'new' above, and an outright removal has no new-side boundary
  // for the loop above to ever reach at all. See findRenamedAwayUnits' own
  // docblock for why this closes both gaps.
  //
  // Run BEFORE deciding whether the forward pass's own "no enclosing
  // function found" result is truly unresolved — a zero-width deletion
  // anchor (see resolveEnclosingUnitsForRanges) can legitimately land
  // outside every function's containment range in the NEW file (e.g. the
  // deleted content was an entire top-level declaration sitting between two
  // others, so the anchor now points at unrelated sibling code, not
  // anything nested), even when the actual removed content WAS itself a
  // function this backward pass correctly detects. Gating this pass behind
  // "the forward pass found something" would silently skip rename/removal
  // detection for exactly the case it exists to catch (found via Greptile
  // PR review + this fix's own verification: a class sitting at the very
  // top of a file, removed entirely, anchors its zero-width deletion hunk
  // at the surviving file's own line 1 — inside the NEXT class's opening
  // brace, not inside any method's own containment range).
  const removedOrRenamedAway =
    oldSourceText !== null
      ? findRenamedAwayUnits(
          oldBoundaries,
          oldSourceText,
          newBoundaries,
          newSourceText,
          fileDiff.filePath,
        )
      : [];
  units.push(...removedOrRenamedAway);

  if (units.length === 0 && fileDiff.changedRanges.length > 0) {
    return {
      units: [],
      unresolved: {
        filePath: fileDiff.filePath,
        reason: 'No enclosing function found for any changed line (top-level/module-scope change)',
      },
    };
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
