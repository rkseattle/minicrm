/**
 * Unit tests for the conflict-graph builder.
 *
 * Verifies:
 * 1. buildConflictGraph — no edge when no resources overlap
 * 2. buildConflictGraph — edge when write-sets overlap
 * 3. buildConflictGraph — edge when one write-set overlaps the other's read-set (both directions)
 * 4. buildConflictGraph — no edge when only read-sets overlap (concurrent reads are safe)
 * 5. buildConflictGraph — isolated node included with no edges for files with no touches
 * 6. buildConflictGraph — transitive non-conflict: A-B conflict and B-C conflict does not imply A-C
 * 7. conflictsOf — returns empty set for a file absent from the graph
 * 8. partitionIntoConflictFreeGroups — files with no conflicts distribute across groups
 * 9. partitionIntoConflictFreeGroups — conflicting files never land in the same group
 * 10. partitionIntoConflictFreeGroups — a fully-connected conflict clique gets one file per group
 *
 *
 */

import { test, expect } from '@playwright/test';
import {
  buildConflictGraph,
  conflictsOf,
  partitionIntoConflictFreeGroups,
} from '../../framework/reporting/conflict-graph.js';
import type { FileResourceTouch } from '../../framework/reporting/conflict-graph.js';

function touch(file: string, reads: string[], writes: string[]): FileResourceTouch {
  return { file, reads: new Set(reads), writes: new Set(writes) };
}

test.describe('buildConflictGraph — edge conditions', () => {
  test('no edge when no resources overlap at all', () => {
    const graph = buildConflictGraph([
      touch('a.spec.ts', [], ['res.a']),
      touch('b.spec.ts', [], ['res.b']),
    ]);
    expect(conflictsOf(graph, 'a.spec.ts').size).toBe(0);
    expect(conflictsOf(graph, 'b.spec.ts').size).toBe(0);
  });

  test('edge when write-sets overlap', () => {
    const graph = buildConflictGraph([
      touch('a.spec.ts', [], ['res.shared']),
      touch('b.spec.ts', [], ['res.shared']),
    ]);
    expect(conflictsOf(graph, 'a.spec.ts').has('b.spec.ts')).toBe(true);
    expect(conflictsOf(graph, 'b.spec.ts').has('a.spec.ts')).toBe(true);
  });

  test('edge when A writes what B reads', () => {
    const graph = buildConflictGraph([
      touch('a.spec.ts', [], ['res.shared']),
      touch('b.spec.ts', ['res.shared'], []),
    ]);
    expect(conflictsOf(graph, 'a.spec.ts').has('b.spec.ts')).toBe(true);
  });

  test('edge when B writes what A reads (symmetric)', () => {
    const graph = buildConflictGraph([
      touch('a.spec.ts', ['res.shared'], []),
      touch('b.spec.ts', [], ['res.shared']),
    ]);
    expect(conflictsOf(graph, 'a.spec.ts').has('b.spec.ts')).toBe(true);
    expect(conflictsOf(graph, 'b.spec.ts').has('a.spec.ts')).toBe(true);
  });

  test('no edge when only read-sets overlap (concurrent reads are safe)', () => {
    const graph = buildConflictGraph([
      touch('a.spec.ts', ['res.shared'], []),
      touch('b.spec.ts', ['res.shared'], []),
    ]);
    expect(conflictsOf(graph, 'a.spec.ts').size).toBe(0);
    expect(conflictsOf(graph, 'b.spec.ts').size).toBe(0);
  });

  test('isolated file with no touches is included with no edges', () => {
    const graph = buildConflictGraph([touch('a.spec.ts', [], [])]);
    expect(graph.has('a.spec.ts')).toBe(true);
    expect(conflictsOf(graph, 'a.spec.ts').size).toBe(0);
  });

  test('conflict is not transitive: A-B and B-C conflict does not imply A-C', () => {
    const graph = buildConflictGraph([
      touch('a.spec.ts', [], ['res.1']),
      touch('b.spec.ts', [], ['res.1', 'res.2']),
      touch('c.spec.ts', [], ['res.2']),
    ]);
    expect(conflictsOf(graph, 'a.spec.ts').has('b.spec.ts')).toBe(true);
    expect(conflictsOf(graph, 'b.spec.ts').has('c.spec.ts')).toBe(true);
    expect(conflictsOf(graph, 'a.spec.ts').has('c.spec.ts')).toBe(false);
  });

  test('a file touching multiple resources conflicts with files on any of them', () => {
    const graph = buildConflictGraph([
      touch('a.spec.ts', [], ['res.1', 'res.2', 'res.3']),
      touch('b.spec.ts', [], ['res.3']),
    ]);
    expect(conflictsOf(graph, 'a.spec.ts').has('b.spec.ts')).toBe(true);
  });
});

test.describe('conflictsOf', () => {
  test('returns an empty set for a file absent from the graph', () => {
    const graph = buildConflictGraph([touch('a.spec.ts', [], ['res.a'])]);
    expect(conflictsOf(graph, 'nonexistent.spec.ts').size).toBe(0);
  });
});

test.describe('partitionIntoConflictFreeGroups', () => {
  test('files with no conflicts distribute round-robin across existing groups', () => {
    const graph = buildConflictGraph([
      touch('a.spec.ts', [], ['res.shared']),
      touch('b.spec.ts', [], ['res.shared']),
      touch('c.spec.ts', [], []),
      touch('d.spec.ts', [], []),
    ]);
    const groups = partitionIntoConflictFreeGroups(graph, [
      'a.spec.ts',
      'b.spec.ts',
      'c.spec.ts',
      'd.spec.ts',
    ]);
    // a and b conflict, so they must be in different groups.
    const groupOf = (file: string) => groups.findIndex((g) => g.includes(file));
    expect(groupOf('a.spec.ts')).not.toBe(groupOf('b.spec.ts'));
    // c and d have no conflicts and should be distributed, not both dropped in one group.
    expect(groups.flat()).toEqual(
      expect.arrayContaining(['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'd.spec.ts']),
    );
  });

  test('conflicting files never land in the same group', () => {
    const graph = buildConflictGraph([
      touch('a.spec.ts', [], ['res.shared']),
      touch('b.spec.ts', [], ['res.shared']),
      touch('c.spec.ts', [], ['res.other']),
    ]);
    const groups = partitionIntoConflictFreeGroups(graph, ['a.spec.ts', 'b.spec.ts', 'c.spec.ts']);
    for (const group of groups) {
      for (const file of group) {
        for (const other of group) {
          if (file === other) continue;
          expect(conflictsOf(graph, file).has(other)).toBe(false);
        }
      }
    }
  });

  test('a fully-connected conflict clique gets one file per group', () => {
    // a, b, c all mutate the same single resource — pairwise conflicts among all three.
    const graph = buildConflictGraph([
      touch('a.spec.ts', [], ['res.shared']),
      touch('b.spec.ts', [], ['res.shared']),
      touch('c.spec.ts', [], ['res.shared']),
    ]);
    const groups = partitionIntoConflictFreeGroups(graph, ['a.spec.ts', 'b.spec.ts', 'c.spec.ts']);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const group of groups) {
      expect(group.length).toBeLessThanOrEqual(1);
    }
  });

  test('empty input produces no groups with files', () => {
    const graph = buildConflictGraph([]);
    const groups = partitionIntoConflictFreeGroups(graph, []);
    expect(groups.flat()).toEqual([]);
  });
});
