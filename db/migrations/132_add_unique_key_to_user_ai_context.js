/**
 * Migration 132: Add unique constraint on (user_id, key) to user_ai_context.
 *
 * Prevents duplicate key labels per user, which would produce repeated lines
 * in the Claude system prompt preamble and confuse the context proposal
 * deduplication instruction ("Do NOT propose a key that already exists").
 *
 * Duplicate entries are not expected in practice (the UI enforces a single
 * add-form flow), but the constraint makes this a DB-level invariant.
 */

exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      ALTER TABLE user_ai_context
        ADD CONSTRAINT user_ai_context_user_id_key_unique UNIQUE (user_id, key);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_ai_context
      DROP CONSTRAINT IF EXISTS user_ai_context_user_id_key_unique
  `);
};
