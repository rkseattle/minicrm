/**
 * Conflict-graph builder — pure graph algorithm operating on abstract
 * resource-touch data, with no application-domain strings, so
 * framework-purity checks pass.
 *
 * A conflict graph models which spec FILES cannot safely run concurrently
 * with each other, derived from what shared resources they read/write —
 * replacing the blanket "every @serial test excludes every other @serial
 * test" mechanism with edges only between files that actually conflict.
 *
 * Conflict rule (file-granularity, matching how LPT bin-packing assigns
 * whole files to shards): an edge exists between file A and file B when
 * A's write-set intersects B's write-set, OR A's write-set intersects B's
 * read-set (in either direction). Two files that only READ the same
 * resource do not conflict — concurrent reads are safe.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface FileResourceTouch {
  file: string;
  reads: ReadonlySet<string>;
  writes: ReadonlySet<string>;
}

/** Adjacency-list conflict graph: file -> set of files it conflicts with. */
export type ConflictGraph = ReadonlyMap<string, ReadonlySet<string>>;

// ── Graph construction ────────────────────────────────────────────────────────

function setsIntersect(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of smaller) {
    if (larger.has(item)) return true;
  }
  return false;
}

function filesConflict(a: FileResourceTouch, b: FileResourceTouch): boolean {
  if (setsIntersect(a.writes, b.writes)) return true;
  if (setsIntersect(a.writes, b.reads)) return true;
  if (setsIntersect(b.writes, a.reads)) return true;
  return false;
}

/**
 * Builds a conflict graph from per-file resource touches. Files with no
 * reads and no writes are included as isolated nodes (no edges) so callers
 * can distinguish "known, conflict-free" from "not in the input at all".
 *
 * O(n^2) in the number of distinct files — the current @serial population
 * is in the tens of files, not thousands, so this is not a bottleneck; if
 * the tracked population grows by orders of magnitude, an inverted
 * resource->files index would avoid the full pairwise scan.
 */
export function buildConflictGraph(touches: readonly FileResourceTouch[]): ConflictGraph {
  const graph = new Map<string, Set<string>>();
  for (const touch of touches) {
    graph.set(touch.file, new Set());
  }

  for (let i = 0; i < touches.length; i++) {
    for (let j = i + 1; j < touches.length; j++) {
      const a = touches[i] as FileResourceTouch;
      const b = touches[j] as FileResourceTouch;
      if (filesConflict(a, b)) {
        graph.get(a.file)?.add(b.file);
        graph.get(b.file)?.add(a.file);
      }
    }
  }

  return graph;
}

/** Returns the set of files that conflict with `file`, or an empty set if
 *  `file` has no entry in the graph (untracked — treated as conflict-free). */
export function conflictsOf(graph: ConflictGraph, file: string): ReadonlySet<string> {
  return graph.get(file) ?? new Set();
}

/**
 * Partitions files into conflict-free groups using greedy graph coloring:
 * each group is an independent set (no two files in the same group
 * conflict), so all files within a group may run concurrently with each
 * other. Files absent from the graph (no resource touches) are distributed
 * across groups round-robin, since they have no constraints.
 *
 * This does not attempt to minimise group count optimally (graph coloring
 * is NP-hard in general) — a greedy first-fit is sufficient here since the
 * conflict graph is sparse (most files touch disjoint resources).
 */
export function partitionIntoConflictFreeGroups(
  graph: ConflictGraph,
  files: readonly string[],
): string[][] {
  const groups: Set<string>[] = [];

  const conflicted = files.filter((f) => (graph.get(f)?.size ?? 0) > 0);
  const unconflicted = files.filter((f) => (graph.get(f)?.size ?? 0) === 0);

  for (const file of conflicted) {
    const fileConflicts = conflictsOf(graph, file);
    let placed = false;
    for (const group of groups) {
      let conflictsWithGroup = false;
      for (const member of group) {
        if (fileConflicts.has(member)) {
          conflictsWithGroup = true;
          break;
        }
      }
      if (!conflictsWithGroup) {
        group.add(file);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push(new Set([file]));
    }
  }

  if (groups.length === 0) groups.push(new Set());

  unconflicted.forEach((file, i) => {
    (groups[i % groups.length] as Set<string>).add(file);
  });

  return groups.map((g) => [...g]);
}
