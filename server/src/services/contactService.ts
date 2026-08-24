/**
 * Contact service — business logic for contact CRUD operations.
 * All database access for contacts goes through this module.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CreateContactInput,
  UpdateContactInput,
} from '@minicrm/shared/schemas/contactSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import { fireAutomationTrigger } from './automationService.js';
import { dispatchWebhookEvent } from './webhookService.js';
import { writeAuditEntry, writeAuditEntries, diffFields } from './auditService.js';
import type { AuditActor, AuditEntryInput } from './auditService.js';
import { setRlsUserId, withRlsQuery } from './rlsContextService.js';
import { softDeleteNotesByEntity } from './noteService.js';
import { buildVisibilityFilter, validateReassignment } from './visibilityService.js';

const SYSTEM_ACTOR: AuditActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

/** Columns that may be updated via updateContact — guards against SQL injection from dynamic field names */
const ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateContactInput> = new Set([
  'first_name',
  'last_name',
  'email',
  'phone',
  'title',
  'department',
  'account_id',
  'owner_id',
  // Social profile URLs
  'linkedin_url',
  'twitter_x_url',
  'other_url',
]);

/** Minimal tag shape embedded in list responses */
export interface EmbeddedTag {
  id: string;
  name: string;
}

/** Default address embedded in contact responses (sourced from contact_addresses) */
export interface ContactDefaultAddress {
  id: string;
  label: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  country: string | null;
}

/** Shape of a contact row returned from the database */
export interface ContactRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  title: string | null;
  /** Timestamp of the most recent change to `title` specifically */
  title_updated_at: Date | null;
  department: string | null;
  account_id: string | null;
  owner_id: string;
  // Social profile URLs
  linkedin_url: string | null;
  twitter_x_url: string | null;
  other_url: string | null;
  created_at: Date;
  updated_at: Date;
  /** Optimistic lock version */
  version: number;
  /** Default address from contact_addresses — null when no default row exists */
  default_address: ContactDefaultAddress | null;
  /** Tags attached to this contact — only populated in list responses */
  tags?: EmbeddedTag[];
}

/** Columns that may be used for ORDER BY in listContacts */
export const CONTACT_SORT_COLUMNS = ['created_at', 'first_name', 'last_name', 'email'] as const;
export type ContactSortColumn = (typeof CONTACT_SORT_COLUMNS)[number];

/** Options for filtering and paginating the contacts list */
interface ListContactsOptions {
  /** When provided, only contacts with this owner_id are returned */
  ownerId?: string;
  /** When provided, only contacts whose owner_id is in this set are returned */
  ownerIds?: string[];
  /** When provided, only contacts linked to this account_id are returned */
  accountId?: string;
  /**
   * When provided, contacts are filtered by a case-insensitive substring match
   * across first_name, last_name, and email.
   */
  search?: string;
  /**
   * When provided, only contacts whose linked account name contains this
   * string (case-insensitive) are returned.
   */
  accountSearch?: string;
  /** Column to sort by; defaults to 'created_at' */
  sort?: ContactSortColumn;
  /** Sort direction; defaults to 'ASC' */
  dir?: 'ASC' | 'DESC';
  /** 1-based page number; defaults to 1 */
  page?: number;
  /** Records per page; defaults to 50 */
  limit?: number;
  /** When provided, only contacts tagged with at least one of these tag IDs are returned */
  tagIds?: string[];
  /** When provided, the org visibility policy is enforced for this user */
  requestingUser?: { id: string; role: string };
}

/**
 * Creates a new contact record and writes an audit entry in the same transaction.
 *
 * @param params - Contact fields plus the owner's user ID
 * @param actor - User performing the action (for audit log)
 * @returns The inserted contact row
 */
export async function createContact(
  params: CreateContactInput & { owner_id: string },
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<ContactRow> {
  const {
    first_name,
    last_name,
    email,
    phone,
    title,
    department,
    account_id,
    owner_id,
    // Address fields are written to contact_addresses, not contacts
    address_line1,
    address_line2,
    city,
    state_region,
    postal_code,
    country,
    linkedin_url,
    twitter_x_url,
    other_url,
  } = params;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    const result = await client.query<ContactRow>(
      `INSERT INTO contacts (
         first_name, last_name, email, phone, title, department, account_id, owner_id,
         linkedin_url, twitter_x_url, other_url
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        first_name,
        last_name,
        email.toLowerCase(),
        phone ?? null,
        title ?? null,
        department ?? null,
        account_id ?? null,
        owner_id,
        linkedin_url ?? null,
        twitter_x_url ?? null,
        other_url ?? null,
      ],
    );

    const contact = result.rows[0];

    // If any address field was supplied, create a default contact_addresses row
    // in the same transaction.
    const hasAddress =
      address_line1 || address_line2 || city || state_region || postal_code || country;
    if (hasAddress) {
      await client.query(
        `INSERT INTO contact_addresses
           (contact_id, label, address_line1, address_line2, city, state_region, postal_code, country, is_default)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, true)`,
        [
          contact.id,
          address_line1 ?? null,
          address_line2 ?? null,
          city ?? null,
          state_region ?? null,
          postal_code ?? null,
          country ?? null,
        ],
      );
    }

    // Audit: record created
    await writeAuditEntry(client, {
      recordType: 'contact',
      recordId: contact.id,
      recordName: `${contact.first_name} ${contact.last_name}`,
      eventType: 'created',
      changedById: actor.id,
      changedByName: actor.name,
      source: actor.source ?? null,
    });

    await client.query('COMMIT');

    // Re-fetch with default_address joined — RETURNING * on contacts does not include the
    // address sub-resource written above.
    const enriched = (await findContactById(contact.id)) ?? contact;

    // Fire-and-forget: fireAutomationTrigger swallows all internal errors and logs them.
    // Unhandled rejections are caught by the global handler in server.ts.
    void fireAutomationTrigger('contact_created', {
      recordId: contact.id,
      recordType: 'contact',
      ownerId: owner_id,
    });

    void dispatchWebhookEvent('contact.created', enriched as unknown as Record<string, unknown>);

    return enriched;
  } catch (error) {
    await client.query('ROLLBACK');
    // PostgreSQL error code 23505 = unique_violation — catches concurrent inserts
    // that both bypass the service-layer duplicate check (TOCTOU race).
    if ((error as { code?: string }).code === '23505') {
      throw Object.assign(new Error('A contact with this email address already exists'), {
        code: 'DUPLICATE_EMAIL',
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Finds a contact by email address (case-insensitive).
 * Used for duplicate detection on contact creation.
 *
 * @param email - Email address to search for
 * @param excludeId - Optional contact UUID to exclude (e.g. the contact being updated)
 * @returns The matching contact row, or null if not found
 */
export async function findContactByEmail(
  email: string,
  excludeId?: string,
): Promise<ContactRow | null> {
  // Uses pool.query (superuser, bypasses RLS) so duplicate-email detection is
  // global across all users — two reps cannot independently create contacts
  // with the same email address.
  if (excludeId) {
    const result = await pool.query<ContactRow>(
      'SELECT * FROM contacts WHERE LOWER(email) = LOWER($1) AND id != $2 LIMIT 1',
      [email, excludeId],
    );
    return result.rows[0] ?? null;
  }

  const result = await pool.query<ContactRow>(
    'SELECT * FROM contacts WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email],
  );
  return result.rows[0] ?? null;
}

/**
 * Finds a contact by its UUID.
 *
 * @param id - Contact UUID
 * @returns The contact row, or null if not found
 */
export async function findContactById(id: string): Promise<ContactRow | null> {
  const result = await withRlsQuery((client) =>
    client.query<ContactRow>(
      `SELECT c.*,
        CASE WHEN ca.id IS NOT NULL THEN JSON_BUILD_OBJECT(
          'id', ca.id, 'label', ca.label,
          'address_line1', ca.address_line1, 'address_line2', ca.address_line2,
          'city', ca.city, 'state_region', ca.state_region,
          'postal_code', ca.postal_code, 'country', ca.country
        ) ELSE NULL END AS default_address
       FROM contacts c
       LEFT JOIN contact_addresses ca ON ca.contact_id = c.id AND ca.is_default = true
       WHERE c.id = $1
       LIMIT 1`,
      [id],
    ),
  );

  return result.rows[0] ?? null;
}

/**
 * Returns a paginated list of contacts, optionally filtered and sorted.
 *
 * @param options - Filters, sort, and pagination options
 * @returns Paginated response with contact rows and total count
 */
export async function listContacts(
  options: ListContactsOptions = {},
): Promise<PaginatedResponse<ContactRow>> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.ownerId) {
    values.push(options.ownerId);
    conditions.push(`c.owner_id = $${values.length}`);
  }

  if (options.ownerIds && options.ownerIds.length > 0) {
    values.push(options.ownerIds);
    conditions.push(`c.owner_id = ANY($${values.length}::uuid[])`);
  }

  if (options.accountId) {
    values.push(options.accountId);
    conditions.push(`c.account_id = $${values.length}`);
  }

  if (options.search) {
    const pattern = `%${options.search}%`;
    values.push(pattern);
    const idx = values.length;
    conditions.push(
      `(c.first_name ILIKE $${idx} OR c.last_name ILIKE $${idx} OR c.email ILIKE $${idx})`,
    );
  }

  const needsAccountJoin = Boolean(options.accountSearch);

  if (options.accountSearch) {
    const pattern = `%${options.accountSearch}%`;
    values.push(pattern);
    conditions.push(`a.name ILIKE $${values.length}`);
  }

  // Tag filter — any-match: contact must have at least one of the given tag IDs
  if (options.tagIds && options.tagIds.length > 0) {
    const placeholders = options.tagIds.map((_, i) => `$${values.length + i + 1}`).join(', ');
    options.tagIds.forEach((tid) => values.push(tid));
    conditions.push(
      `EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id IN (${placeholders}))`,
    );
  }

  // Org visibility policy enforcement
  if (options.requestingUser) {
    const visFilter = await buildVisibilityFilter(
      'contact',
      options.requestingUser.id,
      options.requestingUser.role,
      'c.owner_id',
      values.length + 1,
    );
    if (visFilter.clause) {
      visFilter.params.forEach((p) => values.push(p));
      conditions.push(visFilter.clause);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const fromClause = needsAccountJoin
    ? 'FROM contacts c LEFT JOIN accounts a ON c.account_id = a.id LEFT JOIN contact_addresses ca ON ca.contact_id = c.id AND ca.is_default = true'
    : 'FROM contacts c LEFT JOIN contact_addresses ca ON ca.contact_id = c.id AND ca.is_default = true';

  // Allowlist-validated sort column and direction
  const sortCol = (CONTACT_SORT_COLUMNS as readonly string[]).includes(options.sort ?? '')
    ? options.sort!
    : 'created_at';
  const sortDir = options.dir === 'DESC' ? 'DESC' : 'ASC';

  const page = options.page ?? 1;
  const limit = options.limit ?? 50;
  const offset = (page - 1) * limit;

  // Embed tags via lateral subquery — avoids N+1 without separate API calls
  const tagsSubquery = `
    COALESCE((
      SELECT JSON_AGG(JSON_BUILD_OBJECT('id', t.id, 'name', t.name) ORDER BY t.name)
      FROM contact_tags ct INNER JOIN tags t ON t.id = ct.tag_id
      WHERE ct.contact_id = c.id
    ), '[]'::json) AS tags`;

  // Embed default address as a JSON object
  const defaultAddressSubquery = `
    CASE WHEN ca.id IS NOT NULL THEN JSON_BUILD_OBJECT(
      'id', ca.id, 'label', ca.label,
      'address_line1', ca.address_line1, 'address_line2', ca.address_line2,
      'city', ca.city, 'state_region', ca.state_region,
      'postal_code', ca.postal_code, 'country', ca.country
    ) ELSE NULL END AS default_address`;

  // Run count and data queries in parallel
  const [countResult, dataResult] = await Promise.all([
    withRlsQuery((client) =>
      client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM contacts c ${needsAccountJoin ? 'LEFT JOIN accounts a ON c.account_id = a.id' : ''} ${whereClause}`,
        values,
      ),
    ),
    withRlsQuery((client) =>
      client.query<ContactRow>(
        `SELECT c.*, ${tagsSubquery}, ${defaultAddressSubquery} ${fromClause} ${whereClause} ORDER BY c.${sortCol} ${sortDir} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
    ),
  ]);

  return {
    data: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  };
}

/**
 * Updates one or more fields on an existing contact and writes per-field audit entries.
 *
 * @param id - Contact UUID
 * @param params - Fields to update (at least one required)
 * @param actor - User performing the action (for audit log)
 * @param before - Snapshot of the contact before update (used for diff)
 * @returns The updated contact row, or null if not found
 */
/** Address fields accepted in updateContact — forwarded to contact_addresses */
const ADDRESS_UPDATE_FIELDS = [
  'address_line1',
  'address_line2',
  'city',
  'state_region',
  'postal_code',
  'country',
] as const;
type AddressUpdateField = (typeof ADDRESS_UPDATE_FIELDS)[number];

export async function updateContact(
  id: string,
  params: UpdateContactInput,
  actor: AuditActor = SYSTEM_ACTOR,
  before?: ContactRow,
  requestingUser?: { id: string; role: string },
): Promise<ContactRow | null> {
  // Managers may only reassign records to users within their own team(s)
  if (params.owner_id !== undefined && requestingUser) {
    await validateReassignment(params.owner_id, requestingUser);
  }

  const { version, ...rest } = params;
  const normalized: Omit<UpdateContactInput, 'version'> = {
    ...rest,
    ...(rest.email !== undefined ? { email: rest.email.toLowerCase() } : {}),
  };
  const fields = (Object.keys(normalized) as (keyof typeof normalized)[]).filter((field) =>
    ALLOWED_UPDATE_FIELDS.has(field as keyof UpdateContactInput),
  );

  // Extract any address fields supplied in the update payload
  const addressFields = ADDRESS_UPDATE_FIELDS.filter(
    (f) => (normalized as Record<string, unknown>)[f] !== undefined,
  );
  const addressUpdate =
    addressFields.length > 0
      ? (Object.fromEntries(
          addressFields.map((f) => [f, (normalized as Record<string, unknown>)[f] ?? null]),
        ) as Partial<Record<AddressUpdateField, string | null>>)
      : null;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    let contact: ContactRow | null;

    if (fields.length === 0) {
      // Payload contains only address fields (+ version) — no scalar contact columns to update.
      // Still bump updated_at and version so the optimistic lock is consumed and concurrent
      // address-only PATCHes with the same version are correctly rejected.
      const result = await client.query<ContactRow>(
        `UPDATE contacts
         SET updated_at = now(), version = version + 1
         WHERE id = $1 AND version = $2
         RETURNING *`,
        [id, version],
      );
      if (result.rowCount === 0) {
        // Distinguish NOT_FOUND from version mismatch
        const check = await client.query<{ id: string }>('SELECT id FROM contacts WHERE id = $1', [
          id,
        ]);
        if (check.rows.length === 0) {
          await client.query('ROLLBACK');
          return null;
        }
        throw Object.assign(
          new Error(
            'This record was modified by another user while you were editing it. Please reload to see the latest version.',
          ),
          { code: 'OPTIMISTIC_LOCK_CONFLICT', entity: 'contact', recordId: id },
        );
      }
      contact = result.rows[0] ?? null;
    } else {
      // Build dynamic SET clause: first_name = $2, last_name = $3, ..., version = version + 1
      // $1=id, $2...$N=field values, $(N+1)=version
      const setClauses = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
      const versionParam = fields.length + 2;

      // Stamp title_updated_at only when title is actually changing — updated_at
      // bumps on any field edit, so it can't answer "how long has the title been
      // stale" on its own.
      const titleChanging =
        fields.includes('title') && before !== undefined && normalized.title !== before.title;
      const titleUpdatedAtClause = titleChanging ? ', title_updated_at = now()' : '';

      const result = await client.query<ContactRow>(
        `UPDATE contacts
         SET ${setClauses}, updated_at = now()${titleUpdatedAtClause}, version = version + 1
         WHERE id = $1 AND version = $${versionParam}
         RETURNING *`,
        [id, ...fields.map((f) => normalized[f as keyof typeof normalized]), version],
      );

      if (result.rowCount === 0) {
        // Distinguish NOT_FOUND from version mismatch
        const check = await client.query<{ id: string }>('SELECT id FROM contacts WHERE id = $1', [
          id,
        ]);
        if (check.rows.length === 0) {
          await client.query('ROLLBACK');
          return null;
        }
        throw Object.assign(
          new Error(
            'This record was modified by another user while you were editing it. Please reload to see the latest version.',
          ),
          { code: 'OPTIMISTIC_LOCK_CONFLICT', entity: 'contact', recordId: id },
        );
      }

      contact = result.rows[0] ?? null;
    }

    // Forward address fields to the default contact_addresses row.
    // Upserts the existing default row if one exists; inserts a new default row otherwise.
    if (contact && addressUpdate) {
      const addrCols = Object.keys(addressUpdate) as AddressUpdateField[];
      const setClauses = addrCols.map((col, i) => `${col} = $${i + 2}`).join(', ');
      await client.query(
        `INSERT INTO contact_addresses (contact_id, is_default, ${addrCols.join(', ')})
         VALUES ($1, true, ${addrCols.map((_, i) => `$${i + 2}`).join(', ')})
         ON CONFLICT (contact_id) WHERE is_default = true
         DO UPDATE SET ${setClauses}, updated_at = now()`,
        [id, ...addrCols.map((col) => addressUpdate[col])],
      );
    }

    if (contact && before) {
      // Audit: per-field diff
      const auditBase = {
        recordType: 'contact' as const,
        recordId: contact.id,
        recordName: `${contact.first_name} ${contact.last_name}`,
        changedById: actor.id,
        changedByName: actor.name,
        source: actor.source ?? null,
      };

      const fieldEntries = diffFields(
        before as unknown as Record<string, unknown>,
        contact as unknown as Record<string, unknown>,
        auditBase,
      );

      // If ownership changed, also write an ownership_reassigned event
      const ownershipEntries: AuditEntryInput[] = [];
      if (params.owner_id !== undefined && params.owner_id !== before.owner_id) {
        ownershipEntries.push({
          ...auditBase,
          eventType: 'ownership_reassigned',
        });
      }

      await writeAuditEntries(client, [...fieldEntries, ...ownershipEntries]);
    }

    await client.query('COMMIT');

    // Re-fetch with default_address joined — RETURNING * on contacts does not include the
    // address sub-resource.
    const enriched = contact ? ((await findContactById(contact.id)) ?? contact) : null;

    if (enriched) {
      void dispatchWebhookEvent(
        'contact.updated',
        enriched as unknown as Record<string, unknown>,
        before ? (before as unknown as Record<string, unknown>) : undefined,
      );
    }

    return enriched;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Shape of a contact row enriched with display names for CSV export */
export interface ContactExportRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  title: string | null;
  department: string | null;
  // Address fields sourced from the default contact_addresses row
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  country: string | null;
  // Social profile URLs
  linkedin_url: string | null;
  twitter_x_url: string | null;
  other_url: string | null;
  account_name: string | null;
  owner_name: string;
  created_at: Date;
  updated_at: Date;
}

/** Options for filtering contacts to export (mirrors list options minus pagination) */
interface ExportContactsOptions {
  /** When provided, only contacts with this owner_id are returned */
  ownerId?: string;
  /** When provided, only contacts linked to this account_id are returned */
  accountId?: string;
  /** Case-insensitive substring match across first_name, last_name, and email */
  search?: string;
  /** Case-insensitive substring match on the linked account name */
  accountSearch?: string;
  /** When provided, the org visibility policy is enforced for this user */
  requestingUser?: { id: string; role: string };
}

/**
 * Returns all contacts matching the given filters, enriched with account name
 * and owner name, for CSV export. No pagination — returns every matching row.
 *
 * @param options - Filters (same semantics as listContacts, minus pagination/sort)
 * @returns Array of enriched contact rows ordered by last_name ASC, first_name ASC
 */
export async function exportContactsForCsv(
  options: ExportContactsOptions = {},
): Promise<ContactExportRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.ownerId) {
    values.push(options.ownerId);
    conditions.push(`c.owner_id = $${values.length}`);
  }

  if (options.requestingUser) {
    const visFilter = await buildVisibilityFilter(
      'contact',
      options.requestingUser.id,
      options.requestingUser.role,
      'c.owner_id',
      values.length + 1,
    );
    if (visFilter.clause) {
      visFilter.params.forEach((p) => values.push(p));
      conditions.push(visFilter.clause);
    }
  }

  if (options.accountId) {
    values.push(options.accountId);
    conditions.push(`c.account_id = $${values.length}`);
  }

  if (options.search) {
    const pattern = `%${options.search}%`;
    values.push(pattern);
    const idx = values.length;
    conditions.push(
      `(c.first_name ILIKE $${idx} OR c.last_name ILIKE $${idx} OR c.email ILIKE $${idx})`,
    );
  }

  if (options.accountSearch) {
    const pattern = `%${options.accountSearch}%`;
    values.push(pattern);
    conditions.push(`a.name ILIKE $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await withRlsQuery((client) =>
    client.query<ContactExportRow>(
      `SELECT
       c.id,
       c.first_name,
       c.last_name,
       c.email,
       c.phone,
       c.title,
       c.department,
       ca.address_line1,
       ca.address_line2,
       ca.city,
       ca.state_region,
       ca.postal_code,
       ca.country,
       c.linkedin_url,
       c.twitter_x_url,
       c.other_url,
       a.name AS account_name,
       u.name AS owner_name,
       c.created_at,
       c.updated_at
     FROM contacts c
     LEFT JOIN accounts a ON c.account_id = a.id
     JOIN users u ON c.owner_id = u.id
     LEFT JOIN contact_addresses ca ON ca.contact_id = c.id AND ca.is_default = true
     ${whereClause}
     ORDER BY c.last_name ASC, c.first_name ASC`,
      values,
    ),
  );

  return result.rows;
}

/**
 * Deletes a contact by its UUID and writes an audit entry in the same transaction.
 *
 * @param id - Contact UUID
 * @param actor - User performing the action (for audit log)
 * @param recordName - Display name of the contact (used for audit log after deletion)
 * @returns The deleted contact row, or null if not found
 */
export async function deleteContact(
  id: string,
  actor: AuditActor = SYSTEM_ACTOR,
  recordName = '',
): Promise<ContactRow | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    // Soft-delete notes before removing the parent row to prevent orphaned active notes
    await softDeleteNotesByEntity(client, 'contact', id);

    const result = await client.query<ContactRow>(
      'DELETE FROM contacts WHERE id = $1 RETURNING *',
      [id],
    );

    const contact = result.rows[0] ?? null;

    if (contact) {
      // Audit: record deleted
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: id,
        recordName,
        eventType: 'deleted',
        changedById: actor.id,
        changedByName: actor.name,
        source: actor.source ?? null,
      });
    }

    await client.query('COMMIT');

    if (contact) {
      void dispatchWebhookEvent('contact.deleted', {
        id: contact.id,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
      });
    }

    return contact;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Input for merging two contact records.
 * The winner is the record that survives; the loser is deleted.
 * For each field where the two contacts differ, the caller specifies which value to keep.
 */
export interface MergeContactsInput {
  /** UUID of the contact record that will survive the merge */
  winnerId: string;
  /** UUID of the contact record that will be deleted after merge */
  loserId: string;
  /**
   * Per-field winner source — 'winner' keeps the current winner value, 'loser' takes the loser value.
   * Fields omitted here default to keeping the winner's current value.
   * Address fields are not merged by field-choice; the loser's contact_addresses rows are
   * re-linked to the winner so both address histories are preserved.
   */
  fieldChoices: Partial<
    Record<
      | 'first_name'
      | 'last_name'
      | 'email'
      | 'phone'
      | 'title'
      | 'department'
      | 'account_id'
      | 'linkedin_url'
      | 'twitter_x_url'
      | 'other_url',
      'winner' | 'loser'
    >
  >;
}

/** Fields that the caller may choose between when merging contacts */
const MERGEABLE_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'title',
  'department',
  'account_id',
  'linkedin_url',
  'twitter_x_url',
  'other_url',
] as const;

/**
 * Atomically merges two contact records into one.
 *
 * Steps (all within one transaction):
 *   1. Apply field choices to the winner record.
 *   2. Re-link loser's activities to the winner.
 *   3. Re-link loser's deals (deal_contacts) to the winner (skip if winner already linked).
 *   4. Copy loser's account association to winner if winner has none, and re-link the
 *      loser's addresses, notes, attachments, and custom field values.
 *   5. Delete the loser record.
 *   6. Write an audit entry on the winner: "merged" with loser name.
 *   7. Create a system activity note on the winner's timeline.
 *
 * @param input - Merge parameters
 * @param actor - User performing the merge (for audit log)
 * @returns The updated winner contact row
 */
export async function mergeContacts(
  input: MergeContactsInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<ContactRow> {
  const { winnerId, loserId, fieldChoices } = input;

  if (winnerId === loserId) {
    throw Object.assign(new Error('Cannot merge a contact with itself'), { code: 'SELF_MERGE' });
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    // Fetch both contacts sequentially — a single pg client cannot run concurrent queries
    const winnerResult = await client.query<ContactRow>(
      'SELECT * FROM contacts WHERE id = $1 FOR UPDATE',
      [winnerId],
    );
    const loserResult = await client.query<ContactRow>(
      'SELECT * FROM contacts WHERE id = $1 FOR UPDATE',
      [loserId],
    );

    const winner = winnerResult.rows[0];
    const loser = loserResult.rows[0];

    if (!winner) throw new Error(`Winner contact ${winnerId} not found`);
    if (!loser) throw new Error(`Loser contact ${loserId} not found`);

    // Build the UPDATE for the winner using field choices
    const updates: Record<string, unknown> = {};
    for (const field of MERGEABLE_FIELDS) {
      if (fieldChoices[field] === 'loser') {
        updates[field] = loser[field];
      }
    }

    // If winner has no account and loser does, take the loser's account (step 4)
    if (!winner.account_id && loser.account_id && fieldChoices['account_id'] !== 'loser') {
      updates['account_id'] = loser.account_id;
    }

    // Apply updates to the winner if any field choices were made
    if (Object.keys(updates).length > 0) {
      const setFields = Object.keys(updates);
      const setClauses = setFields.map((f, i) => `${f} = $${i + 2}`).join(', ');
      await client.query(`UPDATE contacts SET ${setClauses}, updated_at = now() WHERE id = $1`, [
        winnerId,
        ...setFields.map((f) => updates[f]),
      ]);
    }

    // Re-link loser's activities to the winner (step 2)
    await client.query('UPDATE activities SET contact_id = $1 WHERE contact_id = $2', [
      winnerId,
      loserId,
    ]);

    // Re-link loser's deals to the winner (step 3)
    // Insert only where winner isn't already on the deal, then delete loser entries
    await client.query(
      `INSERT INTO deal_contacts (deal_id, contact_id)
       SELECT dc.deal_id, $1
       FROM deal_contacts dc
       WHERE dc.contact_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM deal_contacts dc2
           WHERE dc2.deal_id = dc.deal_id AND dc2.contact_id = $1
         )
       ON CONFLICT DO NOTHING`,
      [winnerId, loserId],
    );
    await client.query('DELETE FROM deal_contacts WHERE contact_id = $1', [loserId]);

    // Re-link loser's contact_addresses to the winner (step 4a).
    // If the loser's row is marked is_default and the winner already has a default,
    // demote the loser's row so the unique partial index is not violated.
    const winnerHasDefault = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM contact_addresses WHERE contact_id = $1 AND is_default = true
       ) AS exists`,
      [winnerId],
    );
    if (winnerHasDefault.rows[0].exists) {
      await client.query(
        `UPDATE contact_addresses SET is_default = false WHERE contact_id = $1 AND is_default = true`,
        [loserId],
      );
    }
    await client.query(`UPDATE contact_addresses SET contact_id = $1 WHERE contact_id = $2`, [
      winnerId,
      loserId,
    ]);

    // Re-link the loser's polymorphic children (step 4b). No FK means the DELETE
    // below cannot cascade, and a row left on the dead id is unreachable by every
    // list query AND by a later GDPR erasure, which keys on the survivor's id.
    // Soft-deleted notes move too: they still hold PII, and a row left on the dead id
    // is unreachable by a later erasure of the survivor.
    await client.query(
      `UPDATE notes SET entity_id = $1 WHERE entity_type = 'contact' AND entity_id = $2`,
      [winnerId, loserId],
    );
    await client.query(
      `UPDATE attachments SET record_id = $1 WHERE record_type = 'contact' AND record_id = $2`,
      [winnerId, loserId],
    );
    // The winner's own value wins where both records filled the same field; the
    // loser's losing row is dropped rather than left orphaned.
    await client.query(
      `UPDATE custom_field_values SET record_id = $1
       WHERE record_id = $2
         AND definition_id IN (
           SELECT id FROM custom_field_definitions WHERE entity_type = 'contact'
         )
         AND NOT EXISTS (
           SELECT 1 FROM custom_field_values existing
           WHERE existing.record_id = $1
             AND existing.definition_id = custom_field_values.definition_id
         )`,
      [winnerId, loserId],
    );
    await client.query(
      `DELETE FROM custom_field_values
       WHERE record_id = $1
         AND definition_id IN (
           SELECT id FROM custom_field_definitions WHERE entity_type = 'contact'
         )`,
      [loserId],
    );

    // Fetch the final winner state before deleting the loser
    const updatedWinnerResult = await client.query<ContactRow>(
      'SELECT * FROM contacts WHERE id = $1',
      [winnerId],
    );
    const updatedWinner = updatedWinnerResult.rows[0];
    const loserName = `${loser.first_name} ${loser.last_name}`;

    // Delete the loser (step 5)
    await client.query('DELETE FROM contacts WHERE id = $1', [loserId]);

    // Audit: merged event on the winner (step 6)
    await writeAuditEntry(client, {
      recordType: 'contact',
      recordId: winnerId,
      recordName: `${updatedWinner.first_name} ${updatedWinner.last_name}`,
      eventType: 'merged',
      newValue: loserName,
      changedById: actor.id,
      changedByName: actor.name,
      source: actor.source ?? null,
    });

    // Activity note on the winner's timeline (step 7)
    await client.query(
      `INSERT INTO activities (type, subject, notes, status, contact_id, owner_id)
       VALUES ('Note', $1, $2, 'complete', $3, $4)`,
      [
        `Merged from ${loserName}`,
        `Contact record merged from ${loserName} (${loserId})`,
        winnerId,
        actor.id,
      ],
    );

    await client.query('COMMIT');

    // Re-fetch with default_address joined — SELECT * on contacts does not include the
    // address sub-resource.
    return (await findContactById(winnerId)) ?? updatedWinner;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ── Contact Addresses ──────────────────────────────────────────────────────────

/** Shape of a contact_addresses row returned from the database */
export interface ContactAddressRow {
  id: string;
  contact_id: string;
  label: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  country: string | null;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Fields accepted when creating or updating a contact address */
export interface ContactAddressInput {
  label?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_region?: string;
  postal_code?: string;
  country?: string;
  is_default?: boolean;
}

/**
 * Returns all addresses for a given contact, ordered by is_default DESC then created_at ASC.
 *
 * @param contactId - Contact UUID
 * @returns Array of address rows
 */
export async function listContactAddresses(contactId: string): Promise<ContactAddressRow[]> {
  const result = await pool.query<ContactAddressRow>(
    `SELECT * FROM contact_addresses
     WHERE contact_id = $1
     ORDER BY is_default DESC, created_at ASC`,
    [contactId],
  );
  return result.rows;
}

/**
 * Adds a new address to a contact.
 * If is_default is true, clears is_default on all other addresses for this contact first.
 *
 * @param contactId - Contact UUID
 * @param input - Address fields
 * @returns The inserted address row
 */
export async function addContactAddress(
  contactId: string,
  input: ContactAddressInput,
): Promise<ContactAddressRow> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    if (input.is_default) {
      await client.query(
        'UPDATE contact_addresses SET is_default = false, updated_at = now() WHERE contact_id = $1',
        [contactId],
      );
    }

    const result = await client.query<ContactAddressRow>(
      `INSERT INTO contact_addresses
         (contact_id, label, address_line1, address_line2, city, state_region, postal_code, country, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        contactId,
        input.label ?? null,
        input.address_line1 ?? null,
        input.address_line2 ?? null,
        input.city ?? null,
        input.state_region ?? null,
        input.postal_code ?? null,
        input.country ?? null,
        input.is_default ?? false,
      ],
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Updates an existing contact address.
 * If is_default is set to true, clears is_default on all other addresses for this contact first.
 *
 * @param addressId - Address UUID
 * @param contactId - Contact UUID (used to scope the update to prevent cross-contact writes)
 * @param input - Fields to update
 * @returns The updated address row, or null if not found
 */
export async function updateContactAddress(
  addressId: string,
  contactId: string,
  input: ContactAddressInput,
): Promise<ContactAddressRow | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    if (input.is_default) {
      await client.query(
        'UPDATE contact_addresses SET is_default = false, updated_at = now() WHERE contact_id = $1 AND id != $2',
        [contactId, addressId],
      );
    }

    const fields = Object.keys(input) as (keyof ContactAddressInput)[];
    if (fields.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`).join(', ');
    const result = await client.query<ContactAddressRow>(
      `UPDATE contact_addresses
       SET ${setClauses}, updated_at = now()
       WHERE id = $1 AND contact_id = $2
       RETURNING *`,
      [addressId, contactId, ...fields.map((f) => input[f] ?? null)],
    );

    await client.query('COMMIT');
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Removes an address record.
 * Returns true if a row was deleted, false if not found.
 *
 * @param addressId - Address UUID
 * @param contactId - Contact UUID (scopes the delete)
 */
export async function removeContactAddress(addressId: string, contactId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM contact_addresses WHERE id = $1 AND contact_id = $2',
    [addressId, contactId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Sets a specific address as the default for its contact,
 * clearing is_default on all others in the same transaction.
 *
 * @param addressId - Address UUID to set as default
 * @param contactId - Contact UUID (scopes the update)
 * @returns The updated address row, or null if not found
 */
export async function setDefaultContactAddress(
  addressId: string,
  contactId: string,
): Promise<ContactAddressRow | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    await client.query(
      'UPDATE contact_addresses SET is_default = false, updated_at = now() WHERE contact_id = $1',
      [contactId],
    );

    const result = await client.query<ContactAddressRow>(
      `UPDATE contact_addresses
       SET is_default = true, updated_at = now()
       WHERE id = $1 AND contact_id = $2
       RETURNING *`,
      [addressId, contactId],
    );

    await client.query('COMMIT');
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
