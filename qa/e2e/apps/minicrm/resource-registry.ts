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
 * qa/e2e/tests/apps/minicrm/functional/ (2026-07-23; re-audited 2026-07-31 for
 * Some files match the string `@serial` only inside a comment,
 * with no test actually tagged, and are intentionally excluded — see
 * KNOWN_COMMENT_ONLY_FILES in resource-registry.spec.ts, which is the list that
 * is actually consulted. Do not maintain a second copy of it here.
 *
 * Several files are only PARTIALLY @serial — most tests in the file are
 * plain @functional and only specific tests mutate shared state. Where
 * that's the case, `testTitleContains` narrows an entry to the matching
 * test(s) only; entries without `testTitleContains` apply to the whole file.
 *
 *
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
  // Reset by ensureSystemDefaults() and by nothing else today. Modeled so the
  // composite key below expands to the helper's complete write set rather than
  // a near-complete one.
  | 'settings.tags_restrict_creation'
  // Org-wide MFA enforcement. Leaving it on blocks every later loginAsAdmin(),
  // which mfa.spec.ts's own resetMfaRequired() comment already warned about —
  // the file restored the row correctly but was never tagged, so it ran in the
  // parallel matrix. Found by the direct-REST-call detection restored in
  // the wrapper derivation alone could not see it, because this
  // spec mutates the endpoint inline rather than through a behavior helper.
  | 'settings.mfa_required'
  // The system_settings row backing the onboarding checklist's first task.
  // Written directly by resetPipelineStagesReviewed() and indirectly by
  // ensureSystemDefaults().
  | 'settings.pipeline_stages_reviewed'
  // Every row ensureSystemDefaults() resets, as ONE key. That helper writes TEN
  // shared settings — default_language, nav_layout, email_notifications,
  // tags_restrict_creation, currencies, branding, pipeline_stages_reviewed, sso,
  // mfa_required and visibility — so any two files that call it conflict on all
  // ten, and a file that calls it conflicts with anyone touching any of them.
  //
  // A composite key rather than ten entries per caller, deliberately. Listing
  // them individually means nine hand-maintained ten-item lists that drift the
  // moment ensureSystemDefaults gains or loses a write — which is exactly how
  // this was first modeled (pipeline_stages_reviewed only), and it put
  // data-hygiene beside deal-health-check and notifications beside mfa at
  // workers=2, each with a live cross-file race. One name for one helper's
  // effect cannot drift that way.
  //
  // Callers additionally declare the SPECIFIC key they deliberately mutate
  // (settings.branding for branding.spec.ts, and so on), so a file that only
  // resets is still distinguishable from one that sets a non-default value.
  | 'settings.ensure_system_defaults'
  // NOT a system_settings row: onboarding_completed is a column on the `users`
  // table, written per-caller (server settingsService.setOnboardingCompleted).
  // It is shared only because every spec authenticates as the same seeded admin
  // account, and only onboarding.spec.ts ever sets it FALSE — which is what
  // makes it hazardous, since a concurrent spec logging in as admin then gets
  // the checklist overlay. Writes scoped to an ephemeral user (the iam/ specs,
  // suppressUserOnboarding) do NOT touch this key.
  | 'users.admin_onboarding_completed'
  // The pipeline_stages table itself — names, membership and the sort_order
  // column, mutated via PUT /api/v1/settings/pipeline-stages/reorder and the
  // add/rename/delete endpoints. Distinct from
  // settings.pipeline_stages_reviewed, which is the onboarding checklist's
  // boolean and says nothing about the stage rows.
  //
  // Only one registry entry declares this key today, so it draws no edges yet:
  // pipelines.spec.ts and stage-exit-requirements.spec.ts also read these rows
  // but have no @serial tests, and the registry may only name files that do
  // (enforced by resource-registry.spec.ts's second completeness test). What
  // actually isolates pipeline-stages.spec.ts is its @serial tag moving it to
  // the single-worker e2e-serial job. The key is here so the resource is named
  // rather than implicit, and so a future @serial spec touching these rows
  // conflicts correctly.
  | 'pipeline_stages'
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
 * resource-registry.spec.ts enforces the invariant in both directions: every
 * @serial spec has an entry, and every entry names a file that still has one.
 * Deliberately no file count here — the previous one drifted to 27 against a
 * real 26, and a number nothing asserts is worth less than the maintenance it
 * costs.
 */
export const RESOURCE_REGISTRY: readonly ResourceRegistryEntry[] = [
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/settings/settings.spec.ts',
    // ensureSystemDefaults() runs in this file's hooks and DELETEs
    // pipeline_stages_reviewed, so every test here writes that row.
    reads: ['settings.currencies', 'settings.ensure_system_defaults'],
    writes: ['settings.currencies', 'settings.ensure_system_defaults'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/branding/branding.spec.ts',
    // ensureSystemDefaults() runs in this file's hooks and DELETEs
    // pipeline_stages_reviewed, so every test here writes that row.
    reads: ['settings.branding', 'settings.ensure_system_defaults'],
    writes: ['settings.branding', 'settings.ensure_system_defaults'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/visibility/visibility.spec.ts',
    reads: ['settings.visibility_policy'],
    writes: ['settings.visibility_policy'],
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
    file: 'qa/e2e/tests/apps/minicrm/functional/navigation/navigation.spec.ts',
    // ensureSystemDefaults() runs in this file's hooks and DELETEs
    // pipeline_stages_reviewed, so every test here writes that row.
    reads: ['settings.nav_layout', 'settings.ensure_system_defaults'],
    writes: ['settings.nav_layout', 'settings.ensure_system_defaults'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/deals/deal-health-check.spec.ts',
    testTitleContains: 'F7-DH4',
    reads: ['settings.visibility_policy'],
    writes: ['settings.visibility_policy'],
  },
  {
    // File-wide, and all four tests in the file are @serial: the beforeEach sets
    // AI on and the afterEach restores defaults, so every test writes it. The
    // panel only renders when the server reports AI on, and all four were
    // verified to depend on it.
    // withFlags() cannot substitute: it intercepts the CLIENT's flag fetch and
    // never reaches ai_configuration.enabled, which the server checks.
    //
    // Undeclared, the scheduler co-scheduled this file directly after
    // data-hygiene, whose restoreAiDefaultsAfterTest leaves ai_features=false
    // and ai_configuration.enabled=false. F7-DH4 then failed with
    // "HealingLocator: all strategies exhausted" on run-deal-health-check-button
    // — reproduced with just those two files, and passing with either alone.
    // The comment at the top of this file records that the composite
    // key was introduced precisely because the old modelling "put data-hygiene
    // beside deal-health-check ... with a live cross-file race"; this entry is
    // the half that was still missing.
    file: 'qa/e2e/tests/apps/minicrm/functional/deals/deal-health-check.spec.ts',
    // feature_flags.ai_features as well as the settings key: setAiEnabled writes
    // BOTH in one server transaction (aiConfigService.ts). Every other
    // setAiEnabled caller in this registry declares the pair; omitting it here
    // drew no edge to feature-flags.spec.ts, which is the same undeclared-cascade
    // defect fixed across eleven entries.
    reads: ['settings.ai_configuration_enabled', 'feature_flags.ai_features'],
    writes: ['settings.ai_configuration_enabled', 'feature_flags.ai_features'],
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
    file: 'qa/e2e/tests/apps/minicrm/functional/sso/sso.spec.ts',
    // ensureSystemDefaults() runs in this file's hooks and DELETEs
    // pipeline_stages_reviewed, so every test here writes that row.
    reads: ['settings.sso', 'settings.ensure_system_defaults'],
    writes: ['settings.sso', 'settings.ensure_system_defaults'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-context-proposal.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: [
      'settings.ai_configuration_enabled',
      // setAiEnabled() cascades server-side: aiConfigService writes the
      // ai_features flag in the SAME transaction as the master toggle
      // (aiConfigService.ts:507-515), so this spec writes that flag too.
      // Undeclared, the graph drew no edge to feature-flags.spec.ts and the
      // two could be co-scheduled at workers:2.
      'feature_flags.ai_features',
    ],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-field-exclusions.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: [
      'settings.ai_configuration_enabled',
      // setAiEnabled() cascades server-side: aiConfigService writes the
      // ai_features flag in the SAME transaction as the master toggle
      // (aiConfigService.ts:507-515), so this spec writes that flag too.
      // Undeclared, the graph drew no edge to feature-flags.spec.ts and the
      // two could be co-scheduled at workers:2.
      'feature_flags.ai_features',
    ],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-permissions.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: [
      'settings.ai_configuration_enabled',
      // setAiEnabled() cascades server-side: aiConfigService writes the
      // ai_features flag in the SAME transaction as the master toggle
      // (aiConfigService.ts:507-515), so this spec writes that flag too.
      // Undeclared, the graph drew no edge to feature-flags.spec.ts and the
      // two could be co-scheduled at workers:2.
      'feature_flags.ai_features',
    ],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-context.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: [
      'settings.ai_configuration_enabled',
      // setAiEnabled() cascades server-side: aiConfigService writes the
      // ai_features flag in the SAME transaction as the master toggle
      // (aiConfigService.ts:507-515), so this spec writes that flag too.
      // Undeclared, the graph drew no edge to feature-flags.spec.ts and the
      // two could be co-scheduled at workers:2.
      'feature_flags.ai_features',
    ],
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
    writes: [
      'settings.ai_configuration_enabled',
      // setAiEnabled() cascades server-side: aiConfigService writes the
      // ai_features flag in the SAME transaction as the master toggle
      // (aiConfigService.ts:507-515), so this spec writes that flag too.
      // Undeclared, the graph drew no edge to feature-flags.spec.ts and the
      // two could be co-scheduled at workers:2.
      'feature_flags.ai_features',
    ],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-data-lifecycle.spec.ts',
    reads: ['settings.ai_configuration_enabled', 'settings.ai_session_retention'],
    writes: [
      'settings.ai_configuration_enabled',
      'settings.ai_session_retention',
      // setAiEnabled() cascades to the ai_features flag in the same server-side
      // transaction (aiConfigService.ts:507-515). The spec's own comment at :73
      // already described this cascade while the entry omitted it — exactly the
      // registry-vs-reality drift this ticket exists to close.
      'feature_flags.ai_features',
    ],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-session-persistence.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: [
      'settings.ai_configuration_enabled',
      // setAiEnabled() cascades server-side: aiConfigService writes the
      // ai_features flag in the SAME transaction as the master toggle
      // (aiConfigService.ts:507-515), so this spec writes that flag too.
      // Undeclared, the graph drew no edge to feature-flags.spec.ts and the
      // two could be co-scheduled at workers:2.
      'feature_flags.ai_features',
    ],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-nli-result-rendering.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: [
      'settings.ai_configuration_enabled',
      // setAiEnabled() cascades server-side: aiConfigService writes the
      // ai_features flag in the SAME transaction as the master toggle
      // (aiConfigService.ts:507-515), so this spec writes that flag too.
      // Undeclared, the graph drew no edge to feature-flags.spec.ts and the
      // two could be co-scheduled at workers:2.
      'feature_flags.ai_features',
    ],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: [
      'settings.ai_configuration_enabled',
      // setAiEnabled() cascades server-side: aiConfigService writes the
      // ai_features flag in the SAME transaction as the master toggle
      // (aiConfigService.ts:507-515), so this spec writes that flag too.
      // Undeclared, the graph drew no edge to feature-flags.spec.ts and the
      // two could be co-scheduled at workers:2.
      'feature_flags.ai_features',
    ],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/ai/ai-nli-entities.spec.ts',
    reads: ['settings.ai_configuration_enabled'],
    writes: [
      'settings.ai_configuration_enabled',
      // setAiEnabled() cascades server-side: aiConfigService writes the
      // ai_features flag in the SAME transaction as the master toggle
      // (aiConfigService.ts:507-515), so this spec writes that flag too.
      // Undeclared, the graph drew no edge to feature-flags.spec.ts and the
      // two could be co-scheduled at workers:2.
      'feature_flags.ai_features',
    ],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/i18n/i18n.spec.ts',
    // ensureSystemDefaults() runs in this file's hooks and DELETEs
    // pipeline_stages_reviewed, so every test here writes that row.
    reads: ['settings.default_language', 'settings.ensure_system_defaults'],
    writes: ['settings.default_language', 'settings.ensure_system_defaults'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/notifications/notifications.spec.ts',
    testTitleContains: 'F10-AS',
    // Stays title-scoped, deliberately. Unlike reports-nav below, this file's
    // ensureSystemDefaults() calls are INSIDE the F10-AS describe.serial block's
    // own hooks (:190, :202), not at file level — the F10-PP block has its own
    // beforeEach and never calls it. Promoting this to a file-wide entry would
    // move the whole file into the workers:1 partition on a false premise.
    reads: ['settings.email_notifications_enabled', 'settings.ensure_system_defaults'],
    writes: ['settings.email_notifications_enabled', 'settings.ensure_system_defaults'],
  },
  {
    file: 'qa/e2e/tests/apps/minicrm/functional/reports/reports-nav.spec.ts',
    testTitleContains: 'reports nav: clicking Reports nav link',
    reads: ['settings.nav_layout'],
    writes: ['settings.nav_layout'],
  },
  {
    // Second, FILE-WIDE entry for the same file. reports-nav.spec.ts calls
    // ensureSystemDefaults() from file-level beforeEach/afterEach (:47-55), so
    // every test writes pipeline_stages_reviewed — not just the one the entry
    // above is scoped to. Without a file-wide entry hasFileWideRegistryEntry()
    // returns false and the file stays eligible for MAX_GROUP_WORKERS, able to
    // race itself on the row.
    file: 'qa/e2e/tests/apps/minicrm/functional/reports/reports-nav.spec.ts',
    reads: ['settings.ensure_system_defaults'],
    writes: ['settings.ensure_system_defaults'],
  },
  {
    // Only F8-A1 touches the org-wide row; F8-S1/LS1/LS2/D1 are per-user MFA
    // enrolment and stay plain @functional.
    file: 'qa/e2e/tests/apps/minicrm/functional/auth/mfa.spec.ts',
    testTitleContains: 'F8-A1',
    reads: ['settings.mfa_required'],
    writes: ['settings.mfa_required'],
  },
  {
    // Self-serializes with test.describe.configure({ mode: 'serial' }) and its
    // own comment says it "mutates shared global state (sort_order column)" —
    // but it carried no @serial tag, so it ran in the parallel shard matrix
    // while reordering rows that pipelines.spec.ts and
    // stage-exit-requirements.spec.ts also read. describe.configure orders
    // tests within the file and gives no cross-file protection.
    file: 'qa/e2e/tests/apps/minicrm/functional/pipeline-stages/pipeline-stages.spec.ts',
    reads: ['pipeline_stages', 'settings.ensure_system_defaults'],
    writes: [
      'pipeline_stages',
      // Second server-side cascade of the same shape as setAiEnabled's: PS-1
      // (add) and PS-2 (rename) reach createPipelineStageHandler /
      // updatePipelineStageHandler, which both fire
      // void markPipelineStagesReviewed() (pipelineStageController.ts:70,117)
      // — upserting the same system_settings row the eight ensureSystemDefaults
      // callers delete. Undeclared, the graph drew no edge and the generator
      // co-scheduled this file with branding.spec.ts.
      'settings.ensure_system_defaults',
    ],
  },
  {
    // The file this ticket exists for. Writes TWO shared resources: the
    // pipeline_stages_reviewed system_settings row (via ensureSystemDefaults and
    // resetPipelineStagesReviewed), and the seeded admin's own
    // users.onboarding_completed — which it alone ever sets FALSE.
    // File-wide: all eight tests touch the flag.
    file: 'qa/e2e/tests/apps/minicrm/functional/onboarding/onboarding.spec.ts',
    reads: ['settings.ensure_system_defaults', 'users.admin_onboarding_completed'],
    writes: ['settings.ensure_system_defaults', 'users.admin_onboarding_completed'],
  },
  {
    // F-HYGIENE3 calls setAiEnabled(restClient, true) to make the data-hygiene
    // sub-panel's run-now button clickable, writing the ai_configuration_enabled
    // singleton that eleven other @serial specs conflict on. The file's own
    // header comment argued no @serial was needed, reasoning only about
    // data_hygiene_scoring_config and overlooking this.
    // Both keys on ONE title-scoped entry: F-HYGIENE3 writes
    // ai_configuration_enabled via setAiEnabled(), and its own
    // describe.serial-scoped afterEach calls ensureSystemDefaults(), which
    // DELETEs pipeline_stages_reviewed. Deliberately NOT file-wide —
    // F-HYGIENE1/2 are plain @functional and run in the parallel matrix, so a
    // file-wide claim would misdescribe what they touch.
    file: 'qa/e2e/tests/apps/minicrm/functional/data-hygiene/data-hygiene.spec.ts',
    testTitleContains: 'F-HYGIENE3',
    reads: ['settings.ai_configuration_enabled', 'settings.ensure_system_defaults'],
    writes: [
      'settings.ai_configuration_enabled',
      'settings.ensure_system_defaults',
      // Same setAiEnabled() cascade as the ai/ specs. This entry matters most:
      // the generator places data-hygiene.spec.ts in a group at workers=2, so a
      // missing edge to feature-flags.spec.ts is genuinely concurrent, not just
      // sequential leakage.
      'feature_flags.ai_features',
    ],
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
/**
 * The rows ensureSystemDefaults() actually writes, in the order it writes them
 * (settings.behaviors.ts). Declaring `settings.ensure_system_defaults` on an
 * entry is equivalent to declaring all of these — see EXPANSION below.
 *
 * Keep this aligned with that helper. resource-registry.spec.ts asserts the two
 * agree by reading the helper's own source, so adding a write there without
 * adding it here fails rather than silently under-modeling the conflict.
 */
export const ENSURE_SYSTEM_DEFAULTS_KEYS: readonly ResourceKey[] = [
  'settings.default_language',
  'settings.nav_layout',
  'settings.email_notifications_enabled',
  'settings.tags_restrict_creation',
  'settings.currencies',
  'settings.branding',
  'settings.pipeline_stages_reviewed',
  'settings.sso',
  'settings.mfa_required',
  'settings.visibility_policy',
];

/**
 * Rewrites the composite key into the concrete keys it stands for.
 *
 * The conflict graph matches keys by string equality, so a composite left
 * unexpanded would conflict only with other composites — and NOT with, say,
 * visibility.spec.ts's `settings.visibility_policy`, even though
 * ensureSystemDefaults resets exactly that row. Expanding here means each caller
 * declares the helper ONCE while the graph still sees all ten rows.
 */
function expandCompositeKeys(keys: readonly string[]): string[] {
  return keys.flatMap((key) =>
    key === 'settings.ensure_system_defaults' ? [...ENSURE_SYSTEM_DEFAULTS_KEYS] : [key],
  );
}

export function collapseRegistryToFileTouches(): FileResourceTouch[] {
  const byFile = new Map<string, { reads: Set<string>; writes: Set<string> }>();
  for (const entry of RESOURCE_REGISTRY) {
    const existing = byFile.get(entry.file) ?? {
      reads: new Set<string>(),
      writes: new Set<string>(),
    };
    for (const r of expandCompositeKeys(entry.reads)) existing.reads.add(r);
    for (const w of expandCompositeKeys(entry.writes)) existing.writes.add(w);
    byFile.set(entry.file, existing);
  }
  return [...byFile.entries()].map(([file, { reads, writes }]) => ({ file, reads, writes }));
}
