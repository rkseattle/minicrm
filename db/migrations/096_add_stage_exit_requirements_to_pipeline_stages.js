/**
 * Migration 096: Add stage_exit_requirements jsonb column to pipeline_stages. (MINCRM-527)
 *
 * This column allows each pipeline stage to declare which deal fields must be present
 * (required_fields) or should ideally be present (warning_fields) before a deal can
 * transition away from that stage. The application's deal update service enforces this
 * at transition time.
 *
 * Column shape:
 *   {
 *     "required_fields": string[],   -- blocks the transition; 400 if any are null
 *     "warning_fields":  string[]    -- allows the transition but signals a warning to the caller
 *   }
 *
 * Seed: "Closed Won" and "Closed Lost" (the two is_fixed stages) ship with
 * required_fields: ["close_date"] so deals cannot be marked closed without a close date.
 * All other stages default to {} (no requirements).
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumn('pipeline_stages', {
    stage_exit_requirements: {
      type: 'jsonb',
      notNull: true,
      default: "'{}'",
    },
  });

  // Seed the two fixed terminal stages with a close_date requirement.
  pgm.sql(`
    UPDATE pipeline_stages
    SET stage_exit_requirements = '{"required_fields":["close_date"],"warning_fields":[]}'
    WHERE is_fixed = true
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropColumn('pipeline_stages', 'stage_exit_requirements');
};
