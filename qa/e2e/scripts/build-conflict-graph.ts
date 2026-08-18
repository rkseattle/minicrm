#!/usr/bin/env tsx
/**
 * build-conflict-graph.ts
 *
 * Builds a conflict graph from the resource registry and prints it as JSON
 * (file -> array of conflicting files) for the LPT shard-assignment scripts
 * to consume, replacing the blanket @serial grep-invert with conflict-aware
 * grouping.
 *
 * Resource touches are collapsed to file granularity here — entries scoped
 * to a specific test via `testTitleContains` are unioned into their file's
 * overall read/write set, since LPT bin-packing assigns whole files to
 * shards, not individual tests.
 *
 * Usage (from repo root):
 *   npx tsx qa/e2e/scripts/build-conflict-graph.ts
 *
 *
 */

import {
  buildConflictGraph,
  partitionIntoConflictFreeGroups,
} from '../framework/reporting/conflict-graph.js';
import { discoverSpecFiles } from '../framework/reporting/timing-utils.js';
import { collapseRegistryToFileTouches } from '../apps/minicrm/resource-registry.js';
import path from 'node:path';

const E2E_DIR = path.resolve(process.cwd(), 'qa/e2e');
const FUNCTIONAL_TESTS_DIR = path.join(E2E_DIR, 'tests/apps/minicrm/functional');

function main(): void {
  const allSpecFiles = discoverSpecFiles(FUNCTIONAL_TESTS_DIR);
  const fileTouches = collapseRegistryToFileTouches();
  const graph = buildConflictGraph(fileTouches);
  const groups = partitionIntoConflictFreeGroups(graph, allSpecFiles);

  const graphJson: Record<string, string[]> = {};
  for (const [file, conflicts] of graph) {
    graphJson[file] = [...conflicts].sort();
  }

  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        trackedFileCount: fileTouches.length,
        totalSpecFileCount: allSpecFiles.length,
        conflictGroups: groups,
        graph: graphJson,
      },
      null,
      2,
    ) + '\n',
  );
}

// Guards against running main()'s output/logging side effects when this
// module is imported rather than executed directly via `tsx`/`node` — see
// gen-conflict-group-configs.ts for the same pattern.
if (require.main === module) {
  main();
}
