/**
 * Migration 023: Add probability column to deals table.
 *
 * NULL means the deal inherits its probability from the pipeline stage default.
 * A stored integer (0–100) means the rep has manually overridden the probability.
 * Effective probability = COALESCE(d.probability, ps.probability).
 *
 * Stage default probabilities are already stored on the pipeline_stages table
 * (migration 021). (MINCRM-179)
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumn('deals', {
    probability: {
      type: 'integer',
      notNull: false,
      default: null,
      check: 'probability IS NULL OR (probability >= 0 AND probability <= 100)',
    },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropColumn('deals', 'probability');
};
