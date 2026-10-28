/**
 * Records, on each send intent, the message it answers or forwards.
 *
 * A send still in flight has no stored message of its own, and its new Message-ID matches
 * nothing in the thread, so marking the thread private can find it only through its parent.
 * ON DELETE SET NULL: a disconnect removes the mailbox's messages but not its intents.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.email_send_intents
      ADD COLUMN IF NOT EXISTS parent_message_id uuid
        REFERENCES public.email_messages(id) ON DELETE SET NULL
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.email_send_intents.parent_message_id IS
      'The message this send answers or forwards; null for a new conversation. Lets a privacy change reach a send not yet stored.'
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS email_send_intents_parent_message_idx
      ON public.email_send_intents (parent_message_id)
      WHERE parent_message_id IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS public.email_send_intents_parent_message_idx`);
  pgm.sql(`ALTER TABLE public.email_send_intents DROP COLUMN IF EXISTS parent_message_id`);
};
