/**
 * The one definition of which CRM records an email address names: every contact holding it,
 * and an unconverted lead holding it only where no contact does. Auto-linking a synced
 * message and recording a send's recipients both call it, so the precedence cannot drift.
 *
 * STABLE (it reads tables) and a single statement, so the planner can inline it and still
 * use contacts_lower_email_idx and leads_lower_email_idx.
 */

'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
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
  pgm.sql(`
    COMMENT ON FUNCTION public.address_matched_records(text[]) IS
      'Records each lowercased address names: its contacts, else its unconverted leads.'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP FUNCTION IF EXISTS public.address_matched_records(text[])`);
};
