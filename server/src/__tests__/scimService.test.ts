/**
 * Integration tests for SCIM 2.0 services.
 *
 * Covers:
 * - scimTokenService: generate, getScimTokenMeta, revokeScimToken, validateScimToken
 * - scimUserService: provisionScimUser, getScimUser, listScimUsers, replaceScimUser, patchScimUser
 * - scimGroupService: provisionScimGroup, getScimGroup, getScimGroupById, listScimGroups,
 *   syncScimGroupMembers, deleteScimGroup, setScimGroupRoleMapping, deleteScimGroupRoleMapping,
 *   listScimGroupRoleMappings, toScimGroup
 */

import 'dotenv/config';
import pool from '../db.js';
import {
  generateScimToken,
  getScimTokenMeta,
  revokeScimToken,
  validateScimToken,
} from '../services/scimTokenService.js';
import {
  provisionScimUser,
  getScimUser,
  listScimUsers,
  replaceScimUser,
  patchScimUser,
  toScimUser,
} from '../services/scimUserService.js';
import {
  provisionScimGroup,
  getScimGroup,
  getScimGroupById,
  listScimGroups,
  syncScimGroupMembers,
  deleteScimGroup,
  setScimGroupRoleMapping,
  deleteScimGroupRoleMapping,
  listScimGroupRoleMappings,
  toScimGroup,
} from '../services/scimGroupService.js';
import { createUser } from '../services/userService.js';

const FILE_PREFIX = 'scim-svc';
const BASE_URL = 'http://localhost:3001';

// The ACTOR must be a real user to satisfy scim_tokens.created_by FK.
let ACTOR = { id: '', name: 'SCIM Test Actor' };

// ── Setup/teardown ─────────────────────────────────────────────────────────────

async function cleanupTestRows(): Promise<void> {
  // Delete non-actor test rows in FK-safe order
  await pool.query(
    `DELETE FROM user_custom_roles WHERE user_id IN (
    SELECT id FROM users WHERE email LIKE $1 AND email != $2
  )`,
    [`${FILE_PREFIX}-%`, `${FILE_PREFIX}-actor@example.com`],
  );
  await pool.query(
    `DELETE FROM team_memberships WHERE team_id IN (
    SELECT id FROM teams WHERE name LIKE $1
  )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(`DELETE FROM scim_group_role_mappings WHERE scim_group_id LIKE $1`, [
    `${FILE_PREFIX}-%`,
  ]);
  await pool.query(`DELETE FROM teams WHERE name LIKE $1`, [`${FILE_PREFIX}-%`]);
  await pool.query(`DELETE FROM users WHERE email LIKE $1 AND email != $2`, [
    `${FILE_PREFIX}-%`,
    `${FILE_PREFIX}-actor@example.com`,
  ]);
  await pool.query(`DELETE FROM scim_tokens`);
  await pool.query(`DELETE FROM custom_roles WHERE name LIKE $1 AND is_builtin = false`, [
    `${FILE_PREFIX}-%`,
  ]);
}

beforeAll(async () => {
  // Full cleanup first, then create the actor user
  await pool.query(
    `DELETE FROM user_custom_roles WHERE user_id IN (
    SELECT id FROM users WHERE email LIKE $1
  )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM team_memberships WHERE team_id IN (
    SELECT id FROM teams WHERE name LIKE $1
  )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(`DELETE FROM scim_group_role_mappings WHERE scim_group_id LIKE $1`, [
    `${FILE_PREFIX}-%`,
  ]);
  await pool.query(`DELETE FROM teams WHERE name LIKE $1`, [`${FILE_PREFIX}-%`]);
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${FILE_PREFIX}-%`]);
  await pool.query(`DELETE FROM scim_tokens`);
  await pool.query(`DELETE FROM custom_roles WHERE name LIKE $1 AND is_builtin = false`, [
    `${FILE_PREFIX}-%`,
  ]);

  // Create a real user so scim_tokens.created_by FK is satisfied
  const actorUser = await createUser({
    email: `${FILE_PREFIX}-actor@example.com`,
    name: 'SCIM Test Actor',
    role: 'admin',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  ACTOR = { id: actorUser.id, name: actorUser.name };
});

beforeEach(async () => {
  await cleanupTestRows();
});

afterAll(async () => {
  // Full cleanup including actor user
  await pool.query(
    `DELETE FROM user_custom_roles WHERE user_id IN (
    SELECT id FROM users WHERE email LIKE $1
  )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM team_memberships WHERE team_id IN (
    SELECT id FROM teams WHERE name LIKE $1
  )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(`DELETE FROM scim_group_role_mappings WHERE scim_group_id LIKE $1`, [
    `${FILE_PREFIX}-%`,
  ]);
  await pool.query(`DELETE FROM teams WHERE name LIKE $1`, [`${FILE_PREFIX}-%`]);
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${FILE_PREFIX}-%`]);
  await pool.query(`DELETE FROM scim_tokens`);
  await pool.query(`DELETE FROM custom_roles WHERE name LIKE $1 AND is_builtin = false`, [
    `${FILE_PREFIX}-%`,
  ]);
  await pool.end();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

async function makeUser(suffix: string, opts: { role?: string; scimExternalId?: string } = {}) {
  const user = await createUser({
    email: `${FILE_PREFIX}-${suffix}@example.com`,
    name: `SCIM Test ${suffix}`,
    role: (opts.role ?? 'rep') as 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  if (opts.scimExternalId) {
    await pool.query(`UPDATE users SET scim_external_id = $1 WHERE id = $2`, [
      opts.scimExternalId,
      user.id,
    ]);
  }
  return user;
}

async function makeCustomRole(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO custom_roles (name, is_builtin, created_at, updated_at)
     VALUES ($1, false, now(), now())
     RETURNING id`,
    [name],
  );
  return result.rows[0]!.id;
}

async function makeScimTeam(suffix: string, externalGroupId?: string) {
  return provisionScimGroup(
    externalGroupId ?? `${FILE_PREFIX}-ext-${suffix}`,
    `${FILE_PREFIX}-${suffix}`,
    ACTOR,
  );
}

// ── scimTokenService ──────────────────────────────────────────────────────────

describe('generateScimToken', () => {
  it('returns id, rawToken, and createdAt', async () => {
    const token = await generateScimToken(ACTOR);
    expect(token.id).toBeDefined();
    expect(typeof token.rawToken).toBe('string');
    expect(token.rawToken).toHaveLength(64); // 32 bytes hex
    expect(token.createdAt).toBeInstanceOf(Date);
  });

  it('replaces any existing token atomically', async () => {
    const first = await generateScimToken(ACTOR);
    const second = await generateScimToken(ACTOR);

    expect(second.id).not.toBe(first.id);
    const count = await pool.query('SELECT COUNT(*) FROM scim_tokens');
    expect(Number(count.rows[0].count)).toBe(1);
  });

  it('writes an audit entry', async () => {
    const token = await generateScimToken(ACTOR);
    const audit = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'scim_token' AND record_id = $1 AND event_type = 'created'`,
      [token.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].changed_by_id).toBe(ACTOR.id);
  });
});

describe('getScimTokenMeta', () => {
  it('returns null when no token exists', async () => {
    const meta = await getScimTokenMeta();
    expect(meta).toBeNull();
  });

  it('returns metadata for the active token', async () => {
    const generated = await generateScimToken(ACTOR);
    const meta = await getScimTokenMeta();

    expect(meta).not.toBeNull();
    expect(meta!.id).toBe(generated.id);
    expect(meta!.createdAt).toBeInstanceOf(Date);
    expect(meta!.lastUsedAt).toBeNull();
  });
});

describe('revokeScimToken', () => {
  it('returns false when no token exists', async () => {
    const deleted = await revokeScimToken(ACTOR);
    expect(deleted).toBe(false);
  });

  it('returns true and deletes the token', async () => {
    await generateScimToken(ACTOR);
    const deleted = await revokeScimToken(ACTOR);
    expect(deleted).toBe(true);
    expect(await getScimTokenMeta()).toBeNull();
  });

  it('writes an audit entry on revocation', async () => {
    const token = await generateScimToken(ACTOR);
    await revokeScimToken(ACTOR);
    const audit = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'scim_token' AND record_id = $1 AND event_type = 'deleted'`,
      [token.id],
    );
    expect(audit.rows).toHaveLength(1);
  });
});

describe('validateScimToken', () => {
  it('returns false for an unknown token', async () => {
    const valid = await validateScimToken('deadbeef'.repeat(8));
    expect(valid).toBe(false);
  });

  it('returns true for the active token', async () => {
    const { rawToken } = await generateScimToken(ACTOR);
    const valid = await validateScimToken(rawToken);
    expect(valid).toBe(true);
  });

  it('returns false after the token is revoked', async () => {
    const { rawToken } = await generateScimToken(ACTOR);
    await revokeScimToken(ACTOR);
    const valid = await validateScimToken(rawToken);
    expect(valid).toBe(false);
  });
});

// ── scimUserService ───────────────────────────────────────────────────────────

describe('provisionScimUser', () => {
  it('creates a user with the correct attributes', async () => {
    const user = await provisionScimUser(
      {
        userName: `${FILE_PREFIX}-provision@example.com`,
        givenName: 'Prov',
        familyName: 'User',
        active: true,
        externalId: 'ext-prov-001',
      },
      ACTOR,
    );

    expect(user.email).toBe(`${FILE_PREFIX}-provision@example.com`);
    expect(user.name).toBe('Prov User');
    expect(user.status).toBe('active');
    expect(user.scim_external_id).toBe('ext-prov-001');
  });

  it('sets status=inactive when active=false', async () => {
    const user = await provisionScimUser(
      {
        userName: `${FILE_PREFIX}-inactive@example.com`,
        givenName: 'Inact',
        familyName: 'User',
        active: false,
        externalId: 'ext-inact-001',
      },
      ACTOR,
    );
    expect(user.status).toBe('inactive');
  });

  it('normalises email to lowercase', async () => {
    const user = await provisionScimUser(
      {
        userName: `${FILE_PREFIX}-UPPER@EXAMPLE.COM`,
        givenName: 'U',
        familyName: 'P',
        externalId: 'ext-up-001',
      },
      ACTOR,
    );
    expect(user.email).toBe(`${FILE_PREFIX}-upper@example.com`);
  });

  it('throws 409 when email already exists', async () => {
    await provisionScimUser(
      {
        userName: `${FILE_PREFIX}-dup@example.com`,
        givenName: 'D',
        familyName: 'U',
        externalId: 'ext-dup-001',
      },
      ACTOR,
    );
    await expect(
      provisionScimUser(
        {
          userName: `${FILE_PREFIX}-dup@example.com`,
          givenName: 'D',
          familyName: 'U',
          externalId: 'ext-dup-002',
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SCIM_USER_CONFLICT' });
  });

  it('writes an audit entry', async () => {
    const user = await provisionScimUser(
      {
        userName: `${FILE_PREFIX}-audit-u@example.com`,
        givenName: 'A',
        familyName: 'U',
        externalId: 'ext-au-001',
      },
      ACTOR,
    );
    const audit = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'user' AND record_id = $1 AND event_type = 'created'`,
      [user.id],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('falls back to the user UUID when externalId is absent', async () => {
    const user = await provisionScimUser(
      {
        userName: `${FILE_PREFIX}-no-extid@example.com`,
        givenName: 'No',
        familyName: 'ExtId',
      },
      ACTOR,
    );
    // scim_external_id must not be null — the user must be reachable via GET/PUT/PATCH
    expect(user.scim_external_id).not.toBeNull();
    expect(user.scim_external_id).toBe(user.id);
    // Confirm getScimUser finds them
    const found = await getScimUser(user.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(user.id);
  });
});

describe('getScimUser', () => {
  it('returns null for a non-existent ID', async () => {
    const result = await getScimUser('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('returns null for a user without scim_external_id', async () => {
    const user = await makeUser('noscim');
    const result = await getScimUser(user.id);
    expect(result).toBeNull();
  });

  it('returns the user when scim_external_id is set', async () => {
    const user = await makeUser('withscim', { scimExternalId: 'ext-ws-001' });
    const result = await getScimUser(user.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(user.id);
  });
});

describe('listScimUsers', () => {
  it('returns only users with scim_external_id', async () => {
    await makeUser('ls-no-scim');
    await makeUser('ls-scim', { scimExternalId: 'ext-ls-001' });

    const users = await listScimUsers();
    const emails = users.map((u) => u.email);
    expect(emails).toContain(`${FILE_PREFIX}-ls-scim@example.com`);
    expect(emails).not.toContain(`${FILE_PREFIX}-ls-no-scim@example.com`);
  });

  it('filters by userName eq filter', async () => {
    await makeUser('ls-filter', { scimExternalId: 'ext-lsf-001' });
    await makeUser('ls-other', { scimExternalId: 'ext-lso-001' });

    const results = await listScimUsers(`userName eq "${FILE_PREFIX}-ls-filter@example.com"`);
    expect(results).toHaveLength(1);
    expect(results[0]!.email).toBe(`${FILE_PREFIX}-ls-filter@example.com`);
  });

  it('returns all SCIM users when filter does not match userName eq pattern', async () => {
    await makeUser('ls-all', { scimExternalId: 'ext-lsa-001' });
    const results = await listScimUsers('displayName eq "something"');
    // Falls back to listing all scim users — just verify it doesn't throw
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('replaceScimUser', () => {
  it('updates email, name, and active fields', async () => {
    const user = await makeUser('replace', { scimExternalId: 'ext-rep-001' });
    const updated = await replaceScimUser(
      user.id,
      {
        userName: `${FILE_PREFIX}-replace-new@example.com`,
        givenName: 'New',
        familyName: 'Name',
        active: false,
      },
      ACTOR,
    );
    expect(updated.email).toBe(`${FILE_PREFIX}-replace-new@example.com`);
    expect(updated.name).toBe('New Name');
    expect(updated.status).toBe('inactive');
  });

  it('throws 404 for a user without scim_external_id', async () => {
    const user = await makeUser('replace-noscim');
    await expect(
      replaceScimUser(
        user.id,
        { userName: `${FILE_PREFIX}-x@example.com`, givenName: 'X', familyName: 'Y', active: true },
        ACTOR,
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: 'SCIM_USER_NOT_FOUND' });
  });

  it('activates user when active=true', async () => {
    const user = await makeUser('replace-activate', { scimExternalId: 'ext-ractvt-001' });
    await pool.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [user.id]);
    const updated = await replaceScimUser(
      user.id,
      {
        userName: `${FILE_PREFIX}-replace-activate@example.com`,
        givenName: 'Active',
        familyName: 'User',
        active: true,
      },
      ACTOR,
    );
    expect(updated.status).toBe('active');
  });

  it('uses email as name when both givenName and familyName are empty', async () => {
    const user = await makeUser('replace-noname', { scimExternalId: 'ext-rnn-001' });
    const updated = await replaceScimUser(
      user.id,
      {
        userName: `${FILE_PREFIX}-replace-noname@example.com`,
        givenName: '',
        familyName: '',
        active: true,
      },
      ACTOR,
    );
    // When both names are blank, name falls back to email
    expect(updated.name).toBe(`${FILE_PREFIX}-replace-noname@example.com`);
  });

  it('does not deactivate admin users', async () => {
    const admin = await makeUser('replace-admin', { scimExternalId: 'ext-ra-001' });
    await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [admin.id]);

    const updated = await replaceScimUser(
      admin.id,
      {
        userName: `${FILE_PREFIX}-replace-admin@example.com`,
        givenName: 'Admin',
        familyName: 'User',
        active: false,
      },
      ACTOR,
    );
    expect(updated.status).toBe('active');
  });
});

describe('patchScimUser', () => {
  it('deactivates user via op:replace on active', async () => {
    const user = await makeUser('patch-deact', { scimExternalId: 'ext-pd-001' });
    const updated = await patchScimUser(
      user.id,
      [{ op: 'replace', path: 'active', value: false }],
      ACTOR,
    );
    expect(updated.status).toBe('inactive');
  });

  it('deactivates user via op:remove on active', async () => {
    const user = await makeUser('patch-remove', { scimExternalId: 'ext-pr-001' });
    const updated = await patchScimUser(user.id, [{ op: 'remove', path: 'active' }], ACTOR);
    expect(updated.status).toBe('inactive');
  });

  it('updates givenName and familyName', async () => {
    const user = await makeUser('patch-name', { scimExternalId: 'ext-pn-001' });
    const updated = await patchScimUser(
      user.id,
      [
        { op: 'replace', path: 'name.givenName', value: 'Jane' },
        { op: 'replace', path: 'name.familyName', value: 'Doe' },
      ],
      ACTOR,
    );
    expect(updated.name).toBe('Jane Doe');
  });

  it('updates active via whole-object value with no path', async () => {
    const user = await makeUser('patch-obj', { scimExternalId: 'ext-po-001' });
    const updated = await patchScimUser(
      user.id,
      [{ op: 'replace', value: { active: false } }],
      ACTOR,
    );
    expect(updated.status).toBe('inactive');
  });

  it('updates userName via path', async () => {
    const user = await makeUser('patch-username', { scimExternalId: 'ext-pu-001' });
    const updated = await patchScimUser(
      user.id,
      [{ op: 'replace', path: 'userName', value: `${FILE_PREFIX}-patch-username-new@example.com` }],
      ACTOR,
    );
    expect(updated.email).toBe(`${FILE_PREFIX}-patch-username-new@example.com`);
  });

  it('updates displayName via path', async () => {
    const user = await makeUser('patch-dispname', { scimExternalId: 'ext-pdn-001' });
    const updated = await patchScimUser(
      user.id,
      [{ op: 'replace', path: 'displayName', value: 'Display Updated' }],
      ACTOR,
    );
    expect(updated.name).toBe('Display Updated');
  });

  it('updates givenName and familyName via whole-object value', async () => {
    const user = await makeUser('patch-nameobj', { scimExternalId: 'ext-pno-001' });
    const updated = await patchScimUser(
      user.id,
      [{ op: 'replace', value: { name: { givenName: 'Alice', familyName: 'Wonder' } } }],
      ACTOR,
    );
    expect(updated.name).toBe('Alice Wonder');
  });

  it('updates userName via whole-object value', async () => {
    const user = await makeUser('patch-usernameobj', { scimExternalId: 'ext-puo-001' });
    const updated = await patchScimUser(
      user.id,
      [{ op: 'replace', value: { userName: `${FILE_PREFIX}-patch-usernameobj-new@example.com` } }],
      ACTOR,
    );
    expect(updated.email).toBe(`${FILE_PREFIX}-patch-usernameobj-new@example.com`);
  });

  it('ignores unknown operation paths silently', async () => {
    const user = await makeUser('patch-unknown', { scimExternalId: 'ext-punk-001' });
    const updated = await patchScimUser(
      user.id,
      [{ op: 'replace', path: 'externalId', value: 'ignored' }],
      ACTOR,
    );
    // User should remain unchanged
    expect(updated.email).toBe(`${FILE_PREFIX}-patch-unknown@example.com`);
  });

  it('throws 404 for non-SCIM user', async () => {
    const user = await makeUser('patch-404');
    await expect(
      patchScimUser(user.id, [{ op: 'replace', path: 'active', value: false }], ACTOR),
    ).rejects.toMatchObject({ statusCode: 404, code: 'SCIM_USER_NOT_FOUND' });
  });

  it('does not deactivate admin users', async () => {
    const admin = await makeUser('patch-admin', { scimExternalId: 'ext-pa-001' });
    await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [admin.id]);

    const updated = await patchScimUser(
      admin.id,
      [{ op: 'replace', path: 'active', value: false }],
      ACTOR,
    );
    expect(updated.status).toBe('active');
  });

  it('activates user when active=true is passed', async () => {
    const user = await makeUser('patch-activate', { scimExternalId: 'ext-pact-001' });
    await pool.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [user.id]);
    const updated = await patchScimUser(
      user.id,
      [{ op: 'replace', path: 'active', value: true }],
      ACTOR,
    );
    expect(updated.status).toBe('active');
  });
});

describe('toScimUser', () => {
  it('builds the SCIM wire format correctly', async () => {
    const user = await makeUser('to-scim-user', { scimExternalId: 'ext-tsu-001' });
    const row = await getScimUser(user.id);
    const scim = toScimUser(row!, BASE_URL);

    expect(scim.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:User']);
    expect(scim.id).toBe(user.id);
    expect(scim.userName).toBe(user.email);
    expect(scim.meta.resourceType).toBe('User');
    expect(scim.meta.location).toBe(`${BASE_URL}/scim/v2/Users/${user.id}`);
  });

  it('splits name on first space', async () => {
    const user = await provisionScimUser(
      {
        userName: `${FILE_PREFIX}-split@example.com`,
        givenName: 'First',
        familyName: 'Last Middle',
        externalId: 'ext-split-001',
      },
      ACTOR,
    );
    const scim = toScimUser(user, BASE_URL);
    expect(scim.name.givenName).toBe('First');
    expect(scim.name.familyName).toBe('Last Middle');
  });

  it('handles single-name user with no space', async () => {
    const user = await provisionScimUser(
      {
        userName: `${FILE_PREFIX}-singlename@example.com`,
        givenName: 'Mono',
        familyName: '',
        externalId: 'ext-sn-001',
      },
      ACTOR,
    );
    const scim = toScimUser(user, BASE_URL);
    expect(scim.name.givenName).toBe('Mono');
    expect(scim.name.familyName).toBe('');
  });
});

// ── scimGroupService ──────────────────────────────────────────────────────────

describe('provisionScimGroup', () => {
  it('creates a new team with scim_group_id', async () => {
    const group = await makeScimTeam('pg-new');
    expect(group.id).toBeDefined();
    expect(group.name).toBe(`${FILE_PREFIX}-pg-new`);
    expect(group.scim_group_id).toBe(`${FILE_PREFIX}-ext-pg-new`);
  });

  it('is idempotent — returns existing team for same externalGroupId', async () => {
    const first = await makeScimTeam('pg-idem');
    const second = await provisionScimGroup(
      `${FILE_PREFIX}-ext-pg-idem`,
      `${FILE_PREFIX}-pg-idem-2`,
      ACTOR,
    );
    expect(second.id).toBe(first.id);
  });

  it('throws 409 when team name is already taken by another team', async () => {
    // Create a plain team (no scim_group_id) with the same name
    await pool.query(
      `INSERT INTO teams (name, manager_id, parent_team_id, created_at, updated_at)
       VALUES ($1, NULL, NULL, now(), now())`,
      [`${FILE_PREFIX}-pg-dup`],
    );
    await expect(
      provisionScimGroup(`${FILE_PREFIX}-ext-pg-dup`, `${FILE_PREFIX}-pg-dup`, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SCIM_GROUP_CONFLICT' });
  });

  it('writes an audit entry on creation', async () => {
    const group = await makeScimTeam('pg-audit');
    const audit = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'team' AND record_id = $1 AND event_type = 'created'`,
      [group.id],
    );
    expect(audit.rows).toHaveLength(1);
  });
});

describe('getScimGroup', () => {
  it('returns null for unknown scim_group_id', async () => {
    const result = await getScimGroup('does-not-exist');
    expect(result).toBeNull();
  });

  it('returns the group and its members', async () => {
    const group = await makeScimTeam('gg-basic');
    const user = await makeUser('gg-member', { scimExternalId: 'ext-ggm-001' });
    await pool.query(
      `INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'member')`,
      [group.id, user.id],
    );

    const entry = await getScimGroup(group.scim_group_id!);
    expect(entry).not.toBeNull();
    expect(entry!.group.id).toBe(group.id);
    expect(entry!.members).toHaveLength(1);
    expect(entry!.members[0]!.value).toBe(user.id);
  });
});

describe('getScimGroupById', () => {
  it('returns null for a non-existent UUID', async () => {
    const result = await getScimGroupById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('returns null for a team without scim_group_id', async () => {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO teams (name, manager_id, parent_team_id, created_at, updated_at)
       VALUES ($1, NULL, NULL, now(), now())
       RETURNING id`,
      [`${FILE_PREFIX}-ggbi-plain`],
    );
    const teamId = res.rows[0]!.id;
    const entry = await getScimGroupById(teamId);
    expect(entry).toBeNull();
  });

  it('returns the group for a SCIM-provisioned team', async () => {
    const group = await makeScimTeam('ggbi-found');
    const entry = await getScimGroupById(group.id);
    expect(entry).not.toBeNull();
    expect(entry!.group.id).toBe(group.id);
  });
});

describe('listScimGroups', () => {
  it('returns only teams with scim_group_id', async () => {
    await makeScimTeam('lg-scim');
    await pool.query(
      `INSERT INTO teams (name, manager_id, parent_team_id, created_at, updated_at)
       VALUES ($1, NULL, NULL, now(), now())`,
      [`${FILE_PREFIX}-lg-plain`],
    );

    const groups = await listScimGroups();
    const names = groups.map((g) => g.group.name);
    expect(names).toContain(`${FILE_PREFIX}-lg-scim`);
    expect(names).not.toContain(`${FILE_PREFIX}-lg-plain`);
  });

  it('returns empty array when no SCIM teams exist', async () => {
    const groups = await listScimGroups();
    expect(groups).toEqual([]);
  });
});

describe('syncScimGroupMembers', () => {
  it('adds new members to the team', async () => {
    const group = await makeScimTeam('sync-add');
    const user = await makeUser('sync-add-u');
    await syncScimGroupMembers(group.id, [user.id], ACTOR);

    const entry = await getScimGroupById(group.id);
    expect(entry!.members.map((m) => m.value)).toContain(user.id);
  });

  it('removes members no longer in the list', async () => {
    const group = await makeScimTeam('sync-rem');
    const u1 = await makeUser('sync-rem-u1');
    const u2 = await makeUser('sync-rem-u2');
    await pool.query(
      `INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
      [group.id, u1.id, u2.id],
    );

    await syncScimGroupMembers(group.id, [u1.id], ACTOR);

    const entry = await getScimGroupById(group.id);
    const memberIds = entry!.members.map((m) => m.value);
    expect(memberIds).toContain(u1.id);
    expect(memberIds).not.toContain(u2.id);
  });

  it('assigns the mapped custom role when adding members', async () => {
    const group = await makeScimTeam('sync-role-add');
    const roleId = await makeCustomRole(`${FILE_PREFIX}-sync-role`);
    await setScimGroupRoleMapping(
      group.scim_group_id!,
      `${FILE_PREFIX}-sync-role-add`,
      roleId,
      ACTOR,
    );

    const user = await makeUser('sync-role-add-u');
    await syncScimGroupMembers(group.id, [user.id], ACTOR);

    const ucr = await pool.query(
      `SELECT * FROM user_custom_roles WHERE user_id = $1 AND role_id = $2`,
      [user.id, roleId],
    );
    expect(ucr.rows).toHaveLength(1);
  });

  it('revokes the mapped role when removing a member with no other group grant', async () => {
    const group = await makeScimTeam('sync-role-rem');
    const roleId = await makeCustomRole(`${FILE_PREFIX}-sync-role-rem`);
    await setScimGroupRoleMapping(
      group.scim_group_id!,
      `${FILE_PREFIX}-sync-role-rem`,
      roleId,
      ACTOR,
    );

    const user = await makeUser('sync-role-rem-u');
    await syncScimGroupMembers(group.id, [user.id], ACTOR);
    await syncScimGroupMembers(group.id, [], ACTOR);

    const ucr = await pool.query(
      `SELECT * FROM user_custom_roles WHERE user_id = $1 AND role_id = $2`,
      [user.id, roleId],
    );
    expect(ucr.rows).toHaveLength(0);
  });

  it('does not revoke the role if member still holds it via another group', async () => {
    const group1 = await makeScimTeam('sync-multi-g1');
    const group2 = await makeScimTeam('sync-multi-g2');
    const roleId = await makeCustomRole(`${FILE_PREFIX}-sync-multi-role`);
    await setScimGroupRoleMapping(
      group1.scim_group_id!,
      `${FILE_PREFIX}-sync-multi-g1`,
      roleId,
      ACTOR,
    );
    await setScimGroupRoleMapping(
      group2.scim_group_id!,
      `${FILE_PREFIX}-sync-multi-g2`,
      roleId,
      ACTOR,
    );

    const user = await makeUser('sync-multi-u');
    await syncScimGroupMembers(group1.id, [user.id], ACTOR);
    await syncScimGroupMembers(group2.id, [user.id], ACTOR);

    // Remove from group1 — group2 still grants the role
    await syncScimGroupMembers(group1.id, [], ACTOR);

    const ucr = await pool.query(
      `SELECT * FROM user_custom_roles WHERE user_id = $1 AND role_id = $2`,
      [user.id, roleId],
    );
    expect(ucr.rows).toHaveLength(1);
  });

  it('throws 404 for a non-SCIM team', async () => {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO teams (name, manager_id, parent_team_id, created_at, updated_at)
       VALUES ($1, NULL, NULL, now(), now())
       RETURNING id`,
      [`${FILE_PREFIX}-sync-plain`],
    );
    const teamId = res.rows[0]!.id;
    await expect(syncScimGroupMembers(teamId, [], ACTOR)).rejects.toMatchObject({
      statusCode: 404,
      code: 'TEAM_NOT_FOUND',
    });
  });
});

describe('deleteScimGroup', () => {
  it('returns false for a non-existent team', async () => {
    const deleted = await deleteScimGroup('00000000-0000-0000-0000-000000000000', ACTOR);
    expect(deleted).toBe(false);
  });

  it('returns false for a non-SCIM team', async () => {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO teams (name, manager_id, parent_team_id, created_at, updated_at)
       VALUES ($1, NULL, NULL, now(), now())
       RETURNING id`,
      [`${FILE_PREFIX}-del-plain`],
    );
    const deleted = await deleteScimGroup(res.rows[0]!.id, ACTOR);
    expect(deleted).toBe(false);
  });

  it('deletes the team and its memberships', async () => {
    const group = await makeScimTeam('del-basic');
    const user = await makeUser('del-basic-u');
    await pool.query(
      `INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'member')`,
      [group.id, user.id],
    );

    const deleted = await deleteScimGroup(group.id, ACTOR);
    expect(deleted).toBe(true);
    expect(await getScimGroupById(group.id)).toBeNull();
  });

  it('revokes the mapped role from members on deletion', async () => {
    const group = await makeScimTeam('del-role');
    const roleId = await makeCustomRole(`${FILE_PREFIX}-del-role`);
    await setScimGroupRoleMapping(group.scim_group_id!, `${FILE_PREFIX}-del-role`, roleId, ACTOR);

    const user = await makeUser('del-role-u');
    await syncScimGroupMembers(group.id, [user.id], ACTOR);

    await deleteScimGroup(group.id, ACTOR);

    const ucr = await pool.query(
      `SELECT * FROM user_custom_roles WHERE user_id = $1 AND role_id = $2`,
      [user.id, roleId],
    );
    expect(ucr.rows).toHaveLength(0);
  });

  it('does not revoke the role when another group still grants it', async () => {
    const group1 = await makeScimTeam('del-multi-g1');
    const group2 = await makeScimTeam('del-multi-g2');
    const roleId = await makeCustomRole(`${FILE_PREFIX}-del-multi-role`);
    await setScimGroupRoleMapping(
      group1.scim_group_id!,
      `${FILE_PREFIX}-del-multi-g1`,
      roleId,
      ACTOR,
    );
    await setScimGroupRoleMapping(
      group2.scim_group_id!,
      `${FILE_PREFIX}-del-multi-g2`,
      roleId,
      ACTOR,
    );

    const user = await makeUser('del-multi-u');
    await syncScimGroupMembers(group1.id, [user.id], ACTOR);
    await syncScimGroupMembers(group2.id, [user.id], ACTOR);

    await deleteScimGroup(group1.id, ACTOR);

    const ucr = await pool.query(
      `SELECT * FROM user_custom_roles WHERE user_id = $1 AND role_id = $2`,
      [user.id, roleId],
    );
    expect(ucr.rows).toHaveLength(1);
  });

  it('writes an audit entry on deletion', async () => {
    const group = await makeScimTeam('del-audit');
    await deleteScimGroup(group.id, ACTOR);

    const audit = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'team' AND record_id = $1 AND event_type = 'deleted'`,
      [group.id],
    );
    expect(audit.rows).toHaveLength(1);
  });
});

describe('setScimGroupRoleMapping', () => {
  it('creates a new mapping', async () => {
    const roleId = await makeCustomRole(`${FILE_PREFIX}-set-mapping`);
    await setScimGroupRoleMapping(`${FILE_PREFIX}-sg-001`, 'Test Group', roleId, ACTOR);

    const rows = await listScimGroupRoleMappings();
    const mapping = rows.find((m) => m.scim_group_id === `${FILE_PREFIX}-sg-001`);
    expect(mapping).not.toBeUndefined();
    expect(mapping!.role_id).toBe(roleId);
  });

  it('updates an existing mapping (upsert)', async () => {
    const roleId1 = await makeCustomRole(`${FILE_PREFIX}-set-upsert-1`);
    const roleId2 = await makeCustomRole(`${FILE_PREFIX}-set-upsert-2`);
    await setScimGroupRoleMapping(`${FILE_PREFIX}-sg-upsert`, 'Upsert Group', roleId1, ACTOR);
    await setScimGroupRoleMapping(`${FILE_PREFIX}-sg-upsert`, 'Upsert Group', roleId2, ACTOR);

    const rows = await listScimGroupRoleMappings();
    const mappings = rows.filter((m) => m.scim_group_id === `${FILE_PREFIX}-sg-upsert`);
    expect(mappings).toHaveLength(1);
    expect(mappings[0]!.role_id).toBe(roleId2);
  });
});

describe('deleteScimGroupRoleMapping', () => {
  it('returns false when no mapping exists', async () => {
    const deleted = await deleteScimGroupRoleMapping('no-such-group');
    expect(deleted).toBe(false);
  });

  it('deletes the mapping and returns true', async () => {
    const roleId = await makeCustomRole(`${FILE_PREFIX}-del-mapping`);
    await setScimGroupRoleMapping(`${FILE_PREFIX}-sg-del`, 'Del Group', roleId, ACTOR);

    const deleted = await deleteScimGroupRoleMapping(`${FILE_PREFIX}-sg-del`);
    expect(deleted).toBe(true);

    const rows = await listScimGroupRoleMappings();
    expect(rows.find((m) => m.scim_group_id === `${FILE_PREFIX}-sg-del`)).toBeUndefined();
  });

  it('revokes the role from current team members when the mapping is deleted', async () => {
    const group = await makeScimTeam('delmap-role');
    const roleId = await makeCustomRole(`${FILE_PREFIX}-delmap-role`);
    await setScimGroupRoleMapping(
      group.scim_group_id!,
      `${FILE_PREFIX}-delmap-role`,
      roleId,
      ACTOR,
    );

    const user = await makeUser('delmap-role-u');
    await syncScimGroupMembers(group.id, [user.id], ACTOR);

    await deleteScimGroupRoleMapping(group.scim_group_id!);

    const ucr = await pool.query(
      `SELECT * FROM user_custom_roles WHERE user_id = $1 AND role_id = $2`,
      [user.id, roleId],
    );
    expect(ucr.rows).toHaveLength(0);
  });

  it('preserves role when user holds it via another mapping', async () => {
    const group1 = await makeScimTeam('delmap-multi-g1');
    const group2 = await makeScimTeam('delmap-multi-g2');
    const roleId = await makeCustomRole(`${FILE_PREFIX}-delmap-multi-role`);
    await setScimGroupRoleMapping(
      group1.scim_group_id!,
      `${FILE_PREFIX}-delmap-multi-g1`,
      roleId,
      ACTOR,
    );
    await setScimGroupRoleMapping(
      group2.scim_group_id!,
      `${FILE_PREFIX}-delmap-multi-g2`,
      roleId,
      ACTOR,
    );

    const user = await makeUser('delmap-multi-u');
    await syncScimGroupMembers(group1.id, [user.id], ACTOR);
    await syncScimGroupMembers(group2.id, [user.id], ACTOR);

    // Delete group1 mapping — group2 still grants the role
    await deleteScimGroupRoleMapping(group1.scim_group_id!);

    const ucr = await pool.query(
      `SELECT * FROM user_custom_roles WHERE user_id = $1 AND role_id = $2`,
      [user.id, roleId],
    );
    expect(ucr.rows).toHaveLength(1);
  });
});

describe('listScimGroupRoleMappings', () => {
  it('returns all mappings ordered by group name', async () => {
    const roleId = await makeCustomRole(`${FILE_PREFIX}-list-role`);
    await setScimGroupRoleMapping(`${FILE_PREFIX}-sg-list-z`, 'Zebra Group', roleId, ACTOR);
    await setScimGroupRoleMapping(`${FILE_PREFIX}-sg-list-a`, 'Alpha Group', roleId, ACTOR);

    const rows = await listScimGroupRoleMappings();
    const ours = rows.filter((m) => m.scim_group_id.startsWith(`${FILE_PREFIX}-sg-list`));
    expect(ours.map((m) => m.group_name)).toEqual(['Alpha Group', 'Zebra Group']);
  });
});

describe('toScimGroup', () => {
  it('serializes the group into SCIM wire format', async () => {
    const group = await makeScimTeam('to-scim');
    const scim = toScimGroup(group, [], BASE_URL);

    expect(scim.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:Group']);
    expect(scim.id).toBe(group.id);
    expect(scim.displayName).toBe(group.name);
    expect(scim.members).toEqual([]);
    expect(scim.meta.resourceType).toBe('Group');
    expect(scim.meta.location).toBe(`${BASE_URL}/scim/v2/Groups/${group.id}`);
  });

  it('includes member entries', async () => {
    const group = await makeScimTeam('to-scim-members');
    const user = await makeUser('to-scim-m-u');
    const scim = toScimGroup(group, [{ value: user.id, display: 'Test User' }], BASE_URL);

    expect(scim.members).toHaveLength(1);
    expect(scim.members[0]!.value).toBe(user.id);
    expect(scim.members[0]!.display).toBe('Test User');
  });
});
