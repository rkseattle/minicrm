/**
 * address_matched_records() answers each distinct address once. A sync page repeats an
 * address for every message naming it, and the function ran its join once per repeat; the
 * callers' DISTINCT hid the duplicates but not the work. Deduplicating here covers every caller.
 */

'use strict';

exports.shorthands = undefined;

const COMMENT = `
    COMMENT ON FUNCTION public.address_matched_records(text[]) IS
      'Records each lowercased address names: its contacts, else its unconverted leads.'
`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.address_matched_records(addresses text[])
      RETURNS TABLE (address text, record_type text, record_id uuid)
      LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
      WITH named AS (SELECT DISTINCT unnest($1) AS address)
      SELECT named.address, 'contact'::text, c.id
        FROM named
        JOIN public.contacts c ON lower(c.email) = named.address
      UNION ALL
      SELECT named.address, 'lead'::text, l.id
        FROM named
        JOIN public.leads l ON lower(l.email) = named.address
       WHERE l.converted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE lower(c.email) = named.address)
    $$
  `);
  pgm.sql(COMMENT);
};

exports.down = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.address_matched_records(addresses text[])
      RETURNS TABLE (address text, record_type text, record_id uuid)
      LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
      SELECT named.address, 'contact'::text, c.id
        FROM unnest($1) AS named(address)
        JOIN public.contacts c ON lower(c.email) = named.address
      UNION ALL
      SELECT named.address, 'lead'::text, l.id
        FROM unnest($1) AS named(address)
        JOIN public.leads l ON lower(l.email) = named.address
       WHERE l.converted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE lower(c.email) = named.address)
    $$
  `);
  pgm.sql(COMMENT);
};
