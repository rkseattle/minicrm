/**
 * Migration 099: Create currency_rate_history table
 *
 * Records a point-in-time snapshot of each exchange rate whenever it is updated,
 * enabling historical deal value reporting based on the rate that was in effect
 * at the time a deal closed, rather than the current rate.
 *
 * The effective_from timestamp is set by the application immediately before each
 * rate update, so it represents the moment the previous rate expired.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('currency_rate_history', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    code: {
      type: 'varchar(3)',
      notNull: true,
      references: '"currencies"',
      onDelete: 'CASCADE',
    },
    rate_to_home: {
      type: 'numeric(18,6)',
      notNull: true,
    },
    effective_from: {
      type: 'timestamptz',
      notNull: true,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('currency_rate_history', 'currency_rate_history_rate_positive', {
    check: 'rate_to_home > 0',
  });

  // Optimise the most common lookup: "latest rate snapshot for this code at or before date X"
  pgm.createIndex('currency_rate_history', ['code', { name: 'effective_from', sort: 'DESC' }], {
    name: 'currency_rate_history_code_effective_from_idx',
  });
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('currency_rate_history');
};
