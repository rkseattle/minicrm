'use strict';

/**
 * Migration 161: Remove the coverage_instrumentation and
 * coverage_session_management feature_flags rows. (MINCRM-663)
 *
 * These two rows (seeded by migrations 156 and 157) gated the Coverage/TIA
 * control API (routes/coverage.ts) and session management API
 * (routes/coverageSessions.ts) via requireFeatureEnabled — the same
 * mechanism every ordinary, customer-facing feature flag uses.
 * FeatureFlagsSettings.tsx has no category or system_flag filtering, so
 * both rows rendered identically to a real product toggle in the CRM's own
 * admin Settings page — internal CI/dev test infrastructure had no business
 * being discoverable or enable-able through the product's own UI.
 *
 * Both routers now gate their ENTIRE route registration on an env var at
 * process boot instead (COVERAGE_INSTRUMENTATION / COVERAGE_SESSION_MANAGEMENT
 * — see routes/coverage.ts and routes/coverageSessions.ts's own docblocks) —
 * COVERAGE_INSTRUMENTATION is the same env var that already gated whether the
 * underlying V8 agent started (coverageConfig.ts), extended to also gate the
 * control surface sitting on top of it. These two feature_flags rows are
 * therefore now dead weight: nothing reads them anymore, and leaving them
 * seeded would let them silently reappear in FeatureFlagsSettings.tsx as an
 * always-inert toggle that looks actionable but does nothing.
 *
 * down() re-seeds both rows verbatim (matching migrations 156/157's own
 * INSERT), which only restores the DB row — it does NOT revert
 * routes/coverage.ts / routes/coverageSessions.ts back to reading
 * requireFeatureEnabled. A rollback of this migration alone leaves the
 * routes on the new env-var gate with an inert, unread feature_flags row
 * re-seeded alongside it; a real revert of this story requires reverting
 * the route-layer commits too.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    DELETE FROM feature_flags WHERE flag_key IN ('coverage_instrumentation', 'coverage_session_management');
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'coverage_instrumentation',
        'Coverage Instrumentation',
        'Enables the Coverage/TIA control API for driving the backend coverage agent and ingesting frontend coverage dumps. Developer/CI tooling — leave disabled in production.',
        'Developer Tools',
        false,
        '{}',
        true
      ),
      (
        'coverage_session_management',
        'Coverage Session Management',
        'Enables the Coverage/TIA session control API (start/end sessions, correlation-ID attribution) for automated E2E runs and manual-testing recording. Developer/CI tooling — leave disabled in production.',
        'Developer Tools',
        false,
        '{}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING;
  `);
};
