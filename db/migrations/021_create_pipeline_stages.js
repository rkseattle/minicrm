/**
 * Migration 021: Create pipeline_stages table (MINCRM-180)
 *
 * Moves pipeline stage definitions from a hardcoded Zod enum to a database table
 * so admins can add, rename, reorder, and delete custom stages.
 *
 * The two terminal stages (Closed Won, Closed Lost) are seeded as fixed rows that
 * cannot be deleted or renamed via the admin UI. They are always pinned to the end
 * of the pipeline order.
 *
 * The deals_stage_check CHECK constraint is dropped because stage values are now
 * validated at the application layer against the live pipeline_stages rows.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('pipeline_stages', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
      notNull: true,
    },
    name: {
      type: 'varchar(100)',
      notNull: true,
      unique: true,
    },
    sort_order: {
      type: 'integer',
      notNull: true,
    },
    /** Default probability (0–100) for deals in this stage, used by MINCRM-179 */
    probability: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    /**
     * True for Closed Won / Closed Lost — these stages require a close date,
     * trigger win/loss logic, and drive automation triggers.
     */
    is_terminal: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    /**
     * True for the two built-in terminal stages. Fixed stages cannot be
     * deleted or renamed via the admin API.
     */
    is_fixed: {
      type: 'boolean',
      notNull: true,
      default: false,
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

  // Ensure sort_order values are unique so reorder operations are deterministic
  pgm.createIndex('pipeline_stages', 'sort_order', { unique: true });

  // Probability must be an integer between 0 and 100
  pgm.addConstraint('pipeline_stages', 'pipeline_stages_probability_check', {
    check: 'probability >= 0 AND probability <= 100',
  });

  // Seed the six default stages in pipeline order
  pgm.sql(`
    INSERT INTO pipeline_stages (name, sort_order, probability, is_terminal, is_fixed) VALUES
      ('Prospecting',  10, 10,  false, false),
      ('Qualification',20, 25,  false, false),
      ('Proposal',     30, 50,  false, false),
      ('Negotiation',  40, 75,  false, false),
      ('Closed Won',   50, 100, true,  true),
      ('Closed Lost',  60, 0,   true,  true)
  `);

  // Drop the hardcoded stage CHECK constraint on deals — validation is now
  // handled at the application layer against the pipeline_stages table.
  pgm.dropConstraint('deals', 'deals_stage_check');
};

/**
 * Revert the migration.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  // Restore the original hardcoded stage CHECK constraint
  pgm.addConstraint('deals', 'deals_stage_check', {
    check: `stage IN ('Prospecting','Qualification','Proposal','Negotiation','Closed Won','Closed Lost')`,
  });

  pgm.dropTable('pipeline_stages');
};
