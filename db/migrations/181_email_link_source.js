/**
 * Records who created an email message link, separately from how it was matched.
 *
 * `match_type` already says auto or manual, but that is the matching mechanism, not the
 * actor: a manual link filed by a person and one filed on their behalf are both 'manual'.
 * NULL means a person, matching `audit_log.source`, whose NULL rows are human-originated —
 * so the two columns read the same way and a future AI-assisted filing path has somewhere
 * to record itself.
 *
 * Auto-links are deliberately not audited, so this column is the only record that the
 * engine rather than a user put the row there.
 */

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.email_message_links
      ADD COLUMN IF NOT EXISTS source varchar(16)
  `);
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE public.email_message_links
        ADD CONSTRAINT email_message_links_source_check
        CHECK (source IS NULL OR source = 'system');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN duplicate_table THEN NULL;
    END $$
  `);

  // Every row written before this migration came from the matcher, since the manual
  // endpoints and the engine shipped together and the engine wrote all four rules.
  pgm.sql(`
    UPDATE public.email_message_links SET source = 'system'
     WHERE match_type = 'auto' AND source IS NULL
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.email_message_links.source IS
      'system when the matching engine created the link; NULL when a person did'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.email_message_links
      DROP CONSTRAINT IF EXISTS email_message_links_source_check
  `);
  pgm.sql(`ALTER TABLE public.email_message_links DROP COLUMN IF EXISTS source`);
};
