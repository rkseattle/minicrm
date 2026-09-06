'use strict';

/**
 * Migration 179 — Correct two email catalog comments that no longer describe the schema.
 *
 * Corrective rather than edits to 172 and 177, which have already run: node-pg-migrate
 * never re-executes an applied migration, so an edit there changes no existing database
 * and leaves `psql \d+` disagreeing with the file.
 *
 * `email_messages` still promised bodies were not stored, which 176 made false when it
 * added the three body columns.
 *
 * `email_message_links` named a contact merge as the only path that moves links rather
 * than dropping them. Lead conversion does the same, and for the same reason — every read
 * hides a converted lead, so links left behind would strand the pre-conversion history.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(
    `COMMENT ON TABLE public.email_messages IS 'Messages synced from a connected mailbox. Headers, metadata, and body text. All three body columns are nullable: a message may store its headers with no body.'`,
  );

  pgm.sql(
    `COMMENT ON TABLE public.email_message_links IS 'Links a synced message to the CRM records its addresses name. record_type + record_id form a polymorphic reference with no FK constraint, because a PostgreSQL FK cannot span several parent tables. Valid record_type values: ''contact'', ''lead'', ''account'', ''deal''. Orphan cleanup is the application''s responsibility: a hard-delete of one of those records must clear its links in the same transaction, and a consolidating path — a contact merge, a lead conversion — must move them to the surviving record rather than drop them. See docs/dev/schema.md — Polymorphic FK Pattern.'`,
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(
    `COMMENT ON TABLE public.email_message_links IS 'Links a synced message to the CRM records its addresses name. record_type + record_id form a polymorphic reference with no FK constraint, because a PostgreSQL FK cannot span several parent tables. Valid record_type values: ''contact'', ''lead'', ''account'', ''deal''. Orphan cleanup is the application''s responsibility: a hard-delete of one of those records must clear its links in the same transaction, and a contact merge must move them to the winner rather than drop them. See docs/dev/schema.md — Polymorphic FK Pattern.'`,
  );

  pgm.sql(
    `COMMENT ON TABLE public.email_messages IS 'Messages synced from a connected mailbox. Headers and metadata; bodies are not stored.'`,
  );
};
