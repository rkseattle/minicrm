'use strict';

/**
 * Migration 125: Add pii_excluded column to custom_field_definitions.
 *
 * When true, the field's value is stripped from AI tool call payloads before
 * they are sent to the AI provider (MINCRM-422, feeds MINCRM-445).
 *
 * Defaults to FALSE so all existing fields remain included in AI tool calls
 * unless an admin explicitly opts them out.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('custom_field_definitions', {
    pii_excluded: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
  }, { ifNotExists: true });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumn('custom_field_definitions', 'pii_excluded');
};
