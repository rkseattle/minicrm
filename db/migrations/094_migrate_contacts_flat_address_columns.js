/**
 * Migration 094: Migrate flat address columns from contacts to contact_addresses,
 * then drop the deprecated columns.
 *
 * Background: Migration 024 added six flat address columns to contacts. Migration 030
 * introduced contact_addresses for multi-address support and marked the flat columns
 * deprecated. This migration completes the transition.
 *
 * Data safety audit — run before applying to verify no data loss:
 *
 *   -- Contacts with flat address data
 *   SELECT COUNT(*) FROM contacts
 *   WHERE address_line1 IS NOT NULL OR address_line2 IS NOT NULL OR city IS NOT NULL
 *      OR state_region IS NOT NULL OR postal_code IS NOT NULL OR country IS NOT NULL;
 *
 *   -- Contacts with flat data AND an existing default contact_addresses row (will be skipped)
 *   SELECT COUNT(*) FROM contacts c
 *   WHERE (c.address_line1 IS NOT NULL OR c.address_line2 IS NOT NULL OR c.city IS NOT NULL
 *      OR c.state_region IS NOT NULL OR c.postal_code IS NOT NULL OR c.country IS NOT NULL)
 *     AND EXISTS (
 *       SELECT 1 FROM contact_addresses ca
 *       WHERE ca.contact_id = c.id AND ca.is_default = true
 *     );
 *
 *   -- Contacts whose flat data will be migrated (the INSERT below targets these rows)
 *   SELECT COUNT(*) FROM contacts c
 *   WHERE (c.address_line1 IS NOT NULL OR c.address_line2 IS NOT NULL OR c.city IS NOT NULL
 *      OR c.state_region IS NOT NULL OR c.postal_code IS NOT NULL OR c.country IS NOT NULL)
 *     AND NOT EXISTS (
 *       SELECT 1 FROM contact_addresses ca
 *       WHERE ca.contact_id = c.id AND ca.is_default = true
 *     );
 */

exports.up = async (pgm) => {
  // Step 1: Migrate flat address data into contact_addresses.
  // Only copies contacts that have at least one non-null flat address field
  // and do not already have a default contact_addresses row.
  await pgm.db.query(`
    INSERT INTO contact_addresses (
      contact_id,
      label,
      address_line1,
      address_line2,
      city,
      state_region,
      postal_code,
      country,
      is_default
    )
    SELECT
      c.id,
      NULL,
      c.address_line1,
      c.address_line2,
      c.city,
      c.state_region,
      c.postal_code,
      c.country,
      true
    FROM contacts c
    WHERE (
      c.address_line1 IS NOT NULL OR
      c.address_line2 IS NOT NULL OR
      c.city         IS NOT NULL OR
      c.state_region IS NOT NULL OR
      c.postal_code  IS NOT NULL OR
      c.country      IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM contact_addresses ca
      WHERE ca.contact_id = c.id AND ca.is_default = true
    )
  `);

  // Step 2: Drop the deprecated flat address columns.
  pgm.dropColumns('contacts', [
    'address_line1',
    'address_line2',
    'city',
    'state_region',
    'postal_code',
    'country',
  ]);
};

exports.down = async (pgm) => {
  // ⚠ DATA LOSS WARNING: The flat contacts columns hold only one address per contact.
  // This rollback restores only the default contact_addresses row per contact.
  // Any non-default address rows created after up() ran are irrecoverably lost.
  //
  // Pre-rollback data-safety audit — run to understand exposure before applying:
  //
  //   -- Contacts with non-default address rows that will be dropped on rollback
  //   SELECT COUNT(DISTINCT contact_id)
  //   FROM contact_addresses
  //   WHERE is_default = false;
  //
  //   -- Full list of affected contacts
  //   SELECT contact_id, COUNT(*) AS non_default_rows
  //   FROM contact_addresses
  //   WHERE is_default = false
  //   GROUP BY contact_id
  //   ORDER BY non_default_rows DESC;

  // Step 1: Restore the flat address columns (nullable).
  pgm.addColumns('contacts', {
    address_line1: { type: 'varchar(255)', notNull: false },
    address_line2: { type: 'varchar(255)', notNull: false },
    city:          { type: 'varchar(100)', notNull: false },
    state_region:  { type: 'varchar(100)', notNull: false },
    postal_code:   { type: 'varchar(20)',  notNull: false },
    country:       { type: 'varchar(100)', notNull: false },
  });

  // Step 2: Backfill from the default contact_addresses row into flat columns.
  // Only the default row is restored; non-default rows are not representable in
  // the flat schema and are permanently discarded (see warning above).
  await pgm.db.query(`
    UPDATE contacts c
    SET
      address_line1 = ca.address_line1,
      address_line2 = ca.address_line2,
      city          = ca.city,
      state_region  = ca.state_region,
      postal_code   = ca.postal_code,
      country       = ca.country
    FROM contact_addresses ca
    WHERE ca.contact_id = c.id
      AND ca.is_default = true
  `);
};
