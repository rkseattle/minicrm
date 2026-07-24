/**
 * Unit tests for buildGroupPlan (gen-conflict-group-configs.ts), verifying
 * the group-planning logic that decides which @serial spec files can safely
 * be co-scheduled within one conflict-free group, and which fall back to
 * their own isolated single-file group when unregistered.
 *
 * MINCRM-661
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { buildGroupPlan } from '../../../scripts/gen-conflict-group-configs.js';
import { RESOURCE_REGISTRY } from '@apps/minicrm/resource-registry.js';

test.describe('buildGroupPlan — coverage', () => {
  test('every input file appears in exactly one group', () => {
    const registryFiles = [...new Set(RESOURCE_REGISTRY.map((e) => e.file))];
    const unregisteredFile = 'qa/e2e/tests/apps/minicrm/functional/made-up/made-up.spec.ts';
    const input = [...registryFiles, unregisteredFile];

    const plans = buildGroupPlan(input);
    const allFilesInPlans = plans.flatMap((p) => p.files);

    expect(allFilesInPlans.sort()).toEqual([...input].sort());
    // No duplicates across groups.
    expect(new Set(allFilesInPlans).size).toBe(allFilesInPlans.length);
  });

  test('an unregistered file gets its own single-file, single-worker group', () => {
    const unregisteredFile = 'qa/e2e/tests/apps/minicrm/functional/made-up/made-up.spec.ts';
    const plans = buildGroupPlan([unregisteredFile]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.files).toEqual([unregisteredFile]);
    expect(plans[0]?.workers).toBe(1);
  });

  test('registered conflicting files never land in the same group', () => {
    const navFile = 'qa/e2e/tests/apps/minicrm/functional/navigation/navigation.spec.ts';
    const a11yFile = 'qa/e2e/tests/apps/minicrm/functional/accessibility/accessibility.spec.ts';
    const plans = buildGroupPlan([navFile, a11yFile]);
    const groupOf = (file: string) => plans.findIndex((p) => p.files.includes(file));
    expect(groupOf(navFile)).not.toBe(groupOf(a11yFile));
  });

  test('registered non-conflicting files can land in the same group', () => {
    const brandingFile = 'qa/e2e/tests/apps/minicrm/functional/branding/branding.spec.ts';
    const ssoFile = 'qa/e2e/tests/apps/minicrm/functional/sso/sso.spec.ts';
    const plans = buildGroupPlan([brandingFile, ssoFile]);
    // Not asserting they MUST be co-located (partitioning is a greedy
    // heuristic), only that co-location is at least possible / no crash,
    // and each still appears exactly once.
    const allFiles = plans.flatMap((p) => p.files);
    expect(allFiles).toContain(brandingFile);
    expect(allFiles).toContain(ssoFile);
  });

  test('every group has at least 1 worker and never exceeds the file count', () => {
    const registryFiles = [...new Set(RESOURCE_REGISTRY.map((e) => e.file))];
    const plans = buildGroupPlan(registryFiles);
    for (const plan of plans) {
      expect(plan.workers).toBeGreaterThanOrEqual(1);
      expect(plan.workers).toBeLessThanOrEqual(plan.files.length);
    }
  });

  test('every group has a unique groupIndex', () => {
    const registryFiles = [...new Set(RESOURCE_REGISTRY.map((e) => e.file))];
    const plans = buildGroupPlan(registryFiles);
    const indices = plans.map((p) => p.groupIndex);
    expect(new Set(indices).size).toBe(indices.length);
  });

  test('empty input produces no groups', () => {
    expect(buildGroupPlan([])).toEqual([]);
  });

  test('all 9 ai_configuration_enabled files land in 9 distinct groups (mutual clique)', () => {
    const aiConfigFiles = RESOURCE_REGISTRY.filter((e) =>
      e.writes.includes('settings.ai_configuration_enabled'),
    ).map((e) => e.file);
    const plans = buildGroupPlan(aiConfigFiles);
    expect(plans.length).toBe(aiConfigFiles.length);
    for (const plan of plans) {
      expect(plan.files).toHaveLength(1);
    }
  });
});

test.describe('buildGroupPlan — intra-file self-conflict safety (fullyParallel: true hazard)', () => {
  test('a group containing visibility.spec.ts (file-wide entry) is forced to 1 worker', () => {
    const visibilityFile = 'qa/e2e/tests/apps/minicrm/functional/visibility/visibility.spec.ts';
    const brandingFile = 'qa/e2e/tests/apps/minicrm/functional/branding/branding.spec.ts';
    const plans = buildGroupPlan([visibilityFile, brandingFile]);
    const groupWithVisibility = plans.find((p) => p.files.includes(visibilityFile));
    expect(groupWithVisibility?.workers).toBe(1);
  });

  test('a group containing only testTitleContains-scoped files may use more than 1 worker', () => {
    // deal-health-check.spec.ts and ai-usage-dashboard.spec.ts are both
    // testTitleContains-scoped (only specific tests are tracked, proving the
    // rest of each file is unaffected) and touch disjoint resources.
    const dealHealthFile = 'qa/e2e/tests/apps/minicrm/functional/deals/deal-health-check.spec.ts';
    const aiUsageFile = 'qa/e2e/tests/apps/minicrm/functional/ai/ai-usage-dashboard.spec.ts';
    const plans = buildGroupPlan([dealHealthFile, aiUsageFile]);
    const groupWithBoth = plans.find(
      (p) => p.files.includes(dealHealthFile) && p.files.includes(aiUsageFile),
    );
    // They may or may not be co-located by the partitioner, but IF co-located,
    // workers must be allowed to exceed 1 since neither has a file-wide entry.
    if (groupWithBoth) {
      expect(groupWithBoth.workers).toBeGreaterThan(1);
    }
  });

  test('a file-wide-entry file is never co-located with a testTitleContains-scoped file', () => {
    // navigation.spec.ts (file-wide) and deal-health-check.spec.ts
    // (testTitleContains-scoped) don't conflict with each other, but they
    // must still land in separate groups — file-wide and title-scoped files
    // are partitioned independently so a file-wide file's 1-worker cap never
    // drags down an otherwise-safe title-scoped group's worker count.
    const navFile = 'qa/e2e/tests/apps/minicrm/functional/navigation/navigation.spec.ts';
    const dealHealthFile = 'qa/e2e/tests/apps/minicrm/functional/deals/deal-health-check.spec.ts';
    const plans = buildGroupPlan([navFile, dealHealthFile]);
    const groupWithNav = plans.find((p) => p.files.includes(navFile));
    expect(groupWithNav?.workers).toBe(1);
    expect(groupWithNav?.files).not.toContain(dealHealthFile);
  });

  test('a group of only testTitleContains-scoped, non-conflicting files is not capped to 1', () => {
    const registryFiles = [...new Set(RESOURCE_REGISTRY.map((e) => e.file))];
    const plans = buildGroupPlan(registryFiles);
    // At least one real group in the full real-registry plan should exceed
    // workers=1 — proving the cap isn't applied universally by accident.
    const anyMultiWorkerGroup = plans.some((p) => p.workers > 1);
    expect(anyMultiWorkerGroup).toBe(true);
  });
});
