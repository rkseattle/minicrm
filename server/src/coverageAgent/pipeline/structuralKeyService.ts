/**
 * Coverage/TIA structural key derivation. (MINCRM-619)
 *
 * Derives a coverage_units.unit_key that stays stable across in-line edits
 * and simple refactors, replacing the earlier `${name}@${declLine}` key
 * (still visible in git history via qualifiedUnitKey/qualifiedUnitKeyForLine
 * prior to this change) that MINCRM-616 flagged as a placeholder: a
 * line-number-based key breaks identity the moment an unrelated edit
 * shifts a function up or down in its file, even though the function's own
 * body never changed.
 *
 * Key shape: `${qualifiedName}#${normalizedBodyHash}`.
 *  - qualifiedName is the function/method's own name (already resolved by
 *    the istanbul FunctionMapping — anonymous functions fall back to
 *    '<anonymous>', matching the prior key's own convention).
 *  - normalizedBodyHash is a SHA-256 (hex, truncated to 16 chars — enough
 *    collision resistance for this identity's purpose, short enough to
 *    keep unit_key readable in logs/DB rows) of the function's own source
 *    text, AFTER stripping whitespace-run differences and comments so that
 *    pure formatting/reflow edits do NOT change the key — only a genuine
 *    change to the function's logic does.
 *
 * This intentionally does NOT attempt full AST-equivalence normalization
 * (e.g. re-ordering object properties, alpha-renaming local variables) —
 * that would make the hash "same logic, different code" rather than "same
 * code, different formatting", which is a materially fuzzier identity than
 * MINCRM-619's own AC ("normalized (AST) body hash") calls for. Whitespace/
 * comment normalization is the well-understood, deterministic middle
 * ground: two functions with byte-identical logic but different
 * indentation or an added/removed comment still hash identically, while
 * any real edit to the executable body changes the hash.
 */

import { createHash } from 'crypto';

/** A half-open [start, end) source position, 1-based line / 0-based column, matching istanbul's Location shape. */
export interface StructuralKeyLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

const ANONYMOUS_FUNCTION_NAME = '<anonymous>';
const BODY_HASH_LENGTH = 16;

/**
 * Strips line comments, block comments, and collapses all whitespace runs
 * (including newlines) to a single space, so two functions differing only
 * in formatting/comments normalize to the same string before hashing.
 *
 * Deliberately simple (no real tokenizer) — this trades perfect handling of
 * pathological cases for zero new parser dependencies on the hot ingestion
 * path. The line-comment strip requires `//` to be preceded by whitespace
 * or start-of-line: a bare, unanchored `\/\/[^\n]*` would also match a `//`
 * inside a string literal (e.g. `"http://example.com/a"` vs
 * `"http://example.com/b"`) and truncate both lines at that point,
 * producing a genuine FALSE-SAME collision between two functions whose
 * bodies actually differ — not just a missed dedup, but silently merging
 * two different functions' hit counts into one coverage_units row. The
 * anchor closes that specific case (a `//` can still appear mid-token in
 * some string content this heuristic won't catch, degrading to a missed
 * dedup — never a false-same match — same graceful-degradation contract
 * as the rest of this function).
 */
function normalizeSourceForHash(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extracts the source substring for a [start, end) range out of a file's full text. */
function extractRange(sourceText: string, range: StructuralKeyLocation): string {
  const lines = sourceText.split('\n');
  const startLine = range.start.line - 1;
  const endLine = range.end.line - 1;

  if (startLine < 0 || endLine < 0 || startLine >= lines.length || endLine >= lines.length) {
    return '';
  }

  if (startLine === endLine) {
    return lines[startLine].slice(range.start.column, range.end.column);
  }

  const parts: string[] = [lines[startLine].slice(range.start.column)];
  for (let line = startLine + 1; line < endLine; line += 1) {
    parts.push(lines[line]);
  }
  parts.push(lines[endLine].slice(0, range.end.column));
  return parts.join('\n');
}

/**
 * Derives a stable structural key for a function given its own source text
 * slice. Returns null if the range could not be extracted (e.g. a range
 * that no longer fits the supplied source text) — callers fall back to the
 * legacy name+line key in that case rather than failing ingestion outright.
 */
export function deriveStructuralUnitKey(
  functionName: string,
  bodyRange: StructuralKeyLocation,
  sourceText: string,
): string | null {
  const body = extractRange(sourceText, bodyRange);
  if (!body) {
    return null;
  }

  const normalized = normalizeSourceForHash(body);
  const hash = createHash('sha256')
    .update(normalized, 'utf8')
    .digest('hex')
    .slice(0, BODY_HASH_LENGTH);
  const qualifiedName = functionName || ANONYMOUS_FUNCTION_NAME;
  return `${qualifiedName}#${hash}`;
}

/** True if a unit_key was produced by deriveStructuralUnitKey (has the `name#hash` shape), vs. a legacy `name@line` key. */
export function isStructuralUnitKey(unitKey: string): boolean {
  return unitKey.includes('#');
}
