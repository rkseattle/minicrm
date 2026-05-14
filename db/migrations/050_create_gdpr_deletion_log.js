'use strict';
exports.shorthands = undefined;
exports.up = (pgm) => {
  pgm.createTable('gdpr_deletion_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    record_type: { type: 'text', notNull: true },
    record_id: { type: 'uuid', notNull: true },
    requested_by: { type: 'uuid', notNull: true, references: '"users"' },
    requested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at: { type: 'timestamptz', notNull: false },
    erasure_scope: { type: 'text[]', notNull: true },
    notes: { type: 'text', notNull: false },
  });
  pgm.createIndex('gdpr_deletion_log', ['record_type', 'record_id'], { unique: true, name: 'gdpr_deletion_log_record_idx' });
};
exports.down = (pgm) => {
  pgm.dropTable('gdpr_deletion_log');
};
