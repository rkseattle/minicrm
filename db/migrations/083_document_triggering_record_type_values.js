'use strict';

/**
 * Migration 083: Document valid values for automation_rule_logs.triggering_record_type
 * via a column comment. (MINCRM-516)
 *
 * The column is a bare varchar(50) with no CHECK constraint. Following the
 * precedent established by MINCRM-501 (migration 076) for audit_log, we do NOT
 * add a DB-level CHECK constraint here. The reasoning is identical: valid values
 * evolve as new trigger entity types are added; each addition would require a new
 * migration solely to amend the constraint, creating unnecessary migration churn
 * and a risk of schema drift.
 *
 * Valid values are enforced at the service layer: automationService.ts uses the
 * AutomationTriggerContext type which constrains recordType to 'deal' | 'contact',
 * and the value is written directly from that typed field with no bypass path.
 *
 * A column comment is added so DBAs and developers inspecting the schema directly
 * can see the authoritative value list without reading application code.
 *
 * The companion Zod change (narrowing triggering_record_type from z.string() to
 * z.enum(['deal', 'contact']) in automationRuleLogResponseSchema) is applied
 * alongside this migration in shared/schemas/automationSchema.ts.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    COMMENT ON COLUMN automation_rule_logs.triggering_record_type IS
      'Entity type that caused the automation rule to fire. Valid values: ''deal'', ''contact''. '
      'Enforced at the service layer via AutomationTriggerContext in server/src/services/automationService.ts. '
      'Not a CHECK constraint — see migration 083 for rationale (mirrors the audit_log approach from migration 076).';
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    COMMENT ON COLUMN automation_rule_logs.triggering_record_type IS NULL;
  `);
};
