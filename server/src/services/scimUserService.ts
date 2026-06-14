/**
 * SCIM 2.0 user service — handles provisioning, deprovisioning, and attribute
 * sync for the /scim/v2/Users endpoint. (MINCRM-541)
 *
 * All database access for SCIM user operations lives here. Controllers must
 * not query the database directly.
 */

import pool from '../db.js';
import logger from '../logger.js';
import { writeAuditEntry, writeAuditEntries, diffFields } from './auditService.js';
import type { AuditActor } from './auditService.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SCIM_USER_SCHEMAS = ['urn:ietf:params:scim:schemas:core:2.0:User'] as const;

/** Denormalized role enum value for all SCIM-provisioned users (MINCRM-542) */
const SCIM_USER_ROLE = 'rep' as const;

// ── Internal types ────────────────────────────────────────────────────────────

interface ScimUserRow {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'invited' | 'inactive';
  role: string;
  scim_external_id: string | null;
  created_at: Date;
  updated_at: Date;
}

// ── Public types ──────────────────────────────────────────────────────────────

/** SCIM User representation sent in responses (RFC 7643 §4.1) */
export interface ScimUser {
  schemas: typeof SCIM_USER_SCHEMAS;
  id: string;
  userName: string;
  name: { formatted: string; givenName: string; familyName: string };
  displayName: string;
  active: boolean;
  meta: {
    resourceType: 'User';
    created: string;
    lastModified: string;
    location: string;
  };
}

export interface ScimCreateUserInput {
  userName: string;
  givenName: string;
  familyName: string;
  active?: boolean;
  /** IdP-assigned stable external identifier (externalId from SCIM request) */
  externalId?: string | null;
}

export interface ScimReplaceUserInput {
  userName: string;
  givenName: string;
  familyName: string;
  active?: boolean;
}

export interface ScimPatchOp {
  op: 'add' | 'replace' | 'remove';
  path?: string;
  value?: unknown;
}

/** SCIM ListResponse wrapper (RFC 7644 §3.4.2) */
export interface ScimListResponse<T> {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Converts a DB row to the SCIM User wire format.
 * Splits the stored `name` on the first space for givenName/familyName.
 */
export function toScimUser(row: ScimUserRow, baseUrl: string): ScimUser {
  const spaceIdx = row.name.indexOf(' ');
  const givenName = spaceIdx === -1 ? row.name : row.name.slice(0, spaceIdx);
  const familyName = spaceIdx === -1 ? '' : row.name.slice(spaceIdx + 1);

  return {
    schemas: SCIM_USER_SCHEMAS,
    id: row.id,
    userName: row.email,
    name: { formatted: row.name, givenName, familyName },
    displayName: row.name,
    active: row.status === 'active',
    meta: {
      resourceType: 'User',
      created: row.created_at.toISOString(),
      lastModified: row.updated_at.toISOString(),
      location: `${baseUrl}/scim/v2/Users/${row.id}`,
    },
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Provisions a new user from a SCIM CREATE request.
 * Throws with statusCode 409 / code SCIM_USER_CONFLICT if email already exists.
 */
export async function provisionScimUser(
  input: ScimCreateUserInput,
  actor: AuditActor,
): Promise<ScimUserRow> {
  const email = input.userName.toLowerCase().trim();
  const name = [input.givenName, input.familyName].filter(Boolean).join(' ').trim() || email;
  const status = input.active === false ? 'inactive' : 'active';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM public.users WHERE LOWER(email) = $1 LIMIT 1`,
      [email],
    );
    if (existing.rows.length > 0) {
      const err = new Error('A user with this email address already exists') as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 409;
      err.code = 'SCIM_USER_CONFLICT';
      throw err;
    }

    const result = await client.query<ScimUserRow>(
      `INSERT INTO public.users
         (email, name, role, status, must_change_password, scim_external_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, false, $5, now(), now())
       RETURNING id, email, name, role, status, scim_external_id, created_at, updated_at`,
      [email, name, SCIM_USER_ROLE, status, input.externalId ?? null],
    );
    const newUser = result.rows[0]!; // just inserted

    await writeAuditEntry(client, {
      recordType: 'user',
      recordId: newUser.id,
      recordName: newUser.name,
      eventType: 'created',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    logger.info({ userId: newUser.id, email: newUser.email }, 'SCIM: user provisioned');
    return newUser;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns a single SCIM-provisioned user by ID, or null.
 * Only users with a non-null scim_external_id are visible through the SCIM API.
 */
export async function getScimUser(id: string): Promise<ScimUserRow | null> {
  const result = await pool.query<ScimUserRow>(
    `SELECT id, email, name, role, status, scim_external_id, created_at, updated_at
     FROM public.users WHERE id = $1 AND scim_external_id IS NOT NULL LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Returns users matching an optional SCIM filter.
 * Only `userName eq "..."` is supported; all other filters are ignored and the
 * full user list is returned.
 */
export async function listScimUsers(filter?: string): Promise<ScimUserRow[]> {
  if (filter) {
    const match = /^userName\s+eq\s+"([^"]+)"$/i.exec(filter.trim());
    if (match) {
      const email = match[1]!.toLowerCase().trim(); // regex group is always present
      const result = await pool.query<ScimUserRow>(
        `SELECT id, email, name, role, status, scim_external_id, created_at, updated_at
         FROM public.users
         WHERE LOWER(email) = $1 AND scim_external_id IS NOT NULL`,
        [email],
      );
      return result.rows;
    }
  }

  const result = await pool.query<ScimUserRow>(
    `SELECT id, email, name, role, status, scim_external_id, created_at, updated_at
     FROM public.users
     WHERE scim_external_id IS NOT NULL
     ORDER BY created_at ASC`,
  );
  return result.rows;
}

/**
 * Replaces a user's attributes wholesale (SCIM PUT).
 * Throws with statusCode 404 if the user is not found.
 */
export async function replaceScimUser(
  id: string,
  input: ScimReplaceUserInput,
  actor: AuditActor,
): Promise<ScimUserRow> {
  const existing = await getScimUser(id);
  if (!existing) {
    const err = new Error('User not found') as Error & { statusCode: number; code: string };
    err.statusCode = 404;
    err.code = 'SCIM_USER_NOT_FOUND';
    throw err;
  }

  const email = input.userName.toLowerCase().trim();
  const name = [input.givenName, input.familyName].filter(Boolean).join(' ').trim() || email;
  let status: 'active' | 'inactive' = input.active === false ? 'inactive' : 'active';

  // Admins cannot be deactivated via SCIM — they must always retain a local login escape hatch.
  if (status === 'inactive' && existing.role === 'admin') {
    status = 'active';
    logger.warn({ userId: id }, 'SCIM: ignoring deactivation attempt on admin user');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<ScimUserRow>(
      `UPDATE public.users
       SET email = $1, name = $2, status = $3, updated_at = now()
       WHERE id = $4 AND scim_external_id IS NOT NULL
       RETURNING id, email, name, role, status, scim_external_id, created_at, updated_at`,
      [email, name, status, id],
    );

    if ((result.rowCount ?? 0) === 0) {
      // User was deleted between the pre-check read and this UPDATE — treat as 404.
      const notFound = new Error('User not found') as Error & { statusCode: number; code: string };
      notFound.statusCode = 404;
      notFound.code = 'SCIM_USER_NOT_FOUND';
      throw notFound;
    }

    // Non-null assertion safe: rowCount > 0 guarantees rows[0] exists.
    const updated = result.rows[0]!;

    const auditBase = {
      recordType: 'user' as const,
      recordId: id,
      recordName: updated.name,
      changedById: actor.id,
      changedByName: actor.name,
    };
    const entries = diffFields(
      { email: existing.email, name: existing.name, status: existing.status },
      { email: updated.email, name: updated.name, status: updated.status },
      auditBase,
    );
    if (entries.length > 0) {
      await writeAuditEntries(client, entries);
    }

    await client.query('COMMIT');
    logger.info({ userId: id }, 'SCIM: user replaced');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Applies SCIM PATCH operations to a user (RFC 7644 §3.5.2).
 * Only `active`, `userName`, `name.givenName`, `name.familyName`, and
 * `displayName` paths are handled; others are silently ignored.
 * Throws with statusCode 404 if the user is not found.
 */
export async function patchScimUser(
  id: string,
  ops: ScimPatchOp[],
  actor: AuditActor,
): Promise<ScimUserRow> {
  const existing = await getScimUser(id);
  if (!existing) {
    const err = new Error('User not found') as Error & { statusCode: number; code: string };
    err.statusCode = 404;
    err.code = 'SCIM_USER_NOT_FOUND';
    throw err;
  }

  // Build the set of changes by applying ops to a mutable draft.
  let email = existing.email;
  let name = existing.name;
  let status = existing.status;

  const spaceIdx = existing.name.indexOf(' ');
  let givenName = spaceIdx === -1 ? existing.name : existing.name.slice(0, spaceIdx);
  let familyName = spaceIdx === -1 ? '' : existing.name.slice(spaceIdx + 1);

  for (const op of ops) {
    const path = op.path?.toLowerCase() ?? '';
    // RFC 7644 §3.5.2: op:remove on the active attribute deactivates the user.
    if (op.op === 'remove' && path === 'active') {
      status = 'inactive';
    } else if (
      path === 'active' ||
      (op.value && typeof (op.value as Record<string, unknown>).active !== 'undefined' && !path)
    ) {
      const activeVal =
        path === 'active' ? op.value : (op.value as Record<string, unknown> | undefined)?.active;
      if (typeof activeVal === 'boolean') {
        status = activeVal ? 'active' : 'inactive';
      }
    } else if (path === 'username') {
      if (typeof op.value === 'string') email = op.value.toLowerCase().trim();
    } else if (path === 'displayname') {
      if (typeof op.value === 'string') name = op.value.trim();
    } else if (path === 'name.givenname') {
      if (typeof op.value === 'string') givenName = op.value.trim();
    } else if (path === 'name.familyname') {
      if (typeof op.value === 'string') familyName = op.value.trim();
    } else if (!path && op.value && typeof op.value === 'object') {
      // Whole-object value with no path (RFC 7644 §3.5.2 "add" without path)
      const val = op.value as Record<string, unknown>;
      if (typeof val.active === 'boolean') status = val.active ? 'active' : 'inactive';
      if (typeof val.userName === 'string') email = val.userName.toLowerCase().trim();
      if (typeof val.displayName === 'string') name = val.displayName.trim();
      const nameObj = val.name as Record<string, string> | undefined;
      if (nameObj) {
        if (typeof nameObj.givenName === 'string') givenName = nameObj.givenName.trim();
        if (typeof nameObj.familyName === 'string') familyName = nameObj.familyName.trim();
      }
    }
  }

  // If givenName/familyName were updated but displayName was not, reconstruct name.
  if (
    givenName !== (spaceIdx === -1 ? existing.name : existing.name.slice(0, spaceIdx)) ||
    familyName !== (spaceIdx === -1 ? '' : existing.name.slice(spaceIdx + 1))
  ) {
    name = [givenName, familyName].filter(Boolean).join(' ').trim() || email;
  }

  // Admins cannot be deactivated via SCIM — they must always retain a local login escape hatch.
  if (status === 'inactive' && existing.role === 'admin') {
    status = existing.status;
    logger.warn({ userId: id }, 'SCIM: ignoring deactivation attempt on admin user');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<ScimUserRow>(
      `UPDATE public.users
       SET email = $1, name = $2, status = $3, updated_at = now()
       WHERE id = $4 AND scim_external_id IS NOT NULL
       RETURNING id, email, name, role, status, scim_external_id, created_at, updated_at`,
      [email, name, status, id],
    );

    if ((result.rowCount ?? 0) === 0) {
      // User was deleted between the pre-check read and this UPDATE — treat as 404.
      const notFound = new Error('User not found') as Error & { statusCode: number; code: string };
      notFound.statusCode = 404;
      notFound.code = 'SCIM_USER_NOT_FOUND';
      throw notFound;
    }

    // Non-null assertion safe: rowCount > 0 guarantees rows[0] exists.
    const updated = result.rows[0]!;

    const auditBase = {
      recordType: 'user' as const,
      recordId: id,
      recordName: updated.name,
      changedById: actor.id,
      changedByName: actor.name,
    };
    const entries = diffFields(
      { email: existing.email, name: existing.name, status: existing.status },
      { email: updated.email, name: updated.name, status: updated.status },
      auditBase,
    );
    if (entries.length > 0) {
      await writeAuditEntries(client, entries);
    }

    await client.query('COMMIT');
    logger.info({ userId: id }, 'SCIM: user patched');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
