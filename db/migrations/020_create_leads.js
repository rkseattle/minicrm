/**
 * Migration 020: create leads and lead_status_history tables.
 * Adds a dedicated leads entity for unqualified prospects.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // ── leads ──────────────────────────────────────────────────────────────────

  pgm.createTable('leads', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    first_name: {
      type: 'text',
      notNull: true,
    },
    last_name: {
      type: 'text',
      notNull: false,
    },
    email: {
      type: 'text',
      notNull: true,
    },
    phone: {
      type: 'text',
      notNull: false,
    },
    company_name: {
      type: 'text',
      notNull: false,
    },
    lead_source: {
      type: 'text',
      notNull: false,
      check: "lead_source IN ('Web', 'Referral', 'Trade Show', 'Cold Outreach', 'Other')",
    },
    /** lifecycle status */
    status: {
      type: 'text',
      notNull: true,
      default: pgm.func("'New'"),
      check: "status IN ('New', 'Contacted', 'Qualified', 'Disqualified')",
    },
    /** optional free-text reason when status = Disqualified */
    disqualification_reason: {
      type: 'text',
      notNull: false,
    },
    notes: {
      type: 'text',
      notNull: false,
    },
    owner_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    /** set when the lead is converted; lead is never deleted */
    converted_at: {
      type: 'timestamptz',
      notNull: false,
    },
    converted_contact_id: {
      type: 'uuid',
      notNull: false,
      references: 'contacts',
      onDelete: 'SET NULL',
    },
    converted_account_id: {
      type: 'uuid',
      notNull: false,
      references: 'accounts',
      onDelete: 'SET NULL',
    },
    converted_deal_id: {
      type: 'uuid',
      notNull: false,
      references: 'deals',
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

  pgm.createIndex('leads', 'email'); // duplicate detection
  pgm.createIndex('leads', 'owner_id');
  pgm.createIndex('leads', 'status');
  pgm.createIndex('leads', 'created_at');

  // ── lead_status_history ────────────────────────────────────────────────────
  // Records each status change for the activity timeline

  pgm.createTable('lead_status_history', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    lead_id: {
      type: 'uuid',
      notNull: true,
      references: 'leads',
      onDelete: 'CASCADE',
    },
    from_status: {
      type: 'text',
      notNull: false, // null on initial creation
    },
    to_status: {
      type: 'text',
      notNull: true,
    },
    changed_by_id: {
      type: 'uuid',
      notNull: false,
    },
    changed_by_name: {
      type: 'text',
      notNull: false,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('lead_status_history', 'lead_id');

  // ── Back-reference columns on contacts and deals ──────────────────────────
  // Allows contact/deal detail pages to show "Converted from lead …"

  pgm.addColumns('contacts', {
    source_lead_id: {
      type: 'uuid',
      notNull: false,
      references: 'leads',
      onDelete: 'SET NULL',
    },
  });

  pgm.addColumns('deals', {
    source_lead_id: {
      type: 'uuid',
      notNull: false,
      references: 'leads',
      onDelete: 'SET NULL',
    },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumns('deals', ['source_lead_id']);
  pgm.dropColumns('contacts', ['source_lead_id']);
  pgm.dropTable('lead_status_history');
  pgm.dropTable('leads');
};
