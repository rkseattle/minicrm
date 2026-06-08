'use strict';

/**
 * Migration 089: Add CHECK constraint on feature_flags.role_overrides to enforce
 * valid key names at the DB layer, and document the transitional status of the
 * column. (MINCRM-511)
 *
 * The valid shape is: null, or a JSON object whose keys are exclusively valid
 * role names ('admin', 'rep') and whose values are booleans.
 *
 * PostgreSQL CHECK constraints cannot contain subqueries, so we implement the
 * key validation via a dedicated immutable function that iterates jsonb keys
 * and returns false on any unknown key. The CHECK calls this function.
 *
 * role_overrides is a transitional column: MINCRM-487 will introduce first-class
 * user-level override tables. Once that epic is live, role_overrides will be
 * dropped. See featureFlagSchema.ts for documentation.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // Immutable function so the CHECK can be evaluated efficiently.
  // Returns TRUE if overrides is NULL, an empty object, or an object whose
  // keys are all valid role names. Individual value types (boolean) are
  // enforced at the application layer.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION is_valid_role_overrides(overrides jsonb)
      RETURNS boolean
      LANGUAGE plpgsql
      IMMUTABLE
    AS $$
    DECLARE
      k text;
    BEGIN
      IF overrides IS NULL THEN
        RETURN TRUE;
      END IF;
      IF jsonb_typeof(overrides) <> 'object' THEN
        RETURN FALSE;
      END IF;
      FOR k IN SELECT jsonb_object_keys(overrides) LOOP
        IF k NOT IN ('admin', 'rep') THEN
          RETURN FALSE;
        END IF;
      END LOOP;
      RETURN TRUE;
    END;
    $$
  `);

  pgm.sql(`
    ALTER TABLE feature_flags
      ADD CONSTRAINT feature_flags_role_overrides_valid_shape
        CHECK (is_valid_role_overrides(role_overrides))
  `);

  pgm.sql(`
    COMMENT ON COLUMN feature_flags.role_overrides IS
      'Transitional column: per-role enable/disable overrides. Keys must be valid role names (admin, rep), values are booleans. Will be superseded by MINCRM-487 targeting tables and dropped once that epic is live.'
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    COMMENT ON COLUMN feature_flags.role_overrides IS NULL;
    ALTER TABLE feature_flags DROP CONSTRAINT IF EXISTS feature_flags_role_overrides_valid_shape;
    DROP FUNCTION IF EXISTS is_valid_role_overrides(jsonb);
  `);
};
