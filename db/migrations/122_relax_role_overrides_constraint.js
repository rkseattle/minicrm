'use strict';

/**
 * Migration 122: Relax the role_overrides CHECK constraint so that custom role
 * names can be stored as override keys.
 *
 * The previous `is_valid_role_overrides` function hardcoded allowed keys to the
 * five built-in roles. With MINCRM-565 (custom-role feature flag overrides) keys
 * can now be any non-empty string — the service layer validates them against the
 * live custom_roles table at write time.
 *
 * The updated DB-level function retains a structural check:
 *   - The value must be a JSON object (or NULL).
 *   - Every key must be a non-empty string.
 *   - Every value must be a boolean.
 * (MINCRM-565)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE feature_flags
      DROP CONSTRAINT IF EXISTS feature_flags_role_overrides_valid_shape;

    CREATE OR REPLACE FUNCTION public.is_valid_role_overrides(overrides jsonb)
    RETURNS boolean
    LANGUAGE plpgsql
    IMMUTABLE
    AS $$
      DECLARE
        k text;
        v jsonb;
      BEGIN
        IF overrides IS NULL THEN
          RETURN TRUE;
        END IF;
        IF jsonb_typeof(overrides) <> 'object' THEN
          RETURN FALSE;
        END IF;
        FOR k, v IN SELECT key, value FROM jsonb_each(overrides) LOOP
          IF length(k) = 0 THEN
            RETURN FALSE;
          END IF;
          IF jsonb_typeof(v) <> 'boolean' THEN
            RETURN FALSE;
          END IF;
        END LOOP;
        RETURN TRUE;
      END;
    $$;

    ALTER TABLE feature_flags
      ADD CONSTRAINT feature_flags_role_overrides_valid_shape
        CHECK (public.is_valid_role_overrides(role_overrides));
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE feature_flags
      DROP CONSTRAINT IF EXISTS feature_flags_role_overrides_valid_shape;

    CREATE OR REPLACE FUNCTION public.is_valid_role_overrides(overrides jsonb)
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
          IF k NOT IN ('admin', 'rep', 'manager', 'viewer', 'service_account') THEN
            RETURN FALSE;
          END IF;
        END LOOP;
        RETURN TRUE;
      END;
    $$;

    ALTER TABLE feature_flags
      ADD CONSTRAINT feature_flags_role_overrides_valid_shape
        CHECK (public.is_valid_role_overrides(role_overrides));
  `);
};
