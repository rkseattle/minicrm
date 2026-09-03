'use strict';

/**
 * Adds the body and snippet columns migration 172 reserved for the parser that fills
 * them.
 *
 * Additive, so a rolling deploy is safe forward: a server running the previous build
 * ignores all three. `down` drops them, discarding every synced body.
 *
 * The `message_` prefix is deliberate. `ALWAYS_EXCLUDED_FIELDS` in the AI PII filter
 * matches bare, unqualified column names at every nesting depth, and `notes.body_text`
 * is a live column that the note tools deliberately surface to the model. Bare
 * `body_text` here would strip note bodies from every AI payload.
 *
 * 172 held these back on the rule that an always-null column is worse than an absent
 * one, and that rule still holds — the writer lands on this same branch, so the columns
 * are never released without it. They are split from it only so the schema change and
 * the parser are reviewable apart.
 *
 * Also corrects 172's table comment, which promised bodies were not stored. Corrective
 * rather than an edit to 172, which has already run.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumns('email_messages', {
    message_body_text: {
      type: 'text',
      notNull: false,
      comment:
        'Plain-text body. Taken from the text part where one exists, otherwise converted from the HTML part so a message reads the same either way. Null when neither part exists or the document could not be parsed.',
    },
    message_body_html: {
      type: 'text',
      notNull: false,
      comment:
        'HTML body exactly as the sender wrote it, stored UNSANITIZED. Nothing renders it today; whatever first does must sanitize at render, since sanitizing here would discard markup a renderer needs.',
    },
    message_snippet: {
      type: 'text',
      notNull: false,
      comment:
        'First 200 characters of the plain-text body with whitespace collapsed, for list views that must not load a whole body. Derived from message_body_text, so it is null whenever that is.',
    },
  });

  pgm.sql(
    `COMMENT ON TABLE public.email_messages IS 'Messages synced from a connected mailbox. Headers, metadata, and body text. All three body columns are nullable: a message may store its headers with no body.'`,
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(
    `COMMENT ON TABLE public.email_messages IS 'Messages synced from a connected mailbox. Headers and metadata; bodies are not stored.'`,
  );

  pgm.dropColumns('email_messages', [
    'message_body_text',
    'message_body_html',
    'message_snippet',
  ]);
};
