'use strict';

/**
 * Migration 087: Create smtp_configuration table and migrate SMTP settings out of
 * the system_settings KV blob into a typed, singleton config table. (MINCRM-502)
 *
 * Replaces the 5 SMTP-related rows seeded into system_settings by migration 036.
 *
 * The column is named 'username' rather than 'user' because 'user' is a reserved
 * word in PostgreSQL and would require double-quoting everywhere.
 *
 * The singleton constraint mirrors the ai_configuration table: a partial unique
 * index on the boolean constant TRUE allows at most one row.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE smtp_configuration (
      -- Singleton sentinel: always TRUE, unique constraint enforces one row max.
      singleton      boolean      NOT NULL DEFAULT TRUE,
      host           varchar(255) NOT NULL DEFAULT '',
      port           integer      NOT NULL DEFAULT 587,
      username       varchar(255) NOT NULL DEFAULT '',
      pass_encrypted text         NOT NULL DEFAULT '',
      enabled        boolean      NOT NULL DEFAULT false,
      updated_at     timestamptz  NOT NULL DEFAULT now(),
      CONSTRAINT smtp_configuration_singleton CHECK (singleton),
      CONSTRAINT smtp_configuration_singleton_unique UNIQUE (singleton)
    );

    -- Backfill from system_settings.
    WITH ss AS (
      SELECT key, value
      FROM system_settings
      WHERE key IN ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass_encrypted', 'smtp_enabled')
    )
    INSERT INTO smtp_configuration (singleton, host, port, username, pass_encrypted, enabled, updated_at)
    SELECT
      TRUE                                                                               AS singleton,
      COALESCE(MAX(CASE WHEN key = 'smtp_host'           THEN value END), '')          AS host,
      COALESCE(MAX(CASE WHEN key = 'smtp_port'           THEN NULLIF(value, '') END),
               '587')::integer                                                          AS port,
      COALESCE(MAX(CASE WHEN key = 'smtp_user'           THEN value END), '')          AS username,
      COALESCE(MAX(CASE WHEN key = 'smtp_pass_encrypted' THEN value END), '')          AS pass_encrypted,
      COALESCE(MAX(CASE WHEN key = 'smtp_enabled'        THEN value END), 'false') = 'true'
                                                                                        AS enabled,
      now()                                                                             AS updated_at
    FROM ss;

    -- If system_settings had no SMTP rows, ensure the singleton row exists.
    INSERT INTO smtp_configuration (singleton) VALUES (TRUE)
    ON CONFLICT ON CONSTRAINT smtp_configuration_singleton_unique DO NOTHING;

    -- Remove the migrated keys from system_settings.
    DELETE FROM system_settings WHERE key IN (
      'smtp_host',
      'smtp_port',
      'smtp_user',
      'smtp_pass_encrypted',
      'smtp_enabled'
    );
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    -- Re-insert the SMTP keys back into system_settings from smtp_configuration.
    INSERT INTO system_settings (key, value, updated_at)
    SELECT key, value, now()
    FROM (
      SELECT 'smtp_host'           AS key, host                AS value FROM smtp_configuration
      UNION ALL SELECT 'smtp_port',         port::text                  FROM smtp_configuration
      UNION ALL SELECT 'smtp_user',         username                    FROM smtp_configuration
      UNION ALL SELECT 'smtp_pass_encrypted', pass_encrypted            FROM smtp_configuration
      UNION ALL SELECT 'smtp_enabled',      enabled::text               FROM smtp_configuration
    ) AS rows
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

    DROP TABLE smtp_configuration;
  `);
};
