'use strict';

/**
 * Migration 086: Create ai_configuration table and migrate AI settings out of
 * the system_settings KV blob into a typed, singleton config table. (MINCRM-502)
 *
 * Replaces the 12 AI-related rows that were seeded into system_settings by
 * migration 069. Each column has a well-typed DEFAULT so the row is always
 * well-formed even when migrating from a deployment that never ran migration 069.
 *
 * The table is a singleton — exactly one row is always present. This is
 * enforced by a partial unique index on the boolean constant TRUE, which allows
 * at most one row to satisfy the constraint.
 *
 * dpa_acknowledged_by stores the UUID of the user who acknowledged the DPA.
 * It is nullable because historical data stored a name string in system_settings,
 * which cannot be reliably mapped back to a UUID.
 *
 * The 'ai_enabled_updated_at' field is preserved as a timestamptz column (not
 * listed in the AC but tracked by the service layer and asserted by existing tests).
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE ai_configuration (
      -- Singleton sentinel: always TRUE, unique constraint enforces one row max.
      singleton                       boolean     NOT NULL DEFAULT TRUE,
      provider                        varchar(50) NOT NULL DEFAULT 'anthropic',
      model                           varchar(100) NOT NULL DEFAULT 'claude-sonnet-4-20250514',
      api_key_encrypted               text        NOT NULL DEFAULT '',
      deployment_mode                 varchar(30) NOT NULL DEFAULT 'cloud_api',
      base_url                        text        NOT NULL DEFAULT '',
      enabled                         boolean     NOT NULL DEFAULT false,
      enabled_updated_at              timestamptz,
      dpa_acknowledged                boolean     NOT NULL DEFAULT false,
      dpa_acknowledged_by             uuid        REFERENCES users(id) ON DELETE SET NULL,
      dpa_acknowledged_at             timestamptz,
      dpa_acknowledged_for_provider   varchar(50) NOT NULL DEFAULT '',
      custom_dpa_url                  text        NOT NULL DEFAULT '',
      updated_at                      timestamptz NOT NULL DEFAULT now(),
      updated_by                      uuid        REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT ai_configuration_singleton CHECK (singleton),
      CONSTRAINT ai_configuration_singleton_unique UNIQUE (singleton)
    );

    -- Backfill from system_settings. The WITH clause reads all 12 AI keys
    -- in one pass; COALESCE ensures missing keys fall back to typed defaults.
    WITH ss AS (
      SELECT key, value
      FROM system_settings
      WHERE key IN (
        'ai_enabled', 'ai_enabled_updated_at', 'ai_provider', 'ai_model',
        'ai_api_key', 'ai_deployment_mode', 'ai_base_url',
        'ai_dpa_acknowledged', 'ai_dpa_acknowledged_by',
        'ai_dpa_acknowledged_at', 'ai_dpa_acknowledged_for_provider',
        'ai_custom_dpa_url'
      )
    )
    INSERT INTO ai_configuration (
      singleton,
      provider,
      model,
      api_key_encrypted,
      deployment_mode,
      base_url,
      enabled,
      enabled_updated_at,
      dpa_acknowledged,
      -- dpa_acknowledged_by: historical value was a name string, not a UUID;
      -- no reliable mapping exists, so it is left NULL after migration.
      dpa_acknowledged_by,
      dpa_acknowledged_at,
      dpa_acknowledged_for_provider,
      custom_dpa_url,
      updated_at
    )
    SELECT
      TRUE                                                                                                    AS singleton,
      COALESCE(MAX(CASE WHEN key = 'ai_provider'        THEN NULLIF(value, '')  END), 'anthropic')          AS provider,
      COALESCE(MAX(CASE WHEN key = 'ai_model'           THEN NULLIF(value, '')  END), 'claude-sonnet-4-20250514') AS model,
      COALESCE(MAX(CASE WHEN key = 'ai_api_key'         THEN value              END), '')                   AS api_key_encrypted,
      COALESCE(MAX(CASE WHEN key = 'ai_deployment_mode' THEN NULLIF(value, '')  END), 'cloud_api')          AS deployment_mode,
      COALESCE(MAX(CASE WHEN key = 'ai_base_url'        THEN value              END), '')                   AS base_url,
      COALESCE(MAX(CASE WHEN key = 'ai_enabled'         THEN value              END), 'false') = 'true'     AS enabled,
      CASE
        WHEN MAX(CASE WHEN key = 'ai_enabled_updated_at' THEN NULLIF(value, '') END) IS NOT NULL
        THEN MAX(CASE WHEN key = 'ai_enabled_updated_at' THEN value END)::timestamptz
        ELSE NULL
      END                                                                                                    AS enabled_updated_at,
      COALESCE(MAX(CASE WHEN key = 'ai_dpa_acknowledged'              THEN value END), 'false') = 'true'    AS dpa_acknowledged,
      NULL::uuid                                                                                             AS dpa_acknowledged_by,
      CASE
        WHEN MAX(CASE WHEN key = 'ai_dpa_acknowledged_at' THEN NULLIF(value, '') END) IS NOT NULL
        THEN MAX(CASE WHEN key = 'ai_dpa_acknowledged_at' THEN value END)::timestamptz
        ELSE NULL
      END                                                                                                    AS dpa_acknowledged_at,
      COALESCE(MAX(CASE WHEN key = 'ai_dpa_acknowledged_for_provider' THEN value END), '')                  AS dpa_acknowledged_for_provider,
      COALESCE(MAX(CASE WHEN key = 'ai_custom_dpa_url'                THEN value END), '')                  AS custom_dpa_url,
      now()                                                                                                  AS updated_at
    FROM ss;

    -- If system_settings had no AI rows at all (fresh install), ensure the
    -- singleton row still exists with all defaults.
    INSERT INTO ai_configuration (singleton) VALUES (TRUE)
    ON CONFLICT ON CONSTRAINT ai_configuration_singleton_unique DO NOTHING;

    -- Remove the migrated keys from system_settings.
    DELETE FROM system_settings WHERE key IN (
      'ai_enabled',
      'ai_enabled_updated_at',
      'ai_provider',
      'ai_model',
      'ai_api_key',
      'ai_deployment_mode',
      'ai_base_url',
      'ai_dpa_acknowledged',
      'ai_dpa_acknowledged_by',
      'ai_dpa_acknowledged_at',
      'ai_dpa_acknowledged_for_provider',
      'ai_custom_dpa_url'
    );
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    -- Re-insert the AI keys back into system_settings from ai_configuration,
    -- restoring the pre-migration state as faithfully as possible.
    INSERT INTO system_settings (key, value, updated_at)
    SELECT key, value, now()
    FROM (
      SELECT
        'ai_enabled'                      AS key, enabled::text                           AS value FROM ai_configuration
      UNION ALL SELECT
        'ai_enabled_updated_at',           COALESCE(enabled_updated_at::text, '')         FROM ai_configuration
      UNION ALL SELECT
        'ai_provider',                     provider                                        FROM ai_configuration
      UNION ALL SELECT
        'ai_model',                        model                                           FROM ai_configuration
      UNION ALL SELECT
        'ai_api_key',                      api_key_encrypted                               FROM ai_configuration
      UNION ALL SELECT
        'ai_deployment_mode',              deployment_mode                                 FROM ai_configuration
      UNION ALL SELECT
        'ai_base_url',                     base_url                                        FROM ai_configuration
      UNION ALL SELECT
        'ai_dpa_acknowledged',             dpa_acknowledged::text                          FROM ai_configuration
      UNION ALL SELECT
        'ai_dpa_acknowledged_by',          ''                                              FROM ai_configuration
      UNION ALL SELECT
        'ai_dpa_acknowledged_at',          COALESCE(dpa_acknowledged_at::text, '')        FROM ai_configuration
      UNION ALL SELECT
        'ai_dpa_acknowledged_for_provider', dpa_acknowledged_for_provider                 FROM ai_configuration
      UNION ALL SELECT
        'ai_custom_dpa_url',               custom_dpa_url                                 FROM ai_configuration
    ) AS rows
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

    DROP TABLE ai_configuration;
  `);
};
