/**
 * Records, on each send intent, the contacts and leads its recipients matched when it was
 * claimed: the intent's equivalent of a synced message's auto-links.
 *
 * Erasure finds a message by its links as well as its addresses, so mail to an address the
 * subject no longer holds (changed, or a merged-away contact's) is still found. An intent has
 * no links, so it is found the same way only through these ids, which merge and lead
 * conversion move to the surviving contact as they move links.
 *
 * Also adds the two case-insensitive address-array functions erasure applies to messages and
 * intents, so callers bind values to them rather than splicing SQL text together. IMMUTABLE,
 * as email_message_addresses() is: lower() and unnest() are.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.address_array_replace(
      addresses text[], address text, replacement text
    ) RETURNS text[]
      LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
      SELECT coalesce(array_agg(CASE WHEN lower(a.item) = $2 THEN $3 ELSE a.item END
                                ORDER BY a.position), '{}')
        FROM unnest($1) WITH ORDINALITY AS a(item, position)
    $$
  `);
  pgm.sql(`
    COMMENT ON FUNCTION public.address_array_replace(text[], text, text) IS
      'The array with every case-insensitive match of a lowercased address replaced, order kept.'
  `);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.address_array_has(addresses text[], address text)
      RETURNS boolean
      LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
      SELECT EXISTS (SELECT 1 FROM unnest($1) AS a(item) WHERE lower(a.item) = $2)
    $$
  `);
  pgm.sql(`
    COMMENT ON FUNCTION public.address_array_has(text[], text) IS
      'True when the array holds a lowercased address in any case.'
  `);
  pgm.sql(`
    ALTER TABLE public.email_send_intents
      ADD COLUMN IF NOT EXISTS recipient_contact_ids uuid[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS recipient_lead_ids uuid[] NOT NULL DEFAULT '{}'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.email_send_intents.recipient_contact_ids IS
      'Contacts whose address the recipients named at claim time; erasure finds the intent by them.'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.email_send_intents.recipient_lead_ids IS
      'Unconverted leads the recipients named at claim time where no contact held the address.'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP FUNCTION IF EXISTS public.address_array_has(text[], text)`);
  pgm.sql(`DROP FUNCTION IF EXISTS public.address_array_replace(text[], text, text)`);
  pgm.sql(`
    ALTER TABLE public.email_send_intents
      DROP COLUMN IF EXISTS recipient_contact_ids,
      DROP COLUMN IF EXISTS recipient_lead_ids
  `);
};
