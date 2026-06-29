'use strict';

/**
 * Migration 130: Create user_ai_context table.
 *
 * Stores per-user key/value context entries that are injected into every
 * Claude system prompt as a personalisation preamble. Entries are plain text
 * (e.g. key: "a while", value: "30+ days without activity") and are fully
 * user-controlled via the context panel and context proposal flow.
 * (MINCRM-427, MINCRM-428, MINCRM-429, MINCRM-430)
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.user_ai_context (
      id         uuid DEFAULT gen_random_uuid() NOT NULL,
      user_id    uuid NOT NULL,
      key        varchar(100) NOT NULL,
      value      varchar(500) NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT user_ai_context_pkey PRIMARY KEY (id),
      CONSTRAINT user_ai_context_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users(id) ON DELETE CASCADE
    )
  `);

  pgm.sql(`COMMENT ON TABLE public.user_ai_context IS 'Per-user key/value context entries injected into every Claude system prompt as a personalisation preamble. (MINCRM-427)'`);
  pgm.sql(`COMMENT ON COLUMN public.user_ai_context.key IS 'Short label for this preference (e.g. "a while", "high-value"). Max 100 chars.'`);
  pgm.sql(`COMMENT ON COLUMN public.user_ai_context.value IS 'Plain-text definition of the preference (e.g. "30+ days without activity"). Max 500 chars.'`);

  pgm.sql(`CREATE INDEX user_ai_context_user_id_idx ON public.user_ai_context USING btree (user_id)`);

  pgm.sql(`
    DO $$ BEGIN
      CREATE TRIGGER user_ai_context_set_updated_at
        BEFORE UPDATE ON public.user_ai_context
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.user_ai_context`);
};
