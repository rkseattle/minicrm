/**
 * Integration-style tests for the conflict-graph pipeline as wired for
 * MiniCRM: RESOURCE_REGISTRY -> buildConflictGraph -> partition, verifying
 * real registry data produces a sane graph (no file conflicts with itself,
 * every file the registry declares appears in the graph, known conflicting
 * pairs land in different groups).
 *
 * MINCRM-661
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  buildConflictGraph,
  partitionIntoConflictFreeGroups,
} from '@framework/reporting/conflict-graph.js';
import {
  RESOURCE_REGISTRY,
  collapseRegistryToFileTouches,
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

  test('branding.spec.ts and sso.spec.ts do not conflict (disjoint resources)', () => {
    const touches = collapseRegistryToFileTouches();
    const graph = buildConflictGraph(touches);
    const branding = 'qa/e2e/tests/apps/minicrm/functional/branding/branding.spec.ts';
    const sso = 'qa/e2e/tests/apps/minicrm/functional/sso/sso.spec.ts';
    expect(graph.get(branding)?.has(sso)).toBe(false);
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
