/**
 * Migration 057: Add pipeline_id FK to deals (MINCRM-397).
 *
 * Links each deal to a pipeline. All existing deals are backfilled to the
 * default pipeline. NULL is not permitted after backfill; the column is
 * effectively NOT NULL once migrated but left nullable for the migration
 * to avoid requiring a DEFAULT on historical rows.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('deals', {
    pipeline_id: {
      type: 'uuid',
      references: '"pipelines"',
      onDelete: 'RESTRICT',
      notNull: false,
    },
  });

  // Backfill all existing deals to the default pipeline
  pgm.sql(`
    UPDATE deals
    SET pipeline_id = (SELECT id FROM pipelines WHERE is_default = true)
    WHERE pipeline_id IS NULL
  `);

  // Index for filtering deals by pipeline (board view query)
  pgm.createIndex('deals', 'pipeline_id', { name: 'deals_pipeline_id_idx' });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('deals', 'pipeline_id', { name: 'deals_pipeline_id_idx' });
  pgm.dropColumn('deals', 'pipeline_id');
};
