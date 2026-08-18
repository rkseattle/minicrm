#!/usr/bin/env tsx
/**
 * gen-conflict-group-configs.ts
 *
 * Generates one Playwright config per conflict-free group of @serial spec
 * files (playwright.serial-group.<N>.config.ts), replacing the blanket
 * "every @serial file runs single-threaded in one invocation" model.
 *
 * Playwright's own scheduler has no mechanism to pin specific files to
 * specific workers or guarantee two named files never run concurrently
 * within one invocation (file-to-worker assignment is an internal,
 * unconstrained greedy scheduler — see conflict-graph.ts's module doc for
 * the underlying rationale). The only reliable way to guarantee two
 * CONFLICTING files never overlap in wall-clock time is process-level
 * separation: run each conflict-free group as its own sequential
 * `playwright test` invocation. Within a group, multiple workers ARE safe
 * for INTER-file conflicts (by construction, no two files in a
 * conflict-free group touch the same resource), so groups run their own
 * files with up to MAX_GROUP_WORKERS workers instead of the previous
 * blanket --workers=1.
 *
 * INTRA-file races are a separate hazard this script also guards against:
 * playwright.config.ts sets `fullyParallel: true`, which means Playwright
 * CAN schedule two tests from the SAME file onto two different concurrent
 * workers (contrary to the single-worker-per-file default). A file whose
 * registry entry is file-wide (no `testTitleContains` — i.e. potentially
 * ALL of that file's tests share one resource, like visibility.spec.ts's 9
 * tests all mutating visibility_policy) is therefore at risk of racing
 * itself under workers > 1 unless it independently self-serializes (e.g.
 * navigation.spec.ts wraps its layout-mutating tests in
 * `test.describe.serial`). Since not every file-wide-entry file does that,
 * this script partitions file-wide-entry files SEPARATELY from
 * testTitleContains-scoped ones and caps only the file-wide groups at
 * workers=1 — see buildGroupPlan below. A group is only eligible for
 * MAX_GROUP_WORKERS when every file in it is scoped by testTitleContains
 * (proving the shared resource touches at most the identified subset of tests,
 * not the whole file).
 *
 * NOTE: this paragraph previously said a file-wide entry forced workers=1 for
 * the WHOLE group. That has not been true since the separate-partition change
 * documented on buildGroupPlan, whose whole point is to stop one file-wide file
 * dragging an otherwise-safe group down. Corrected in, where the
 * stale wording caused a plan to predict the wrong CI cost.
 *
 * Falls back to a single-file, single-worker group (today's known-good
 * "run with --workers=1" behavior, scoped to just that file) for any file
 * with no resource-registry entry — the escape-hatch requirement that
 * files without resource-touch history keep working safely.
 *
 * IMPORTANT — each generated config's `testMatch` selects whole spec FILES,
 * some of which mix @serial and plain @functional tests (e.g.
 * deal-health-check.spec.ts). The CI step invoking a group's config MUST
 * still pass the same `--grep "@functional.*@serial|@serial.*@functional"`
 * filter used today, so only the @serial-tagged tests within each selected
 * file actually run — this script only decides which FILES are safe to
 * co-schedule, not which tests within them.
 *
 * Usage (from repo root):
 *   npx tsx qa/e2e/scripts/gen-conflict-group-configs.ts
 *
 *
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  buildConflictGraph,
  partitionIntoConflictFreeGroups,
} from '../framework/reporting/conflict-graph.js';
import { findTaggedTestTitles } from '../framework/reporting/timing-utils.js';
import {
  RESOURCE_REGISTRY,
  collapseRegistryToFileTouches,
} from '../apps/minicrm/resource-registry.js';

const E2E_DIR = path.resolve(process.cwd(), 'qa/e2e');

/** Conservative cap on workers within a single conflict-free group — keeps
 *  co-scheduling within the earlier lesson's spirit (avoid reintroducing
 *  shared-service contention against Postgres/MinIO/Mailhog) even though a
 *  conflict-free group has no data-race risk by construction.
 *  Deliberately independent of the capacity-probe's computed worker count
 * — the capacity-probe's empirical findings (see
 *  docs/dev/e2e-performance.md's "Scope of these findings") only cover the
 *  non-serial functional suite; the @serial population's parallelism ceiling
 *  has not been separately measured, so this stays a conservative constant
 *  rather than consuming capacity-probe's output. */
const MAX_GROUP_WORKERS = 2;

/** Finds every *.spec.ts file under functional/ that has at least one test
 *  actually tagged @serial (via findTaggedTestTitles — a title-string scan,
 *  not a raw content.includes() check) — the ground-truth population this
 *  script must fully cover (registry entries plus any not-yet-registered
 *  file, which falls back to its own single-file group for safety).
 *  A plain substring scan over full file content would misfire on files
 *  where "@serial" appears only in a comment explaining why the file does
 *  NOT need the tag (e.g. insights/coaching.spec.ts) — such a file has zero
 *  actual @serial tests, so a generated group for it produces an empty
 *  testMatch that Playwright rejects with "No tests found". */
function discoverSerialFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...discoverSerialFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
      if (findTaggedTestTitles(fullPath, '@serial').length > 0) {
        results.push(path.relative(process.cwd(), fullPath));
      }
    }
  }
  return results;
}

export interface ConflictGroupPlan {
  groupIndex: number;
  files: string[];
  workers: number;
}

/**
 * A file is at risk of racing its OWN tests under workers > 1 (see module
 * doc's fullyParallel note) unless every registry entry for that file is
 * scoped by `testTitleContains` — proving the shared resource is touched by
 * only the identified subset of tests, not potentially the whole file.
 */
function hasFileWideRegistryEntry(file: string): boolean {
  return RESOURCE_REGISTRY.some((entry) => entry.file === file && !entry.testTitleContains);
}

/**
 * Builds the group plan: conflict-free groups from the registry, plus a
 * single-file group (workers=1) for every @serial file the registry has no
 * entry for — the escape hatch for tests without resource-touch history.
 *
 * File-wide-entry files (risk of racing their own tests under workers > 1 —
 * see hasFileWideRegistryEntry) are partitioned SEPARATELY from
 * testTitleContains-scoped files, each getting their own conflict-free
 * groups capped at workers=1. This keeps the 1-worker cap scoped to only
 * the files that actually need it, instead of one file-wide file dragging
 * an entire otherwise-safe group down to workers=1.
 */
export function buildGroupPlan(serialFiles: readonly string[]): ConflictGroupPlan[] {
  const touches = collapseRegistryToFileTouches();
  const graph = buildConflictGraph(touches);
  const registeredFiles = new Set(touches.map((t) => t.file));

  const registered = serialFiles.filter((f) => registeredFiles.has(f));
  const unregistered = serialFiles.filter((f) => !registeredFiles.has(f));

  const fileWideFiles = registered.filter(hasFileWideRegistryEntry);
  const titleScopedFiles = registered.filter((f) => !hasFileWideRegistryEntry(f));

  const titleScopedGroups = partitionIntoConflictFreeGroups(graph, titleScopedFiles).filter(
    (files) => files.length > 0,
  );
  const fileWideGroups = partitionIntoConflictFreeGroups(graph, fileWideFiles).filter(
    (files) => files.length > 0,
  );

  const plans: ConflictGroupPlan[] = [
    ...titleScopedGroups.map((files) => ({ files, maxWorkers: MAX_GROUP_WORKERS })),
    ...fileWideGroups.map((files) => ({ files, maxWorkers: 1 })),
  ].map(({ files, maxWorkers }, i) => ({
    groupIndex: i,
    files,
    workers: Math.max(1, Math.min(maxWorkers, files.length)),
  }));

  // Escape hatch: files with no resource-registry entry each get their own
  // single-file, single-worker group — identical safety to the pre
  // blanket mechanism, since we have no data to prove they're conflict-free
  // with anything.
  for (const file of unregistered) {
    plans.push({ groupIndex: plans.length, files: [file], workers: 1 });
  }

  return plans;
}

function generateGroupConfig(plan: ConflictGroupPlan): string {
  const testMatchEntries = plan.files
    .map((f) => `  '${path.resolve(process.cwd(), f).replace(/\\/g, '/')}'`)
    .join(',\n');

  return (
    `// Auto-generated by gen-conflict-group-configs.ts — DO NOT EDIT\n` +
    `// Conflict-free group ${plan.groupIndex} (${plan.files.length} file(s), ${plan.workers} worker(s))\n` +
    `// Regenerate with: npx tsx qa/e2e/scripts/gen-conflict-group-configs.ts\n` +
    `\n` +
    `import { defineConfig } from '@playwright/test';\n` +
    `import baseConfig from './playwright.config.js';\n` +
    `\n` +
    `export default defineConfig({\n` +
    `  ...baseConfig,\n` +
    `  testMatch: [\n` +
    `${testMatchEntries}\n` +
    `  ],\n` +
    `});\n`
  );
}

/** Filename of the manifest listing each generated group's config path and
 *  worker count, so CI can read worker counts directly instead of parsing
 *  generated config file contents. */
export const MANIFEST_FILENAME = 'playwright.serial-groups.json';

export interface GroupManifestEntry {
  groupIndex: number;
  configPath: string;
  fileCount: number;
  workers: number;
}

function main(): void {
  const functionalDir = path.join(E2E_DIR, 'tests/apps/minicrm/functional');
  const serialFiles = discoverSerialFiles(functionalDir);

  if (serialFiles.length === 0) {
    process.stderr.write('[gen-conflict-group-configs] No @serial spec files found.\n');
    return;
  }

  const plans = buildGroupPlan(serialFiles);
  const manifest: GroupManifestEntry[] = [];

  for (const plan of plans) {
    const configFilename = `playwright.serial-group.${plan.groupIndex}.config.ts`;
    const outputPath = path.join(E2E_DIR, configFilename);
    fs.writeFileSync(outputPath, generateGroupConfig(plan), 'utf-8');
    manifest.push({
      groupIndex: plan.groupIndex,
      configPath: `qa/e2e/${configFilename}`,
      fileCount: plan.files.length,
      workers: plan.workers,
    });
  }

  fs.writeFileSync(
    path.join(E2E_DIR, MANIFEST_FILENAME),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  );

  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
  process.stderr.write(
    `[gen-conflict-group-configs] Wrote ${plans.length} group config(s) covering ${serialFiles.length} @serial file(s).\n`,
  );
}

// Guards against running main()'s filesystem side effects when this module is
// imported (e.g. by gen-conflict-group-configs.spec.ts importing buildGroupPlan)
// rather than executed directly via `tsx`/`node`.
if (require.main === module) {
  main();
}
