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
import * as ts from 'typescript';

/** A half-open [start, end) source position, 1-based line / 0-based column, matching istanbul's Location shape. */
export interface StructuralKeyLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

const ANONYMOUS_FUNCTION_NAME = '<anonymous>';
const BODY_HASH_LENGTH = 16;

/**
 * Strips real comments and inter-token whitespace/newlines (never touching
 * string/template literal content), so two functions differing only in
 * formatting/comments normalize to the same string before hashing, while a
 * genuine difference in literal whitespace (e.g. "hello   world" vs
 * "hello world") still changes the hash — every kept token's exact text is
 * preserved byte-for-byte; only the separator BETWEEN tokens is normalized
 * to a single space. An earlier version ran a blind `.replace(/\s+/g, ' ')`
 * over the fully-joined string, which also collapsed whitespace runs inside
 * string/template literal tokens themselves, silently merging two functions
 * with genuinely different literal content (found via Greptile PR review).
 *
 * Uses TypeScript's own lexical scanner (`ts.createScanner`), not a regex —
 * a regex-based comment strip was tried first and found to have genuine
 * FALSE-SAME collision bugs: both an unanchored `\/\/[^\n]*` (matching a
 * `//` inside a string like `"http://example.com/a"`) and a block-comment
 * pattern `\/\*[\s\S]*?\*\// `(matching a literal `/* ... *\/` SEQUENCE
 * inside a string, e.g. two functions differing only in
 * `"prefix /* A *\/ suffix"` vs `"prefix /* B *\/ suffix"`) silently
 * truncated or erased string content, causing two functions with
 * genuinely different bodies to hash identically — not just a missed
 * dedup, but corrupted coverage_units/coverage_test_links identity. The
 * scanner tokenizes string/template literals as single atomic tokens
 * (their contents are never re-interpreted as comment syntax), so this
 * class of bug cannot recur. Only SingleLineCommentTrivia and
 * MultiLineCommentTrivia tokens are dropped; every other token's exact
 * text is kept.
 *
 * The scanner tokenizes best-effort even over a source fragment that
 * isn't a complete, syntactically valid file on its own (a single
 * function's body slice, as extractRange produces) — the scanner reports
 * tokens/trivia lexically without requiring a parse, so this works
 * correctly on a bare fragment.
 */
function normalizeSourceForHash(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ false);
  scanner.setText(source);

  // Joined with a single space BETWEEN tokens, never touching a token's own
  // text — an earlier version ran `.replace(/\s+/g, ' ')` over the fully
  // joined string, which also collapsed whitespace INSIDE string/template
  // literal tokens (e.g. "hello   world" vs "hello world" normalized to the
  // same text despite the scanner correctly keeping them as distinct atomic
  // tokens), silently merging two functions with genuinely different
  // literal content. Found via Greptile PR review.
  const tokens: string[] = [];
  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    if (
      kind !== ts.SyntaxKind.SingleLineCommentTrivia &&
      kind !== ts.SyntaxKind.MultiLineCommentTrivia &&
      kind !== ts.SyntaxKind.WhitespaceTrivia &&
      kind !== ts.SyntaxKind.NewLineTrivia
    ) {
      tokens.push(scanner.getTokenText());
    }
    kind = scanner.scan();
  }

  return tokens.join(' ');
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
