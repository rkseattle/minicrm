'use strict';

/**
 * Migration 071: Seed AI sub-feature flags for role-based AI feature control.
 *
 * Adds nine per-feature flags into the existing feature_flags table, all in the
 * 'AI' category. Each flag supports role overrides (admin/rep) via the existing
 * role_overrides JSONB column — the same mechanism used by 'reporting' and
 * 'csv_export'. All flags default to enabled for both roles.
 *
 * The nine AI sub-features (matching the AC):
 *   ai_nli_page              — Natural Language Interface page
 *   ai_activity_summarizer   — Activity summarizer on record timelines
 *   ai_email_draft           — AI-assisted email draft in activities
 *   ai_task_suggestions      — AI-suggested tasks on records
 *   ai_contact_enrichment    — AI-driven contact enrichment
 *   ai_duplicate_explanation — Natural language explanation of duplicate matches
 *   ai_lead_score_narrative  — Narrative explanation of lead scores
 *   ai_deal_health_check     — Deal health assessment
 *   ai_stage_advancement     — Stage advancement suggestion on deals
 *
 * All are child flags of the master 'ai_features' toggle. A rep sees a sub-feature
 * only when: (1) ai_features is enabled AND (2) the sub-feature flag allows their role.
 * Admins always have access regardless of role_overrides  AC.
 *
 *
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_nli_page',
        'NLI Page',
        'Provides the natural language interface page where users can query CRM data in plain English.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      ),
      (
        'ai_activity_summarizer',
        'Activity Summarizer',
        'Generates AI summaries of recent activity on contact, account, and deal record timelines.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      ),
      (
        'ai_email_draft',
        'Email Draft',
        'Assists users with drafting outbound emails in the activity composer using AI.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      ),
      (
        'ai_task_suggestions',
        'Task Suggestions',
        'Suggests follow-up tasks based on recent activity and deal context.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      ),
      (
        'ai_contact_enrichment',
        'Contact Enrichment',
        'Automatically enriches contact records with additional data from AI-powered inference.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      ),
      (
        'ai_duplicate_explanation',
        'Duplicate Explanation',
        'Provides a natural language explanation of why two records were flagged as potential duplicates.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      ),
      (
        'ai_lead_score_narrative',
        'Lead Score Narrative',
        'Generates a plain-English explanation of the factors contributing to a lead score.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      ),
      (
        'ai_deal_health_check',
        'Deal Health Check',
        'Assesses overall deal health and surfaces risk signals using AI analysis of deal activity.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      ),
      (
        'ai_stage_advancement',
        'Stage Advancement Suggestion',
        'Suggests when a deal is ready to advance to the next pipeline stage based on activity signals.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM feature_flags
    WHERE flag_key IN (
      'ai_nli_page',
      'ai_activity_summarizer',
      'ai_email_draft',
      'ai_task_suggestions',
      'ai_contact_enrichment',
      'ai_duplicate_explanation',
      'ai_lead_score_narrative',
      'ai_deal_health_check',
      'ai_stage_advancement'
    );
  `);
};
