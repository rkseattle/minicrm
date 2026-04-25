/**
 * Migration 035: Create currencies table (MINCRM-251)
 *
 * Introduces a currencies table to store exchange rates relative to the home currency.
 * The home currency row always has is_home = true and rate_to_home = 1.000000.
 * A partial unique index ensures at most one home row can exist.
 *
 * Seeds USD as the initial home currency.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('currencies', {
    code: {
      type: 'varchar(3)',
      primaryKey: true,
      notNull: true,
    },
    name: {
      type: 'varchar(64)',
      notNull: true,
    },
    symbol: {
      type: 'varchar(8)',
      notNull: true,
    },
    rate_to_home: {
      type: 'numeric(18,6)',
      notNull: true,
    },
    is_home: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Enforce rate_to_home > 0 at the DB level
  pgm.addConstraint('currencies', 'currencies_rate_to_home_positive', {
    check: 'rate_to_home > 0',
  });

  // Partial unique index ensures only one row can have is_home = true
  pgm.sql(
    `CREATE UNIQUE INDEX currencies_home_idx ON currencies (is_home) WHERE is_home = true`,
  );

  // Seed USD as the home currency with rate 1.000000
  pgm.sql(`
    INSERT INTO currencies (code, name, symbol, rate_to_home, is_home)
    VALUES ('USD', 'US Dollar', '$', 1.000000, true)
  `);
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  // Dropping the table also drops the partial unique index and the check constraint
  pgm.dropTable('currencies');
};
