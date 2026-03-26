/**
 * Contact service — business logic for contact CRUD operations.
 * All database access for contacts goes through this module.
 */

import pool from '../db.js';
import type {
  CreateContactInput,
  UpdateContactInput,
} from '@minicrm/shared/schemas/contactSchema.js';

/** Shape of a contact row returned from the database */
export interface ContactRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  title: string | null;
  department: string | null;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
}

/** Options for filtering the contacts list */
interface ListContactsOptions {
  /** When provided, only contacts with this owner_id are returned */
  ownerId?: string;
}

/**
 * Creates a new contact record.
 *
 * @param params - Contact fields plus the owner's user ID
 * @returns The inserted contact row
 */
export async function createContact(
  params: CreateContactInput & { owner_id: string },
): Promise<ContactRow> {
  const { first_name, last_name, email, phone, title, department, owner_id } = params;

  const result = await pool.query<ContactRow>(
    `INSERT INTO contacts (first_name, last_name, email, phone, title, department, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      first_name,
      last_name,
      email.toLowerCase(),
      phone ?? null,
      title ?? null,
      department ?? null,
      owner_id,
    ],
  );

  return result.rows[0];
}

/**
 * Finds a contact by its UUID.
 *
 * @param id - Contact UUID
 * @returns The contact row, or null if not found
 */
export async function findContactById(id: string): Promise<ContactRow | null> {
  const result = await pool.query<ContactRow>('SELECT * FROM contacts WHERE id = $1 LIMIT 1', [id]);

  return result.rows[0] ?? null;
}

/**
 * Returns all contacts, optionally scoped to a single owner.
 *
 * @param options - Optional filter; ownerId restricts results to that owner
 * @returns Array of contact rows ordered by created_at ascending
 */
export async function listContacts(options: ListContactsOptions = {}): Promise<ContactRow[]> {
  if (options.ownerId) {
    const result = await pool.query<ContactRow>(
      'SELECT * FROM contacts WHERE owner_id = $1 ORDER BY created_at ASC',
      [options.ownerId],
    );
    return result.rows;
  }

  const result = await pool.query<ContactRow>('SELECT * FROM contacts ORDER BY created_at ASC');
  return result.rows;
}

/**
 * Updates one or more fields on an existing contact.
 *
 * @param id - Contact UUID
 * @param params - Fields to update (at least one required)
 * @returns The updated contact row, or null if not found
 */
export async function updateContact(
  id: string,
  params: UpdateContactInput,
): Promise<ContactRow | null> {
  const normalized: UpdateContactInput = {
    ...params,
    ...(params.email !== undefined ? { email: params.email.toLowerCase() } : {}),
  };
  const fields = Object.keys(normalized) as (keyof UpdateContactInput)[];

  // Build dynamic SET clause: first_name = $2, last_name = $3, ...
  const setClauses = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');

  const result = await pool.query<ContactRow>(
    `UPDATE contacts
     SET ${setClauses}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...fields.map((f) => normalized[f])],
  );

  return result.rows[0] ?? null;
}

/**
 * Deletes a contact by its UUID.
 *
 * @param id - Contact UUID
 * @returns The deleted contact row, or null if not found
 */
export async function deleteContact(id: string): Promise<ContactRow | null> {
  const result = await pool.query<ContactRow>('DELETE FROM contacts WHERE id = $1 RETURNING *', [
    id,
  ]);

  return result.rows[0] ?? null;
}
