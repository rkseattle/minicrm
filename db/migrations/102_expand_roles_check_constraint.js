/**
 * Migration 102 — Expand users.role CHECK constraint (MINCRM-533)
 *
 * Adds manager, viewer, and service_account to the allowed role values.
 * Widens the column from varchar(10) to varchar(20) to accommodate the
 * longest new value ('service_account' = 15 chars).
 *
 * down() narrows the column back and restores the two-value constraint.
 * Safe only when no rows with new role values exist at rollback time.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users
      DROP CONSTRAINT users_role_check,
      ALTER COLUMN role TYPE varchar(20),
      ADD CONSTRAINT users_role_check
        CHECK (role IN ('admin', 'rep', 'manager', 'viewer', 'service_account'))
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE users
      DROP CONSTRAINT users_role_check,
      ALTER COLUMN role TYPE varchar(10),
      ADD CONSTRAINT users_role_check
        CHECK (role IN ('admin', 'rep'))
  `);
};
