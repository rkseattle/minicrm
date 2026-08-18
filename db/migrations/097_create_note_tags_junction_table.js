'use strict';

/**
 * Migration 097: Replace notes.tags text[] with a note_tags junction table.
 *
 * The notes table stored tags as a free-text array, bypassing the governed tag system
 * (tags table + junction tables) used by contacts, accounts, and deals. Note tags
 * therefore ignored tags_restrict_creation, were invisible in tag management UI, and
 * could not be searched alongside entity tags.
 *
 * This migration:
 *   1. Creates the note_tags junction table matching the pattern of contact_tags etc.
 *   2. Backfills existing notes.tags values: each tag string is upserted (lowercased,
 *      trimmed) into the tags table, then linked via note_tags.
 *   3. Drops the notes.tags column.
 *
 * Down migration reverses this: re-adds notes.tags, repopulates it from note_tags,
 * then drops note_tags.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // 1. Create note_tags junction table
  pgm.createTable('note_tags', {
    note_id: {
      type: 'uuid',
      notNull: true,
      references: 'notes(id)',
      onDelete: 'CASCADE',
    },
    tag_id: {
      type: 'uuid',
      notNull: true,
      references: 'tags(id)',
      onDelete: 'CASCADE',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.addConstraint('note_tags', 'note_tags_pkey', 'PRIMARY KEY (note_id, tag_id)');
  pgm.createIndex('note_tags', 'tag_id');

  // 2. Backfill: for every non-empty tag string in notes.tags, upsert into tags and link.
  // Step 2a — collect distinct non-empty tag names from all notes
  // Step 2b — upsert each into the tags table (CTE with data-modifying statement)
  // Step 2c — insert junction rows by joining back to the now-populated tags table
  pgm.sql(`
    WITH raw_tags AS (
      SELECT DISTINCT lower(trim(raw_tag)) AS name
      FROM notes
      CROSS JOIN LATERAL unnest(tags) AS raw_tag
      WHERE trim(raw_tag) <> ''
    ),
    upserted AS (
      INSERT INTO tags (name)
      SELECT name FROM raw_tags
      ON CONFLICT (name) DO UPDATE SET updated_at = now()
      RETURNING id, name
    )
    INSERT INTO note_tags (note_id, tag_id)
    SELECT DISTINCT n.id, t.id
    FROM notes n
    CROSS JOIN LATERAL unnest(n.tags) AS raw_tag
    JOIN upserted t ON t.name = lower(trim(raw_tag))
    WHERE trim(raw_tag) <> ''
    ON CONFLICT DO NOTHING;
  `);

  // 3. Drop the now-redundant text[] column
  pgm.dropColumn('notes', 'tags');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  // Re-add the column
  pgm.addColumn('notes', {
    tags: {
      type: 'text[]',
      notNull: true,
      default: '{}',
    },
  });

  // Repopulate from note_tags
  pgm.sql(`
    UPDATE notes n
    SET tags = (
      SELECT COALESCE(array_agg(t.name ORDER BY t.name), ARRAY[]::text[])
      FROM note_tags nt
      JOIN tags t ON t.id = nt.tag_id
      WHERE nt.note_id = n.id
    );
  `);

  // Drop junction table
  pgm.dropTable('note_tags');
};
