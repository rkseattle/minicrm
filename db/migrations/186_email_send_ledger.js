/**
 * Counts a user's sends for the hourly ceiling.
 *
 * A rate-limit counter must outlive the resource it limits use of. Send intents are deleted
 * with their mailbox, so the count lives here instead: keyed by the user alone, holding no
 * message content, and kept only as long as the window needs.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.email_send_ledger (
      id         uuid DEFAULT gen_random_uuid() NOT NULL,
      user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      intent_id  uuid REFERENCES public.email_send_intents(id) ON DELETE SET NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT email_send_ledger_pkey PRIMARY KEY (id)
    )
  `);

  // The ceiling's count and its Retry-After both read one user's newest entries.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS email_send_ledger_user_time_idx
      ON public.email_send_ledger (user_id, created_at)
  `);
  // A refused send removes its entry by intent.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS email_send_ledger_intent_idx
      ON public.email_send_ledger (intent_id)
      WHERE intent_id IS NOT NULL
  `);

  pgm.sql(`
    COMMENT ON TABLE public.email_send_ledger IS
      'One row per send that may have gone out, counted against the user''s hourly ceiling. Outlives the mailbox and the send intent, so disconnecting a mailbox cannot reset the count.'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.email_send_ledger`);
};
