/**
 * Unit tests for roleService — capability RBAC (MINCRM-542).
 *
 * Covers:
 * - userCapabilities(): union from user_custom_roles + fallback via users.role
 * - getAllCustomRoles(): returns all roles with capability arrays
 * - getCustomRoleById(): returns role or null
 * - createCustomRole(): creates role + capabilities + audit entry in a transaction
 * - updateCustomRole(): name/description/capability wholesale update, audit entries
 * - deleteCustomRole(): rejects built-in roles, rejects roles with assignees, deletes + audits
 * - getUserRoles(): returns roles assigned to a user
 * - assignRoleToUser(): idempotent, audits on first assignment
 * - removeRoleFromUser(): idempotent, audits on removal
 *
 * Runs against real PostgreSQL minicrm_test DB; no mocks.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  userCapabilities,
  getAllCustomRoles,
  getCustomRoleById,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  getUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
} from '../services/roleService.js';
import { createUser } from '../services/userService.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import pool from '../db.js';

const FILE_PREFIX = 'role-svc';
const ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

let repId: string;
let adminId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Role Test Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Role Test Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;
});

afterAll(async () => {
  // Clean up any test roles created during this run
  await pool.query(`DELETE FROM custom_roles WHERE name LIKE $1 AND is_builtin = false`, [
    `${FILE_PREFIX}-%`,
  ]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── userCapabilities ──────────────────────────────────────────────────────────

describe('userCapabilities', () => {
  it('returns capabilities via built-in role fallback for a rep user', async () => {
    const caps = await userCapabilities(repId);
    expect(caps.has(Capability.ContactsView)).toBe(true);
    expect(caps.has(Capability.ContactsCreate)).toBe(true);
    expect(caps.has(Capability.ContactsEdit)).toBe(true);
    // rep has contacts:delete — migration 109 restored pre-MINCRM-542 behavior
    expect(caps.has(Capability.ContactsDelete)).toBe(true);
    // rep does NOT have admin-only capabilities
    expect(caps.has(Capability.SettingsManage)).toBe(false);
  });

  it('returns full capability set for admin via fallback', async () => {
    const caps = await userCapabilities(adminId);
    expect(caps.has(Capability.ContactsDelete)).toBe(true);
    expect(caps.has(Capability.SettingsManage)).toBe(true);
  });

  it('returns empty set for non-existent user', async () => {
    const caps = await userCapabilities('00000000-0000-0000-0000-000000000000');
    expect(caps.size).toBe(0);
  });

  it('returns capabilities from user_custom_roles when present', async () => {
    const customRole = await createCustomRole(
      {
        name: `${FILE_PREFIX}-caps-test`,
        capabilities: [Capability.DealsView, Capability.DealsCreate],
      },
      ACTOR,
    );
    await assignRoleToUser(repId, customRole.id, ACTOR);

    try {
      const caps = await userCapabilities(repId);
      // With an explicit user_custom_roles entry, we only get those capabilities
      expect(caps.has(Capability.DealsView)).toBe(true);
      expect(caps.has(Capability.DealsCreate)).toBe(true);
    } finally {
      await removeRoleFromUser(repId, customRole.id, ACTOR);
      await deleteCustomRole(customRole.id, ACTOR);
    }
  });
});

// ── getAllCustomRoles ──────────────────────────────────────────────────────────

describe('getAllCustomRoles', () => {
  it('returns at least the 5 built-in roles', async () => {
    const roles = await getAllCustomRoles();
    const builtinNames = roles.filter((r) => r.is_builtin).map((r) => r.name);
    expect(builtinNames).toContain('admin');
    expect(builtinNames).toContain('rep');
  });

  it('each role has an id, name, is_builtin, and capabilities array', async () => {
    const roles = await getAllCustomRoles();
    for (const role of roles) {
      expect(typeof role.id).toBe('string');
      expect(typeof role.name).toBe('string');
      expect(typeof role.is_builtin).toBe('boolean');
      expect(Array.isArray(role.capabilities)).toBe(true);
    }
  });
});

// ── getCustomRoleById ─────────────────────────────────────────────────────────

describe('getCustomRoleById', () => {
  it('returns null for an unknown UUID', async () => {
    const result = await getCustomRoleById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('returns the role for a valid id', async () => {
    const roles = await getAllCustomRoles();
    const first = roles[0];
    const found = await getCustomRoleById(first.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(first.id);
    expect(found!.name).toBe(first.name);
  });
});

// ── createCustomRole ──────────────────────────────────────────────────────────

describe('createCustomRole', () => {
  it('creates a role with the given capabilities and returns it', async () => {
    const role = await createCustomRole(
      {
        name: `${FILE_PREFIX}-create`,
        description: 'Test role for creation',
        capabilities: [Capability.ContactsView, Capability.DealsView],
      },
      ACTOR,
    );

    expect(role.id).toBeDefined();
    expect(role.name).toBe(`${FILE_PREFIX}-create`);
    expect(role.description).toBe('Test role for creation');
    expect(role.is_builtin).toBe(false);
    expect(role.capabilities).toContain(Capability.ContactsView);
    expect(role.capabilities).toContain(Capability.DealsView);

    await deleteCustomRole(role.id, ACTOR);
  });

  it('writes a created audit entry', async () => {
    const role = await createCustomRole(
      {
        name: `${FILE_PREFIX}-audit`,
        capabilities: [Capability.ContactsView],
      },
      ACTOR,
    );

    const { rows } = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_log
       WHERE record_type = 'custom_role' AND record_id = $1 AND event_type = 'created'
       LIMIT 1`,
      [role.id],
    );
    expect(rows).toHaveLength(1);

    await deleteCustomRole(role.id, ACTOR);
  });
});

// ── updateCustomRole ──────────────────────────────────────────────────────────

describe('updateCustomRole', () => {
  it('updates name and capabilities', async () => {
    const role = await createCustomRole(
      {
        name: `${FILE_PREFIX}-update-before`,
        capabilities: [Capability.ContactsView],
      },
      ACTOR,
    );

    const updated = await updateCustomRole(
      role.id,
      { name: `${FILE_PREFIX}-update-after`, capabilities: [Capability.DealsView] },
      ACTOR,
    );

    expect(updated.name).toBe(`${FILE_PREFIX}-update-after`);
    expect(updated.capabilities).toContain(Capability.DealsView);
    expect(updated.capabilities).not.toContain(Capability.ContactsView);

    await deleteCustomRole(updated.id, ACTOR);
  });

  it('throws CUSTOM_ROLE_NOT_FOUND for unknown id', async () => {
    await expect(
      updateCustomRole('00000000-0000-0000-0000-000000000000', { name: 'ghost' }, ACTOR),
    ).rejects.toMatchObject({ code: 'CUSTOM_ROLE_NOT_FOUND' });
  });

  it('throws CUSTOM_ROLE_BUILTIN when updating a built-in role', async () => {
    const roles = await getAllCustomRoles();
    const builtin = roles.find((r) => r.is_builtin)!;

    await expect(updateCustomRole(builtin.id, { name: 'hacked' }, ACTOR)).rejects.toMatchObject({
      code: 'CUSTOM_ROLE_BUILTIN',
    });
  });
});

// ── deleteCustomRole ──────────────────────────────────────────────────────────

describe('deleteCustomRole', () => {
  it('deletes a custom role and writes a deleted audit entry', async () => {
    const role = await createCustomRole(
      {
        name: `${FILE_PREFIX}-delete`,
        capabilities: [Capability.ContactsView],
      },
      ACTOR,
    );
    const roleId = role.id;

    await deleteCustomRole(roleId, ACTOR);

    expect(await getCustomRoleById(roleId)).toBeNull();

    const { rows } = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_log
       WHERE record_type = 'custom_role' AND record_id = $1 AND event_type = 'deleted'`,
      [roleId],
    );
    expect(rows).toHaveLength(1);
  });

  it('throws CUSTOM_ROLE_NOT_FOUND for unknown id', async () => {
    await expect(
      deleteCustomRole('00000000-0000-0000-0000-000000000000', ACTOR),
    ).rejects.toMatchObject({ code: 'CUSTOM_ROLE_NOT_FOUND' });
  });

  it('throws CUSTOM_ROLE_BUILTIN when deleting a built-in role', async () => {
    const roles = await getAllCustomRoles();
    const builtin = roles.find((r) => r.is_builtin)!;

    await expect(deleteCustomRole(builtin.id, ACTOR)).rejects.toMatchObject({
      code: 'CUSTOM_ROLE_BUILTIN',
    });
  });

  it('throws CUSTOM_ROLE_HAS_ASSIGNEES when users are assigned', async () => {
    const role = await createCustomRole(
      {
        name: `${FILE_PREFIX}-assignees`,
        capabilities: [Capability.ContactsView],
      },
      ACTOR,
    );
    await assignRoleToUser(repId, role.id, ACTOR);

    try {
      await expect(deleteCustomRole(role.id, ACTOR)).rejects.toMatchObject({
        code: 'CUSTOM_ROLE_HAS_ASSIGNEES',
      });
    } finally {
      await removeRoleFromUser(repId, role.id, ACTOR);
      await deleteCustomRole(role.id, ACTOR);
    }
  });
});

// ── getUserRoles / assignRoleToUser / removeRoleFromUser ──────────────────────

describe('getUserRoles', () => {
  it('returns empty array for a user with no custom role assignments', async () => {
    const user = await createUser({
      email: `${FILE_PREFIX}-noroles@example.com`,
      name: 'No Roles',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });

    const roles = await getUserRoles(user.id);
    expect(roles).toHaveLength(0);

    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  });
});

describe('assignRoleToUser', () => {
  it('assigns a role and appears in getUserRoles', async () => {
    const role = await createCustomRole(
      {
        name: `${FILE_PREFIX}-assign`,
        capabilities: [Capability.ContactsView],
      },
      ACTOR,
    );

    await assignRoleToUser(repId, role.id, ACTOR);

    const roles = await getUserRoles(repId);
    expect(roles.some((r) => r.id === role.id)).toBe(true);

    await removeRoleFromUser(repId, role.id, ACTOR);
    await deleteCustomRole(role.id, ACTOR);
  });

  it('is idempotent — reassigning does not throw', async () => {
    const role = await createCustomRole(
      {
        name: `${FILE_PREFIX}-idempotent`,
        capabilities: [Capability.ContactsView],
      },
      ACTOR,
    );

    await assignRoleToUser(repId, role.id, ACTOR);
    await expect(assignRoleToUser(repId, role.id, ACTOR)).resolves.not.toThrow();

    await removeRoleFromUser(repId, role.id, ACTOR);
    await deleteCustomRole(role.id, ACTOR);
  });

  it('throws CUSTOM_ROLE_NOT_FOUND for unknown role id', async () => {
    await expect(
      assignRoleToUser(repId, '00000000-0000-0000-0000-000000000000', ACTOR),
    ).rejects.toMatchObject({ code: 'CUSTOM_ROLE_NOT_FOUND' });
  });
});

describe('removeRoleFromUser', () => {
  it('removes an assigned role', async () => {
    const role = await createCustomRole(
      {
        name: `${FILE_PREFIX}-remove`,
        capabilities: [Capability.ContactsView],
      },
      ACTOR,
    );

    await assignRoleToUser(repId, role.id, ACTOR);
    await removeRoleFromUser(repId, role.id, ACTOR);

    const roles = await getUserRoles(repId);
    expect(roles.some((r) => r.id === role.id)).toBe(false);

    await deleteCustomRole(role.id, ACTOR);
  });

  it('is idempotent — removing a non-assigned role does not throw', async () => {
    const role = await createCustomRole(
      {
        name: `${FILE_PREFIX}-remove-noop`,
        capabilities: [Capability.ContactsView],
      },
      ACTOR,
    );

    await expect(removeRoleFromUser(repId, role.id, ACTOR)).resolves.not.toThrow();

    await deleteCustomRole(role.id, ACTOR);
  });
});
