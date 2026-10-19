/**
 * Records a send before it reaches the provider, so a send that went out is never lost.
 *
 * A send writes to two systems, the provider and this database, and nothing makes that
 * pair atomic. What the database alone knows — the record the message was sent from, the
 * activity text — would otherwise exist only in the request, and be gone if the write after
 * the provider's acceptance failed. An intent committed first survives that failure, and
 * the sync engine files the message from it when the Sent copy arrives.
 *
 * Matched to the Sent copy by the provider's id where it is known, else by the Message-ID
 * this application generated, which is why both are unique per mailbox.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.email_send_intents (
      id                   uuid DEFAULT gen_random_uuid() NOT NULL,
      user_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      connected_account_id uuid NOT NULL
                             REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
      rfc_message_id       text NOT NULL,
      provider_message_id  text,
      record_type          varchar(16),
      record_id            uuid,
      activity_notes       text,
      actor_name           text NOT NULL,
      to_addresses         text[] DEFAULT '{}'::text[] NOT NULL,
      cc_addresses         text[] DEFAULT '{}'::text[] NOT NULL,
      status               varchar(16) DEFAULT 'pending' NOT NULL,
      email_message_id     uuid REFERENCES public.email_messages(id) ON DELETE SET NULL,
      created_at           timestamp with time zone DEFAULT now() NOT NULL,
      updated_at           timestamp with time zone DEFAULT now() NOT NULL,
      filed_at             timestamp with time zone,
      CONSTRAINT email_send_intents_pkey PRIMARY KEY (id),
      CONSTRAINT email_send_intents_status_check
        CHECK (status IN ('pending', 'not_sent', 'sent', 'unconfirmed', 'filed')),
      CONSTRAINT email_send_intents_record_type_check
        CHECK (record_type IN ('contact', 'lead', 'account', 'deal')),
      CONSTRAINT email_send_intents_record_pair_check
        CHECK ((record_type IS NULL) = (record_id IS NULL)),
      CONSTRAINT email_send_intents_rfc_unique UNIQUE (connected_account_id, rfc_message_id)
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS email_send_intents_provider_unique
      ON public.email_send_intents (connected_account_id, provider_message_id)
      WHERE provider_message_id IS NOT NULL
  `);

  // Cascade and SET NULL targets: a user or message delete finds its intents by these.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS email_send_intents_user_idx
      ON public.email_send_intents (user_id)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS email_send_intents_message_idx
      ON public.email_send_intents (email_message_id)
      WHERE email_message_id IS NOT NULL
  `);

  // The scheduler's sweep asks for unsettled intents by age on every tick.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS email_send_intents_unsettled_idx
      ON public.email_send_intents (updated_at)
      WHERE status IN ('pending', 'sent')
  `);

  pgm.sql(`
    COMMENT ON TABLE public.email_send_intents IS
      'A send recorded before it reaches the provider. Holds what only this application knows about the send so the message can be filed to its record even when storing it after the send failed.'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.email_send_intents.status IS
      'pending: not yet answered. not_sent: the provider refused and nothing went. sent: accepted, not yet filed. unconfirmed: the outcome is unknown. filed: stored, linked and given its activity.'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.email_send_intents.rfc_message_id IS
      'The Message-ID this application generated, without angle brackets. Matches the Sent copy when the provider id is unknown.'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.email_send_intents`);
};
