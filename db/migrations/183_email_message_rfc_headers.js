/**
 * Stores each message's own Message-ID and References, which a reply must name.
 *
 * thread_id cannot stand in for either: it is a storage key that may be a provider's native
 * id or a sha256 digest, and neither names a message the recipient's client has seen.
 *
 * No backfill: no mailbox had synced mail when these columns were added.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.email_messages
      ADD COLUMN IF NOT EXISTS rfc_message_id text,
      ADD COLUMN IF NOT EXISTS references_header text
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.email_messages.rfc_message_id IS
      'The message''s own RFC 5322 Message-ID, without angle brackets. A reply names it in In-Reply-To.'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.email_messages.references_header IS
      'Ancestor Message-IDs, bracketed and space-separated, oldest first; bounded to the root plus the newest. A reply extends it.'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.email_messages
      DROP COLUMN IF EXISTS references_header,
      DROP COLUMN IF EXISTS rfc_message_id
  `);
};
