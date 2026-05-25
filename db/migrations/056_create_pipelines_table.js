/**
 * Migration 056: Create pipelines table and add pipeline_id FK to pipeline_stages (MINCRM-397).
 *
 * Introduces multiple pipeline support. A default pipeline is seeded and all
 * existing pipeline_stages rows are linked to it. NULL pipeline_id is reserved
 * for forward-compatibility only; all application code writes an explicit UUID.
 *
 * Unique constraints are updated to be pipeline-scoped:
 *   - name uniqueness: (pipeline_id, lower(name)) instead of just lower(name)
 *   - sort_order uniqueness: (pipeline_id, sort_order) instead of just sort_order
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // 1. Create the pipelines table
  pgm.createTable('pipelines', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
      notNull: true,
    },
    name: {
      type: 'varchar(100)',
      notNull: true,
    },
    is_default: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    created_by: {
      type: 'uuid',
      references: '"users"',
      onDelete: 'SET NULL',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Enforce at most one default pipeline via partial unique index
  pgm.createIndex('pipelines', 'is_default', {
    unique: true,
    name: 'pipelines_single_default_idx',
    where: 'is_default = true',
  });

  // Case-insensitive unique name across all pipelines
  pgm.createIndex('pipelines', 'lower(name)', {
    unique: true,
    name: 'pipelines_name_lower_unique',
  });

  // 2. Seed the default pipeline
  pgm.sql(`
    INSERT INTO pipelines (name, is_default)
    VALUES ('Default', true)
  `);

  // 3. Add pipeline_id FK to pipeline_stages
  pgm.addColumn('pipeline_stages', {
    pipeline_id: {
      type: 'uuid',
      references: '"pipelines"',
      onDelete: 'CASCADE',
      notNull: false,
    },
  });

  // 4. Backfill all existing stages to the default pipeline
  pgm.sql(`
    UPDATE pipeline_stages
    SET pipeline_id = (SELECT id FROM pipelines WHERE is_default = true)
    WHERE pipeline_id IS NULL
  `);

  // 5. Drop the old global unique indexes (per-migration 021 and 022)
  pgm.dropIndex('pipeline_stages', 'sort_order', {
    name: 'pipeline_stages_sort_order_unique_index',
  });
  pgm.dropIndex('pipeline_stages', 'lower(name)', { name: 'pipeline_stages_name_lower_unique' });

  // 6. Add pipeline-scoped unique indexes
  pgm.createIndex('pipeline_stages', ['pipeline_id', 'sort_order'], {
    unique: true,
    name: 'pipeline_stages_pipeline_sort_order_unique',
  });

  // Functional composite index: pgm.func in an array is not supported by node-pg-migrate,
  // so we use raw SQL for the (pipeline_id, lower(name)) unique index.
  pgm.sql(`
    CREATE UNIQUE INDEX pipeline_stages_pipeline_name_lower_unique
    ON pipeline_stages (pipeline_id, lower(name))
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  // Restore global sort_order and name unique indexes
  pgm.dropIndex('pipeline_stages', ['pipeline_id', 'sort_order'], {
    name: 'pipeline_stages_pipeline_sort_order_unique',
  });
  pgm.dropIndex('pipeline_stages', 'lower(name)', {
    name: 'pipeline_stages_pipeline_name_lower_unique',
  });

  pgm.createIndex('pipeline_stages', 'sort_order', {
    unique: true,
    name: 'pipeline_stages_sort_order_index',
  });
  pgm.createIndex('pipeline_stages', 'lower(name)', {
    unique: true,
    name: 'pipeline_stages_name_lower_unique',
  });

  pgm.dropColumn('pipeline_stages', 'pipeline_id');

  pgm.dropTable('pipelines');
};
