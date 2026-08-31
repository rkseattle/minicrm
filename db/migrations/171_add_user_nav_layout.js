'use strict';

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // Value list is duplicated from NAV_LAYOUTS in shared/schemas/settingsSchema.ts;
  // migrations cannot import it. Adding a layout means changing both.
  pgm.sql(`
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS nav_layout varchar(20) DEFAULT NULL
        CONSTRAINT users_nav_layout_check
          CHECK (nav_layout IS NULL OR nav_layout IN ('top', 'left', 'hamburger'))
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.users.nav_layout IS
      'Personal navigation layout. NULL means follow the workspace default in system_settings.nav_layout, so a later admin change still propagates.'
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_nav_layout_check`);
  pgm.sql(`ALTER TABLE public.users DROP COLUMN IF EXISTS nav_layout`);
};
