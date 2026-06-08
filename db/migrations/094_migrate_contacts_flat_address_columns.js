/**
 * Migration 094: Migrate flat address columns from contacts to contact_addresses,
 * then drop the deprecated columns. (MINCRM-500)
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
  // Rows migrated by the up() will be the sole default address for contacts that
  // had no prior contact_addresses entry — safe to backfill unconditionally from
  // the default row since the columns are empty at this point.
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
