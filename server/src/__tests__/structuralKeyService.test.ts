/**
 * Unit tests for structuralKeyService. (MINCRM-619)
 */

import { describe, expect, it } from 'vitest';
import {
  deriveStructuralUnitKey,
  isStructuralUnitKey,
} from '../coverageAgent/pipeline/structuralKeyService.js';

const RANGE_LINES_1_TO_3 = {
  start: { line: 1, column: 0 },
  end: { line: 3, column: 1 },
};

describe('structuralKeyService', () => {
  describe('deriveStructuralUnitKey', () => {
    it('produces a `name#hash` shaped key', () => {
      const source = ['function add(a, b) {', '  return a + b;', '}'].join('\n');
      const key = deriveStructuralUnitKey('add', RANGE_LINES_1_TO_3, source);
      expect(key).toMatch(/^add#[0-9a-f]{16}$/);
    });

    it('falls back to <anonymous> for an unnamed function', () => {
      const source = ['function (a, b) {', '  return a + b;', '}'].join('\n');
      const key = deriveStructuralUnitKey('', RANGE_LINES_1_TO_3, source);
      expect(key).toMatch(/^<anonymous>#[0-9a-f]{16}$/);
    });

    it('is stable across whitespace-only reformatting', () => {
      const oneLine = 'function add(a, b) { return a + b; }';
      const multiLine = ['function add(a, b) {', '  return a + b;', '}'].join('\n');

      const oneLineKey = deriveStructuralUnitKey(
        'add',
        { start: { line: 1, column: 0 }, end: { line: 1, column: oneLine.length } },
        oneLine,
      );
      const multiLineKey = deriveStructuralUnitKey('add', RANGE_LINES_1_TO_3, multiLine);

      expect(oneLineKey).toBe(multiLineKey);
    });

    it('is stable across comment-only changes', () => {
      const withoutComment = ['function add(a, b) {', '  return a + b;', '}'].join('\n');
      const withComment = [
        'function add(a, b) {',
        '  // sum the two inputs',
        '  return a + b;',
        '}',
      ].join('\n');

      const keyWithout = deriveStructuralUnitKey('add', RANGE_LINES_1_TO_3, withoutComment);
      const keyWith = deriveStructuralUnitKey(
        'add',
        { start: { line: 1, column: 0 }, end: { line: 4, column: 1 } },
        withComment,
      );

      expect(keyWith).toBe(keyWithout);
    });

    it('changes when the function body logic changes', () => {
      const original = ['function add(a, b) {', '  return a + b;', '}'].join('\n');
      const edited = ['function add(a, b) {', '  return a - b;', '}'].join('\n');

      const originalKey = deriveStructuralUnitKey('add', RANGE_LINES_1_TO_3, original);
      const editedKey = deriveStructuralUnitKey('add', RANGE_LINES_1_TO_3, edited);

      expect(editedKey).not.toBe(originalKey);
    });

    it('does not collide two functions that differ only in a URL string literal containing "//"', () => {
      // Regression test: an earlier regex-based comment strip
      // (`\/\/[^\n]*`, later anchored to `(^|\s)\/\/[^\n]*`) matched a "//"
      // inside a string literal like these URLs, truncating both bodies at
      // that point and producing a false-SAME hash for two functions whose
      // bodies genuinely differ — silently merging their coverage_units
      // rows. The current implementation uses TypeScript's own scanner,
      // which tokenizes the whole string literal atomically and never
      // re-interprets its contents as comment syntax.
      const withUrlA = 'function f() { const url = "http://example.com/a"; return url; }';
      const withUrlB = 'function f() { const url = "http://example.com/b"; return url; }';
      const range = { start: { line: 1, column: 0 }, end: { line: 1, column: withUrlA.length } };

      const keyA = deriveStructuralUnitKey('f', range, withUrlA);
      const keyB = deriveStructuralUnitKey(
        'f',
        { start: { line: 1, column: 0 }, end: { line: 1, column: withUrlB.length } },
        withUrlB,
      );

      expect(keyA).not.toBe(keyB);
    });

    it('does not collide two functions that differ only in a block-comment-shaped sequence inside a string literal', () => {
      // Regression test (Greptile PR feedback): a regex block-comment strip
      // (`\/\*[\s\S]*?\*\//`) matches a literal `/* ... */` SEQUENCE
      // wherever it appears, including inside a string literal — so two
      // functions differing only in the text between `/*` and `*/` inside
      // a string would hash identically. The scanner tokenizes the string
      // literal as one atomic token; its contents are never scanned for
      // comment syntax.
      const withMarkerA = 'function f() { const s = "prefix /* marker-A */ suffix"; return s; }';
      const withMarkerB = 'function f() { const s = "prefix /* marker-B */ suffix"; return s; }';
      const rangeA = {
        start: { line: 1, column: 0 },
        end: { line: 1, column: withMarkerA.length },
      };
      const rangeB = {
        start: { line: 1, column: 0 },
        end: { line: 1, column: withMarkerB.length },
      };

      const keyA = deriveStructuralUnitKey('f', rangeA, withMarkerA);
      const keyB = deriveStructuralUnitKey('f', rangeB, withMarkerB);

      expect(keyA).not.toBe(keyB);
    });

    it('does not collide two functions that differ only after a whitespace-prefixed "//" inside a string literal', () => {
      // Regression test (Greptile PR feedback): the earlier anchored regex
      // (`(^|\s)\/\/[^\n]*`) still stripped a "//" preceded by whitespace
      // even when that whitespace+// sequence occurs INSIDE a string
      // literal (e.g. "value  // A") — anchoring on the surrounding
      // character can't distinguish "inside a string" from "inside real
      // code" without literal-awareness. The scanner's StringLiteral token
      // covers the whole quoted text, so this can no longer collide.
      const withSuffixA = 'function f() { const s = "value  // A"; return s; }';
      const withSuffixB = 'function f() { const s = "value  // B"; return s; }';
      const rangeA = {
        start: { line: 1, column: 0 },
        end: { line: 1, column: withSuffixA.length },
      };
      const rangeB = {
        start: { line: 1, column: 0 },
        end: { line: 1, column: withSuffixB.length },
      };

      const keyA = deriveStructuralUnitKey('f', rangeA, withSuffixA);
      const keyB = deriveStructuralUnitKey('f', rangeB, withSuffixB);

      expect(keyA).not.toBe(keyB);
    });

    it('returns null when the range does not fit the supplied source text', () => {
      const source = 'function add() {}';
      const key = deriveStructuralUnitKey(
        'add',
        { start: { line: 5, column: 0 }, end: { line: 8, column: 1 } },
        source,
      );
      expect(key).toBeNull();
    });
  });

  describe('isStructuralUnitKey', () => {
    it('returns true for a structural key', () => {
      expect(isStructuralUnitKey('add#abcdef0123456789')).toBe(true);
    });

    it('returns false for a legacy name@line key', () => {
      expect(isStructuralUnitKey('add@42')).toBe(false);
    });
  });
});
