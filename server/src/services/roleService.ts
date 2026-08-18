/**
 * Role service — capability resolution and custom role CRUD.
 *
 * All database access for custom_roles, role_capabilities, and user_custom_roles
 * lives here. Controllers must not query these tables directly.
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import type { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { writeAuditEntry, writeAuditEntries, diffFields } from './auditService.js';
import type { AuditActor } from './auditService.js';
import type {
  CreateCustomRoleInput,
  UpdateCustomRoleInput,
} from '@minicrm/shared/schemas/capabilitySchema.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CustomRoleRow {
  id: string;
  name: string;
  description: string | null;
  is_builtin: boolean;
  capabilities: Capability[];
  created_at: Date;
  updated_at: Date;
}

// ── Capability resolution ──────────────────────────────────────────────────────

/**
 * Resolves the effective capability set for a user.
 *
 * Primary path: unions all capabilities from every role in user_custom_roles.
 * Fallback: if the user has no custom role assignments, resolves capabilities
 * via their users.role column by looking up the built-in role of that name.
 * This ensures users created without explicit role assignments (e.g. test
 * fixtures) still receive the correct capability set for their legacy role.
 *
 * Result is cached on res.locals.capabilities per-request by requireCapability()
 * so that only the first capability check in a request hits the DB.
 */
export async function userCapabilities(userId: string): Promise<Set<Capability>> {
  const result = await pool.query<{ capability: string }>(
    `SELECT DISTINCT rc.capability
     FROM public.user_custom_roles ucr
     JOIN public.role_capabilities rc ON rc.role_id = ucr.role_id
     WHERE ucr.user_id = $1`,
    [userId],
  );

  if (result.rows.length > 0) {
    const caps = new Set<Capability>();
    for (const row of result.rows) {
      caps.add(row.capability as Capability);
    }
    return caps;
  }

  // Fallback: resolve via users.role → built-in custom_roles row of the same name
  const fallback = await pool.query<{ capability: string }>(
    `SELECT DISTINCT rc.capability
     FROM public.users u
     JOIN public.custom_roles cr ON cr.name = u.role AND cr.is_builtin = true
     JOIN public.role_capabilities rc ON rc.role_id = cr.id
     WHERE u.id = $1`,
    [userId],
  );
  const caps = new Set<Capability>();
  for (const row of fallback.rows) {
    caps.add(row.capability as Capability);
  }
  return caps;
}

// ── Custom role queries ────────────────────────────────────────────────────────

/** Returns all custom_roles rows with their capability arrays. */
export async function getAllCustomRoles(): Promise<CustomRoleRow[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    description: string | null;
    is_builtin: boolean;
    capabilities: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT
       cr.id, cr.name, cr.description, cr.is_builtin,
       cr.created_at, cr.updated_at,
       string_agg(rc.capability, ',' ORDER BY rc.capability) AS capabilities
     FROM public.custom_roles cr
     LEFT JOIN public.role_capabilities rc ON rc.role_id = cr.id
     GROUP BY cr.id, cr.name, cr.description, cr.is_builtin, cr.created_at, cr.updated_at
     ORDER BY cr.is_builtin DESC, cr.name ASC`,
  );
  return result.rows.map(toCustomRoleRow);
}

/** Returns a single custom_roles row with its capability array, or null. */
export async function getCustomRoleById(id: string): Promise<CustomRoleRow | null> {
  const result = await pool.query<{
    id: string;
    name: string;
    description: string | null;
    is_builtin: boolean;
    capabilities: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT
       cr.id, cr.name, cr.description, cr.is_builtin,
       cr.created_at, cr.updated_at,
       string_agg(rc.capability, ',' ORDER BY rc.capability) AS capabilities
     FROM public.custom_roles cr
     LEFT JOIN public.role_capabilities rc ON rc.role_id = cr.id
     WHERE cr.id = $1
     GROUP BY cr.id, cr.name, cr.description, cr.is_builtin, cr.created_at, cr.updated_at`,
    [id],
  );
  return result.rows.length ? toCustomRoleRow(result.rows[0]) : null;
}

// ── Custom role mutations ──────────────────────────────────────────────────────

/** Creates a new custom role with the given capabilities. Audited. */
export async function createCustomRole(
  input: CreateCustomRoleInput,
  actor: AuditActor,
): Promise<CustomRoleRow> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const roleResult = await client.query<{
      id: string;
      name: string;
      description: string | null;
      is_builtin: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO public.custom_roles (name, description, is_builtin)
       VALUES ($1, $2, false)
       RETURNING id, name, description, is_builtin, created_at, updated_at`,
      [input.name, input.description ?? null],
    );
    const role = roleResult.rows[0];

    if (input.capabilities.length > 0) {
      const values = input.capabilities.map((_, i) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO public.role_capabilities (role_id, capability) VALUES ${values}
         ON CONFLICT (role_id, capability) DO NOTHING`,
        [role.id, ...input.capabilities],
      );
    }

    await writeAuditEntry(client, {
      recordType: 'custom_role',
      recordId: role.id,
      recordName: role.name,
      eventType: 'created',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    logger.info({ roleId: role.id, name: role.name }, 'Custom role created');
    return { ...role, capabilities: input.capabilities as Capability[] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Updates a custom role's name, description, and/or capability set.
 * Returns 409 if the role is built-in.
 * Capability update replaces the full set wholesale.
 */
export async function updateCustomRole(
  id: string,
  input: UpdateCustomRoleInput,
  actor: AuditActor,
): Promise<CustomRoleRow> {
  const existing = await getCustomRoleById(id);
  if (!existing) {
    const err = new Error('Custom role not found') as Error & { statusCode: number; code: string };
    err.statusCode = 404;
    err.code = 'CUSTOM_ROLE_NOT_FOUND';
    throw err;
  }
  if (existing.is_builtin) {
    const err = new Error('Built-in roles cannot be modified') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 409;
    err.code = 'CUSTOM_ROLE_BUILTIN';
    throw err;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const newName = input.name ?? existing.name;
    const newDescription =
      input.description !== undefined ? input.description : existing.description;

    const roleResult = await client.query<{
      id: string;
      name: string;
      description: string | null;
      is_builtin: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE public.custom_roles
       SET name = $1, description = $2, updated_at = now()
       WHERE id = $3
       RETURNING id, name, description, is_builtin, created_at, updated_at`,
      [newName, newDescription, id],
    );
    const updated = roleResult.rows[0];

    let newCapabilities = existing.capabilities;
    if (input.capabilities !== undefined) {
      await client.query(`DELETE FROM public.role_capabilities WHERE role_id = $1`, [id]);
      if (input.capabilities.length > 0) {
        const values = input.capabilities.map((_, i) => `($1, $${i + 2})`).join(', ');
        await client.query(
          `INSERT INTO public.role_capabilities (role_id, capability) VALUES ${values}
           ON CONFLICT (role_id, capability) DO NOTHING`,
          [id, ...input.capabilities],
        );
      }
      newCapabilities = input.capabilities as Capability[];
    }

    const auditBase = {
      recordType: 'custom_role' as const,
      recordId: id,
      recordName: updated.name,
      changedById: actor.id,
      changedByName: actor.name,
    };
    const entries = diffFields(
      { name: existing.name, description: existing.description },
      { name: updated.name, description: updated.description },
      auditBase,
    );
    if (input.capabilities !== undefined) {
      entries.push({
        ...auditBase,
        eventType: 'updated' as const,
        fieldName: 'capabilities',
        oldValue: existing.capabilities.join(', '),
        newValue: newCapabilities.join(', '),
      });
    }
    if (entries.length > 0) {
      await writeAuditEntries(client, entries);
    }

    await client.query('COMMIT');
    logger.info({ roleId: id }, 'Custom role updated');
    return { ...updated, capabilities: newCapabilities };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deletes a custom role.
 * Returns 409 if the role is built-in or if any users are currently assigned to it.
 * Callers must reassign those users first.
 */
export async function deleteCustomRole(id: string, actor: AuditActor): Promise<void> {
  const existing = await getCustomRoleById(id);
  if (!existing) {
    const err = new Error('Custom role not found') as Error & { statusCode: number; code: string };
    err.statusCode = 404;
    err.code = 'CUSTOM_ROLE_NOT_FOUND';
    throw err;
  }
  if (existing.is_builtin) {
    const err = new Error('Built-in roles cannot be deleted') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 409;
    err.code = 'CUSTOM_ROLE_BUILTIN';
    throw err;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the role row to serialise concurrent assignment + delete operations,
    // then recheck assignees inside the transaction to close the TOCTOU window.
    await client.query(`SELECT id FROM public.custom_roles WHERE id = $1 FOR UPDATE`, [id]);
    const assigneeCount = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM public.user_custom_roles WHERE role_id = $1`,
      [id],
    );
    if (parseInt(assigneeCount.rows[0].count, 10) > 0) {
      const err = new Error(
        'Cannot delete a role that is currently assigned to users. Reassign those users first.',
      ) as Error & { statusCode: number; code: string };
      err.statusCode = 409;
      err.code = 'CUSTOM_ROLE_HAS_ASSIGNEES';
      throw err;
    }

    await client.query(`DELETE FROM public.custom_roles WHERE id = $1`, [id]);
    await writeAuditEntry(client, {
      recordType: 'custom_role',
      recordId: id,
      recordName: existing.name,
      eventType: 'deleted',
      changedById: actor.id,
      changedByName: actor.name,
    });
    await client.query('COMMIT');
    logger.info({ roleId: id }, 'Custom role deleted');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── User role assignment ───────────────────────────────────────────────────────

/** Returns all custom roles assigned to a user. */
export async function getUserRoles(userId: string): Promise<CustomRoleRow[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    description: string | null;
    is_builtin: boolean;
    capabilities: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT
       cr.id, cr.name, cr.description, cr.is_builtin,
       cr.created_at, cr.updated_at,
       string_agg(rc.capability, ',' ORDER BY rc.capability) AS capabilities
     FROM public.user_custom_roles ucr
     JOIN public.custom_roles cr ON cr.id = ucr.role_id
     LEFT JOIN public.role_capabilities rc ON rc.role_id = cr.id
     WHERE ucr.user_id = $1
     GROUP BY cr.id, cr.name, cr.description, cr.is_builtin, cr.created_at, cr.updated_at
     ORDER BY cr.is_builtin DESC, cr.name ASC`,
    [userId],
  );
  return result.rows.map(toCustomRoleRow);
}

/**
 * Assigns a custom role to a user. Idempotent — re-assigning an existing role
 * is a no-op and returns without error.
 */
export async function assignRoleToUser(
  userId: string,
  roleId: string,
  actor: AuditActor,
): Promise<void> {
  const role = await getCustomRoleById(roleId);
  if (!role) {
    const err = new Error('Custom role not found') as Error & { statusCode: number; code: string };
    err.statusCode = 404;
    err.code = 'CUSTOM_ROLE_NOT_FOUND';
    throw err;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO public.user_custom_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, roleId],
    );

    if (result.rowCount && result.rowCount > 0) {
      await writeAuditEntry(client, {
        recordType: 'user',
        recordId: userId,
        recordName: userId,
        eventType: 'updated',
        fieldName: 'custom_role_assigned',
        newValue: role.name,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Removes a custom role assignment from a user. No-op if not assigned. */
export async function removeRoleFromUser(
  userId: string,
  roleId: string,
  actor: AuditActor,
): Promise<void> {
  const role = await getCustomRoleById(roleId);
  if (!role) {
    const err = new Error('Custom role not found') as Error & { statusCode: number; code: string };
    err.statusCode = 404;
    err.code = 'CUSTOM_ROLE_NOT_FOUND';
    throw err;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `DELETE FROM public.user_custom_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, roleId],
    );

    if (result.rowCount && result.rowCount > 0) {
      await writeAuditEntry(client, {
        recordType: 'user',
        recordId: userId,
        recordName: userId,
        eventType: 'updated',
        fieldName: 'custom_role_removed',
        oldValue: role.name,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function toCustomRoleRow(row: {
  id: string;
  name: string;
  description: string | null;
  is_builtin: boolean;
  capabilities: string | null;
  created_at: Date;
  updated_at: Date;
}): CustomRoleRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    is_builtin: row.is_builtin,
    capabilities: row.capabilities
      ? (row.capabilities.split(',').filter(Boolean) as Capability[])
      : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
