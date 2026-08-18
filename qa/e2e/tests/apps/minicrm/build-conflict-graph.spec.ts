/**
 * Integration-style tests for the conflict-graph pipeline as wired for
 * MiniCRM: RESOURCE_REGISTRY -> buildConflictGraph -> partition, verifying
 * real registry data produces a sane graph (no file conflicts with itself,
 * every file the registry declares appears in the graph, known conflicting
 * pairs land in different groups).
 *
 *
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  buildConflictGraph,
  partitionIntoConflictFreeGroups,
} from '@framework/reporting/conflict-graph.js';
import {
  RESOURCE_REGISTRY,
  collapseRegistryToFileTouches,
  ENSURE_SYSTEM_DEFAULTS_KEYS,
} from '@apps/minicrm/resource-registry.js';

test.describe('conflict-graph pipeline with real resource-registry data', () => {
  test('every file the registry declares appears in the graph', () => {
    const touches = collapseRegistryToFileTouches();
    const graph = buildConflictGraph(touches);
    const registryFiles = new Set(RESOURCE_REGISTRY.map((e) => e.file));
    for (const file of registryFiles) {
      expect(graph.has(file)).toBe(true);
    }
  });

  test('no file conflicts with itself', () => {
    const touches = collapseRegistryToFileTouches();
    const graph = buildConflictGraph(touches);
    for (const [file, conflicts] of graph) {
      expect(conflicts.has(file)).toBe(false);
    }
  });

  test('all 9 ai_configuration_enabled files mutually conflict with each other', () => {
    const touches = collapseRegistryToFileTouches();
    const graph = buildConflictGraph(touches);
    const aiConfigFiles = RESOURCE_REGISTRY.filter((e) =>
      e.writes.includes('settings.ai_configuration_enabled'),
    ).map((e) => e.file);
    // Sanity: we expect a non-trivial cluster here (multiple AI files share the toggle).
    expect(aiConfigFiles.length).toBeGreaterThan(1);
    for (const a of aiConfigFiles) {
      for (const b of aiConfigFiles) {
        if (a === b) continue;
        expect(graph.get(a)?.has(b)).toBe(true);
      }
    }
  });

  test('ai-usage-dashboard.spec.ts (cost-rates) does NOT conflict with other ai_configuration files', () => {
    const touches = collapseRegistryToFileTouches();
    const graph = buildConflictGraph(touches);
    const costRatesFile = 'qa/e2e/tests/apps/minicrm/functional/ai/ai-usage-dashboard.spec.ts';
    const aiSpec = 'qa/e2e/tests/apps/minicrm/functional/ai/ai.spec.ts';
    // These touch disjoint resources (ai_cost_rates vs ai_configuration_enabled) —
    // the registry correction from the audit means they should NOT conflict.
    expect(graph.get(costRatesFile)?.has(aiSpec)).toBe(false);
  });

  test('navigation.spec.ts and accessibility.spec.ts conflict (both touch settings.nav_layout)', () => {
    const touches = collapseRegistryToFileTouches();
    const graph = buildConflictGraph(touches);
    const nav = 'qa/e2e/tests/apps/minicrm/functional/navigation/navigation.spec.ts';
    const a11y = 'qa/e2e/tests/apps/minicrm/functional/accessibility/accessibility.spec.ts';
    expect(graph.get(nav)?.has(a11y)).toBe(true);
  });

  test('feature-flags.spec.ts and visibility.spec.ts do not conflict (disjoint resources)', () => {
    // A genuinely disjoint pair: feature flags and custom roles on one side, the
    // visibility policy on the other, with neither calling ensureSystemDefaults.
    // branding/visibility used to be this example and no longer is — branding
    // calls ensureSystemDefaults, which resets the visibility row (see the
    // composite key). That edge is correct, so the example moved rather than the
    // assertion being weakened.
    const touches = collapseRegistryToFileTouches();
    const graph = buildConflictGraph(touches);
    const featureFlags = 'qa/e2e/tests/apps/minicrm/functional/feature-flags/feature-flags.spec.ts';
    const visibility = 'qa/e2e/tests/apps/minicrm/functional/visibility/visibility.spec.ts';
    expect(graph.get(featureFlags)?.has(visibility)).toBe(false);
  });

  test('an ensureSystemDefaults caller conflicts with a file touching ANY row it resets', () => {
    // The composite key's whole point. branding.spec.ts calls
    // ensureSystemDefaults, which PUTs the visibility policy back to 'org';
    // visibility.spec.ts owns that row. Modeling only pipeline_stages_reviewed
    // left this edge undrawn and put two such pairs in workers=2 groups with a
    // live cross-file race.
    const touches = collapseRegistryToFileTouches();
    const graph = buildConflictGraph(touches);
    const branding = 'qa/e2e/tests/apps/minicrm/functional/branding/branding.spec.ts';
    const visibility = 'qa/e2e/tests/apps/minicrm/functional/visibility/visibility.spec.ts';
    expect(graph.get(branding)?.has(visibility)).toBe(true);
  });

  test('branding.spec.ts and sso.spec.ts DO conflict (both reset pipeline_stages_reviewed)', () => {
    // This pair was the "disjoint resources" case until. Both files
    // call ensureSystemDefaults() in their hooks, which DELETEs the
    // pipeline_stages_reviewed system_settings row — so they always did conflict
    // and the registry simply did not model the row. Kept as a regression pin:
    // it fails if that key is ever dropped from either entry, which is the edit
    // that would silently reopen the race with onboarding.spec.ts.
    const touches = collapseRegistryToFileTouches();
    const graph = buildConflictGraph(touches);
    const branding = 'qa/e2e/tests/apps/minicrm/functional/branding/branding.spec.ts';
    const sso = 'qa/e2e/tests/apps/minicrm/functional/sso/sso.spec.ts';
    expect(graph.get(branding)?.has(sso)).toBe(true);
  });

  test('collapseRegistryToFileTouches unions multiple entries for one file', () => {
    // reports-nav.spec.ts carries two entries: one title-scoped to a single test
    // (settings.nav_layout) and one file-wide (settings.pipeline_stages_reviewed,
    // from its file-level ensureSystemDefaults hooks). The graph reasons about
    // whole files, so both keys must survive the collapse — if the union dropped
    // either, the file would be co-scheduled with something it races.
    const touches = collapseRegistryToFileTouches();
    const reportsNav = touches.find(
      (t) => t.file === 'qa/e2e/tests/apps/minicrm/functional/reports/reports-nav.spec.ts',
    );
    expect(reportsNav, 'reports-nav.spec.ts missing from collapsed touches').toBeDefined();
    const writes = [...(reportsNav?.writes ?? [])];
    // Its own title-scoped key survives the union...
    expect(writes).toContain('settings.nav_layout');
    // ...and so does every row the composite key expands to. Both halves matter:
    // dropping either would co-schedule the file with something it races.
    for (const key of ENSURE_SYSTEM_DEFAULTS_KEYS) {
      expect(writes, `composite key did not expand to ${key}`).toContain(key);
    }
    // The composite itself must NOT survive — it is a stand-in, and leaving it
    // in would make it conflict only with other composites.
    expect(writes).not.toContain('settings.ensure_system_defaults');
  });

  test('partitioning never places two conflicting registry files in the same group', () => {
    const touches = collapseRegistryToFileTouches();
    const graph = buildConflictGraph(touches);
    const files = [...graph.keys()];
    const groups = partitionIntoConflictFreeGroups(graph, files);
    for (const group of groups) {
      for (const a of group) {
        for (const b of group) {
          if (a === b) continue;
          expect(graph.get(a)?.has(b)).toBe(false);
        }
      }
    }
  });
});
