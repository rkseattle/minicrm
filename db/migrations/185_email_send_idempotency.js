/**
 * Makes a send idempotent: a client's retry under the same key never mails twice.
 *
 * Neither Gmail nor Graph deduplicates a submission, and a send whose outcome is unknown
 * invites exactly the retry that would deliver a second copy. The key is the client's,
 * one per compose; the hash of the request body catches a key reused for different mail.
 * The unresolved merge tags are kept so a replay answers exactly as the first send did.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.email_send_intents
      ADD COLUMN IF NOT EXISTS idempotency_key uuid,
      ADD COLUMN IF NOT EXISTS request_hash text,
      ADD COLUMN IF NOT EXISTS unresolved_merge_tags text[] DEFAULT '{}'::text[] NOT NULL
  `);

  // Rows written before a key was required each get one of their own, so none collides.
  pgm.sql(`
    UPDATE public.email_send_intents
       SET idempotency_key = gen_random_uuid(), request_hash = ''
     WHERE idempotency_key IS NULL
  `);

  pgm.sql(`
    ALTER TABLE public.email_send_intents
      ALTER COLUMN idempotency_key SET NOT NULL,
      ALTER COLUMN request_hash SET NOT NULL,
      ADD CONSTRAINT email_send_intents_idempotency_unique UNIQUE (user_id, idempotency_key)
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.email_send_intents.idempotency_key IS
      'The client''s Idempotency-Key, one per compose. A repeat answers from this row instead of sending again.'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.email_send_intents.request_hash IS
      'SHA-256 of the parsed request, keys sorted, so a key reused for different mail is refused rather than replayed.'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.email_send_intents.unresolved_merge_tags IS
      'Template tags the first send could not resolve, so a replay answers exactly as it did.'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.email_send_intents
      DROP CONSTRAINT IF EXISTS email_send_intents_idempotency_unique,
      DROP COLUMN IF EXISTS unresolved_merge_tags,
      DROP COLUMN IF EXISTS request_hash,
      DROP COLUMN IF EXISTS idempotency_key
  `);
};
