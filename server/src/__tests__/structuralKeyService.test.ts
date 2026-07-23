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
