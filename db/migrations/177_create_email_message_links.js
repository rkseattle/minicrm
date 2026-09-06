'use strict';

/**
 * Migration 177 — Create email_message_links, index the addresses matching reads, and
 * seed deal_auto_link.
 *
 * record_type/record_id is the polymorphic pair the schema doc describes: a PostgreSQL FK
 * cannot span four parent tables, so reference integrity is the application's, and every
 * hard-delete path clears its own links.
 *
 * The functional indexes are what make matching affordable. Every stored address is
 * already lowercase — each provider normalizes through messageBody's address parser — so
 * only the CRM side needs LOWER(), and contacts_email_unique_index and leads_email_index
 * are plain btrees on the raw column that cannot serve it.
 *
 * Neither functional index is UNIQUE: declaring one would impose a new uniqueness rule on
 * a column that already has its own, and leads.email has none at all.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.email_message_links (
      id               uuid DEFAULT gen_random_uuid() NOT NULL,
      email_message_id uuid NOT NULL
                         REFERENCES public.email_messages(id) ON DELETE CASCADE,
      record_type      varchar(16) NOT NULL,
      record_id        uuid NOT NULL,
      match_type       varchar(16) NOT NULL,
      created_at       timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT email_message_links_pkey PRIMARY KEY (id),
      CONSTRAINT email_message_links_message_record_unique
        UNIQUE (email_message_id, record_type, record_id),
      CONSTRAINT email_message_links_record_type_check
        CHECK (record_type IN ('contact', 'lead', 'account', 'deal')),
      CONSTRAINT email_message_links_match_type_check
        CHECK (match_type IN ('auto', 'manual'))
    )
  `);

  // Reverse lookup: every read starts from a record and asks which messages name it. The
  // UNIQUE above leads with email_message_id and serves the forward direction.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS email_message_links_record_idx
      ON public.email_message_links (record_type, record_id)
  `);

  pgm.sql(
    `COMMENT ON TABLE public.email_message_links IS 'Links a synced message to the CRM records its addresses name. record_type + record_id form a polymorphic reference with no FK constraint, because a PostgreSQL FK cannot span several parent tables. Valid record_type values: ''contact'', ''lead'', ''account'', ''deal''. Orphan cleanup is the application''s responsibility: a hard-delete of one of those records must clear its links in the same transaction, and a contact merge must move them to the winner rather than drop them. See docs/dev/schema.md — Polymorphic FK Pattern.'`,
  );

  pgm.sql(
    `COMMENT ON COLUMN public.email_message_links.match_type IS 'How the link was made: ''auto'' by the sync engine''s address matching, ''manual'' by a user. A manual link is audited and an automatic one is not, so this also says whether to expect an audit entry.'`,
  );

  // Matching compares LOWER(email) per address per synced page; without these each
  // comparison seq-scans the table. Named for this migration rather than IF NOT EXISTS
  // adopting a pre-existing index, so `down` cannot drop one it did not create.
  pgm.sql(`CREATE INDEX contacts_lower_email_idx ON public.contacts (LOWER(email))`);

  pgm.sql(`CREATE INDEX leads_lower_email_idx ON public.leads (LOWER(email))`);

  pgm.sql(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('deal_auto_link', 'true', now())
    ON CONFLICT (key) DO NOTHING
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM system_settings WHERE key = 'deal_auto_link'`);
  pgm.sql(`DROP INDEX IF EXISTS public.leads_lower_email_idx`);
  pgm.sql(`DROP INDEX IF EXISTS public.contacts_lower_email_idx`);
  pgm.sql(`DROP TABLE IF EXISTS public.email_message_links`);
};
