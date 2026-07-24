/**
 * Ground-truth registry of which shared MiniCRM resources each E2E spec
 * file's `@serial`-tagged tests read and/or write.
 *
 * This is the app-domain data source consumed by the framework-layer
 * conflict-graph builder (framework/reporting/conflict-graph.ts) — kept
 * here, not in framework/, because it names MiniCRM-specific tables and
 * settings keys, which the framework-purity check forbids in framework/.
 *
 * Seeded from a direct audit of every file matching `@serial` under
 * qa/e2e/tests/apps/minicrm/functional/ (2026-07-23). Three files matched
 * the string `@serial` only inside a comment (no test actually tagged) and
 * are intentionally excluded: insights/coaching.spec.ts,
 * data-hygiene/data-hygiene.spec.ts, leads/lead-routing.spec.ts.
 *
 * Several files are only PARTIALLY @serial — most tests in the file are
 * plain @functional and only specific tests mutate shared state. Where
 * that's the case, `testTitleContains` narrows an entry to the matching
 * test(s) only; entries without `testTitleContains` apply to the whole file.
 *
 * MINCRM-661
 */

import type { FileResourceTouch } from '../../framework/reporting/conflict-graph.js';

/** A shared resource a test can read from and/or write to. Distinct keys
 *  never conflict with each other even if touched by the same file. */
export type ResourceKey =
  | 'settings.currencies'
  | 'settings.branding'
  | 'settings.visibility_policy'
  | 'settings.nav_layout'
  | 'settings.sso'
  | 'settings.ai_configuration_enabled'
  | 'settings.ai_cost_rates'
  | 'settings.ai_session_retention'
  | 'settings.default_language'
  | 'settings.email_notifications_enabled'
  | 'feature_flags.coverage_instrumentation'
  | 'feature_flags.coverage_session_management'
  | 'feature_flags.coverage_pipeline_ingestion'
  | 'feature_flags.coverage_mapping_query'
  | 'feature_flags.notes'
  | 'feature_flags.tags'
  | 'feature_flags.ai_features'
  | 'feature_flags.mobile_access'
  | 'feature_flags.demo_data'
  | 'feature_flags.groups'
  | 'custom_roles';

export interface ResourceTouch {
  reads: ResourceKey[];
  writes: ResourceKey[];
}

export interface ResourceRegistryEntry extends ResourceTouch {
  /** Spec file path, relative to repo root. */
  file: string;
  /** When set, this entry applies only to tests whose title contains this
   *  substring — the rest of the file is plain @functional. When omitted,
   *  applies to every @serial test in the file. */
  testTitleContains?: string;
}

/**
 * Ground-truth resource touches for every currently `@serial`-tagged test
 * (27 files; 3 additional files matched the bare string `@serial` only in a
 * comment and are correctly excluded — see module doc).
 */
export const RESOURCE_REGISTRY: readonly ResourceRegistryEntry[] = [
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/settings/settings.spec.ts',
    reads: ['settings.currencies'],
    writes: ['settings.currencies'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/branding/branding.spec.ts',
    reads: ['settings.branding'],
    writes: ['settings.branding'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/visibility/visibility.spec.ts',
    reads: ['settings.visibility_policy'],
    writes: ['settings.visibility_policy'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/coverage-instrumentation/coverage-instrumentation.spec.ts',
    reads: ['feature_flags.coverage_instrumentation'],
    writes: ['feature_flags.coverage_instrumentation'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/feature-flags/feature-flags.spec.ts',
    reads: [
      'feature_flags.notes',
      'feature_flags.tags',
      'feature_flags.ai_features',
      'feature_flags.mobile_access',
      'feature_flags.demo_data',
      'feature_flags.groups',
      'custom_roles',
    ],
    writes: [
      'feature_flags.notes',
      'feature_flags.tags',
      'feature_flags.ai_features',
      'feature_flags.mobile_access',
      'feature_flags.demo_data',
      'feature_flags.groups',
      'custom_roles',
    ],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/coverage-pipeline/coverage-pipeline.spec.ts',
    reads: ['feature_flags.coverage_instrumentation', 'feature_flags.coverage_pipeline_ingestion'],
    writes: ['feature_flags.coverage_instrumentation', 'feature_flags.coverage_pipeline_ingestion'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/navigation/navigation.spec.ts',
    reads: ['settings.nav_layout'],
    writes: ['settings.nav_layout'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/deals/deal-health-check.spec.ts',
    testTitleContains: 'F7-DH4',
    reads: ['settings.visibility_policy'],
    writes: ['settings.visibility_policy'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/admin/aiSettings.spec.ts',
    reads: ['settings.ai_configuration_enabled', 'settings.ai_session_retention'],
    writes: [
      'settings.ai_configuration_enabled',
      'settings.ai_session_retention',
      // resetAiSettings()'s master-toggle-off cascades to disable ai_features too.
      'feature_flags.ai_features',
    ],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/coverage-mapping/coverage-mapping.spec.ts',
    reads: [
      'feature_flags.coverage_instrumentation',
      'feature_flags.coverage_session_management',
      'feature_flags.coverage_pipeline_ingestion',
      'feature_flags.coverage_mapping_query',
    ],
    writes: [
      'feature_flags.coverage_instrumentation',
      'feature_flags.coverage_session_management',
      'feature_flags.coverage_pipeline_ingestion',
      'feature_flags.coverage_mapping_query',
    ],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/sso/sso.spec.ts',
    reads: ['settings.sso'],
    writes: ['settings.sso'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-context-proposal.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: ['settings.ai_configuration_enabled'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-field-exclusions.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: ['settings.ai_configuration_enabled'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-permissions.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: ['settings.ai_configuration_enabled'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-context.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: ['settings.ai_configuration_enabled'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-usage-dashboard.spec.ts',
    testTitleContains: 'F-AI-UD-6',
    // NOT settings.ai_configuration_enabled — mutates /admin/ai/cost-rates,
    // a distinct settings key. The file's own header comment says otherwise;
    // this registry entry reflects the verified request body, not the comment.
    reads: ['settings.ai_cost_rates'],
    writes: ['settings.ai_cost_rates'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-mutation-confirmation.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: ['settings.ai_configuration_enabled'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-data-lifecycle.spec.ts',
    reads: ['settings.ai_configuration_enabled', 'settings.ai_session_retention'],
    writes: ['settings.ai_configuration_enabled', 'settings.ai_session_retention'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-session-persistence.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: ['settings.ai_configuration_enabled'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-nli-result-rendering.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: ['settings.ai_configuration_enabled'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: ['settings.ai_configuration_enabled'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-nli-entities.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: ['settings.ai_configuration_enabled'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/i18n/i18n.spec.ts',
    reads: ['settings.default_language'],
    writes: ['settings.default_language'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/notifications/notifications.spec.ts',
    testTitleContains: 'F10-AS',
    reads: ['settings.email_notifications_enabled'],
    writes: ['settings.email_notifications_enabled'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/reports/reports-nav.spec.ts',
    testTitleContains: 'reports nav: clicking Reports nav link',
    reads: ['settings.nav_layout'],
    writes: ['settings.nav_layout'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/coverage-sessions/coverage-sessions.spec.ts',
    reads: ['feature_flags.coverage_session_management'],
    writes: ['feature_flags.coverage_session_management'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/accessibility/accessibility.spec.ts',
    testTitleContains: 'A11Y-N1',
    reads: ['settings.nav_layout'],
    writes: ['settings.nav_layout'],
  },
] as const;

/**
 * Collapses RESOURCE_REGISTRY entries (possibly multiple per file, at
 * test-title granularity) down to one FileResourceTouch per file, for
 * conflict-graph construction — which reasons about whole-file conflicts,
 * since LPT bin-packing and the conflict-group scheduler assign whole files,
 * not individual tests.
 */
export function collapseRegistryToFileTouches(): FileResourceTouch[] {
  const byFile = new Map<string, { reads: Set<string>; writes: Set<string> }>();
  for (const entry of RESOURCE_REGISTRY) {
    const existing = byFile.get(entry.file) ?? {
      reads: new Set<string>(),
      writes: new Set<string>(),
    };
    for (const r of entry.reads) existing.reads.add(r);
    for (const w of entry.writes) existing.writes.add(w);
    byFile.set(entry.file, existing);
  }
  return [...byFile.entries()].map(([file, { reads, writes }]) => ({ file, reads, writes }));
}
