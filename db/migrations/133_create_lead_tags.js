/**
 * Migration 133: Create lead_tags junction table (MINCRM-433)
 *
 * Adds tagging support for leads, mirroring the contact_tags / account_tags /
 * deal_tags pattern. Tags are shared from the global tags pool; this table is
 * the junction between leads and that pool.
 *
 * Indexes mirror the other entity tag tables for consistent query plans.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.lead_tags (
      lead_id    uuid NOT NULL,
      tag_id     uuid NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT lead_tags_pkey PRIMARY KEY (lead_id, tag_id)
    )
  `);

  pgm.sql(`
    ALTER TABLE ONLY public.lead_tags
      ADD CONSTRAINT lead_tags_lead_id_fkey
        FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE
  `);

  pgm.sql(`
    ALTER TABLE ONLY public.lead_tags
      ADD CONSTRAINT lead_tags_tag_id_fkey
        FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS lead_tags_tag_id_index ON public.lead_tags USING btree (tag_id)`);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.lead_tags`);
};
