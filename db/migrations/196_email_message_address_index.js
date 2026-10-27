/**
 * Indexes every address a synced message carries, so GDPR erasure and export find the
 * data subject's mail without scanning email_messages. Erasure runs that lookup while it
 * holds the lock every sync page and send waits on.
 *
 * email_message_addresses() is IMMUTABLE (lower() and unnest() are), which an expression
 * index requires; queries call the same function so the planner matches the index.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.email_message_addresses(
      from_address text, to_addresses text[], cc_addresses text[], reply_to_addresses text[]
    ) RETURNS text[]
      LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
      SELECT coalesce(array_agg(DISTINCT lower(address)), '{}')
        FROM unnest(array_prepend(from_address,
                    coalesce(to_addresses, '{}') || coalesce(cc_addresses, '{}')
                    || coalesce(reply_to_addresses, '{}'))) AS a(address)
       WHERE address IS NOT NULL
    $$
  `);
  pgm.sql(`
    COMMENT ON FUNCTION public.email_message_addresses(text, text[], text[], text[]) IS
      'Every address a message carries, lowercased. Backs email_messages_addresses_idx.'
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS email_messages_addresses_idx ON public.email_messages
      USING gin (public.email_message_addresses(from_address, to_addresses, cc_addresses,
                                                reply_to_addresses))
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS public.email_messages_addresses_idx`);
  pgm.sql(`DROP FUNCTION IF EXISTS public.email_message_addresses(text, text[], text[], text[])`);
};
