'use strict';

/**
 * Migration 167: let the AI cascade log record leads as well as contacts.
 *
 * The table keyed rows on a bare contact_id with no discriminator, so a lead
 * erasure had nowhere unambiguous to write. Additive: contact_id stays and keeps
 * matching only contacts, so existing readers are unaffected.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_gdpr_cascade_log
      ADD COLUMN IF NOT EXISTS record_type varchar(20) NOT NULL DEFAULT 'contact'
        CONSTRAINT ai_gdpr_cascade_log_record_type_check
          CHECK (record_type IN ('contact', 'lead')),
      ADD COLUMN IF NOT EXISTS record_id uuid
  `);

  // Every pre-existing row is a contact cascade — contact_id was the only thing
  // this table could hold before now.
  pgm.sql(`UPDATE ai_gdpr_cascade_log SET record_id = contact_id WHERE record_id IS NULL`);

  pgm.sql(`ALTER TABLE ai_gdpr_cascade_log ALTER COLUMN record_id SET NOT NULL`);

  pgm.sql(`ALTER TABLE ai_gdpr_cascade_log ALTER COLUMN contact_id DROP NOT NULL`);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS ai_gdpr_cascade_log_record_idx
      ON ai_gdpr_cascade_log USING btree (record_type, record_id)
  `);

  pgm.sql(
    `COMMENT ON COLUMN public.ai_gdpr_cascade_log.record_type IS 'Which entity was erased. Leads and contacts both cascade to AI data, and their ids share no namespace.'`,
  );
  pgm.sql(
    `COMMENT ON COLUMN public.ai_gdpr_cascade_log.record_id IS 'UUID of the erased record, in the table named by record_type. No FK — the row is erased in place, and for leads it is not a contact.'`,
  );
  pgm.sql(
    `COMMENT ON COLUMN public.ai_gdpr_cascade_log.contact_id IS 'Superseded by record_id. Mirrors it when record_type is contact, and is NULL otherwise, so a query on this column matches only contacts.'`,
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS ai_gdpr_cascade_log_record_idx`);
  // Lead rows have no contact_id to restore, and the pre-migration schema cannot
  // represent them.
  pgm.sql(`DELETE FROM ai_gdpr_cascade_log WHERE contact_id IS NULL`);
  pgm.sql(`ALTER TABLE ai_gdpr_cascade_log ALTER COLUMN contact_id SET NOT NULL`);
  pgm.sql(`COMMENT ON COLUMN public.ai_gdpr_cascade_log.contact_id IS NULL`);
  pgm.sql(`
    ALTER TABLE ai_gdpr_cascade_log
      DROP COLUMN IF EXISTS record_id,
      DROP COLUMN IF EXISTS record_type
  `);
};
