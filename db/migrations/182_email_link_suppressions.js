/**
 * Remembers that a user removed an automatic link, so re-derivation cannot undo it.
 *
 * Matching re-derives account and deal links from a message's surviving contact links
 * whenever those relationships change. Without a record of the removal, an unlink is only
 * as durable as the next reassignment, merge or stage change — the endpoint promises the
 * opposite. A tombstone is the smallest thing that survives: the link row is gone, and
 * this says not to write it again.
 *
 * Only automatic links need one. A manual link is never re-derived, so deleting its row
 * is already permanent.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.email_message_link_suppressions (
      id               uuid DEFAULT gen_random_uuid() NOT NULL,
      email_message_id uuid NOT NULL
                         REFERENCES public.email_messages(id) ON DELETE CASCADE,
      record_type      varchar(16) NOT NULL,
      record_id        uuid NOT NULL,
      created_at       timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT email_message_link_suppressions_pkey PRIMARY KEY (id),
      CONSTRAINT email_message_link_suppressions_unique
        UNIQUE (email_message_id, record_type, record_id),
      CONSTRAINT email_message_link_suppressions_record_type_check
        CHECK (record_type IN ('contact', 'lead', 'account', 'deal'))
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.email_message_link_suppressions IS
      'Automatic email-to-record links a user removed. Re-derivation consults this table so an unlink is not undone by a later relationship change.'
  `);

  // Re-derivation asks "is this pair suppressed?" for every candidate it is about to
  // write, so the lookup shape is the whole triple.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS email_message_link_suppressions_lookup_idx
      ON public.email_message_link_suppressions (email_message_id, record_type, record_id)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.email_message_link_suppressions`);
};
