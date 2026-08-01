/**
 * Integration tests for visibilityService.
 *
 * Runs against the real minicrm_test PostgreSQL database.
 * Creates isolated users, teams, and memberships per describe block.
 * org_visibility_settings rows are reset to 'org' before each test.
 *
 * Run: npm test --workspace=minicrm-server
 */

import 'dotenv/config';
import {
  buildVisibilityFilter,
  validateReassignment,
  getAllVisibilityPolicies,
  updateVisibilityConfig,
  getVisibilityPolicy,
} from '../services/visibilityService.js';
import { getTeamIdsForManager } from '../services/teamService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

const FILE_PREFIX = 'vis-svc';

/** Minimal user fixture */
interface UserFixture {
  email: string;
  name: string;
  role: 'admin' | 'rep' | 'manager' | 'viewer';
  passwordHash: string;
  status: 'active';
}

function makeUser(label: string, role: UserFixture['role']): UserFixture {
  return {
    email: `${FILE_PREFIX}-${label}@example.com`,
    name: `${FILE_PREFIX} ${label}`,
    role,
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  };
}

/** Persisted IDs allocated in beforeAll */
let adminId: string;
let viewerId: string;
let repId: string;
let managerId: string;
let teamMember1Id: string;
let teamMember2Id: string;
let outsiderId: string;
let teamId: string;
let childTeamId: string;

beforeAll(async () => {
  // Clean up leftovers from prior runs
  await pool.query(
    `DELETE FROM team_memberships
       WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM teams WHERE manager_id IN (SELECT id FROM users WHERE email LIKE $1)
       OR name LIKE $2`,
    [`${FILE_PREFIX}-%`, `${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  // Create users
  const admin = await createUser(makeUser('admin', 'admin'));
  adminId = admin.id;

  const viewer = await createUser(makeUser('viewer', 'viewer'));
  viewerId = viewer.id;

  const rep = await createUser(makeUser('rep', 'rep'));
  repId = rep.id;

  const manager = await createUser(makeUser('manager', 'manager'));
  managerId = manager.id;

  const member1 = await createUser(makeUser('member1', 'rep'));
  teamMember1Id = member1.id;

  const member2 = await createUser(makeUser('member2', 'rep'));
  teamMember2Id = member2.id;

  const outsider = await createUser(makeUser('outsider', 'rep'));
  outsiderId = outsider.id;

  // Create a team managed by manager, and a child team
  const teamResult = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, manager_id) VALUES ($1, $2) RETURNING id`,
    [`${FILE_PREFIX}-alpha`, managerId],
  );
  teamId = teamResult.rows[0].id;

  const childTeamResult = await pool.query<{ id: string }>(
    `INSERT INTO teams (name, manager_id, parent_team_id) VALUES ($1, $2, $3) RETURNING id`,
    [`${FILE_PREFIX}-alpha-child`, managerId, teamId],
  );
  childTeamId = childTeamResult.rows[0].id;

  // Add member1 to the parent team; member2 to the child team
  await pool.query(
    `INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'member')`,
    [teamId, teamMember1Id],
  );
  await pool.query(
    `INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'member')`,
    [childTeamId, teamMember2Id],
  );
  // rep belongs to the parent team for 'team' policy tests
  await pool.query(
    `INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'member')`,
    [teamId, repId],
  );
});

beforeEach(async () => {
  // Reset all visibility settings to 'org' so tests start from a known baseline
  await pool.query(
    `UPDATE org_visibility_settings SET policy = 'org', updated_by = NULL, updated_at = now()`,
  );
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM team_memberships
       WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM teams WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── getAllVisibilityPolicies ─────────────────────────────────────────────────

describe('getAllVisibilityPolicies', () => {
  it('returns org for all three types by default', async () => {
    const config = await getAllVisibilityPolicies();
    expect(config.contact).toBe('org');
    expect(config.deal).toBe('org');
    expect(config.activity).toBe('org');
  });
});

// ── getVisibilityPolicy ──────────────────────────────────────────────────────

describe('getVisibilityPolicy', () => {
  it('returns the stored policy for a given object type', async () => {
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'team' WHERE object_type = 'contact'`,
    );
    const policy = await getVisibilityPolicy('contact');
    expect(policy).toBe('team');
  });
});

// ── updateVisibilityConfig ───────────────────────────────────────────────────

describe('updateVisibilityConfig', () => {
  it('updates only the supplied object type and leaves others unchanged', async () => {
    const actor = { id: adminId, name: `${FILE_PREFIX} admin` };
    await updateVisibilityConfig({ contact: 'private' }, actor);

    const config = await getAllVisibilityPolicies();
    expect(config.contact).toBe('private');
    expect(config.deal).toBe('org');
    expect(config.activity).toBe('org');
  });

  it('updates multiple object types in the same call', async () => {
    const actor = { id: adminId, name: `${FILE_PREFIX} admin` };
    await updateVisibilityConfig({ contact: 'team', deal: 'private' }, actor);

    const config = await getAllVisibilityPolicies();
    expect(config.contact).toBe('team');
    expect(config.deal).toBe('private');
    expect(config.activity).toBe('org');
  });

  it('writes audit entries for each changed field', async () => {
    const actor = { id: adminId, name: `${FILE_PREFIX} admin` };
    await updateVisibilityConfig({ activity: 'private' }, actor);

    const result = await pool.query(
      // changed_by_id scoping: multiple files flip this same org-wide row (see
      // SERIAL_FILES' own comment), so record_type + record_name isolate
      // nothing. (MINCRM-693)
      `SELECT field_name, new_value FROM audit_log
       WHERE record_type = 'org_visibility_settings' AND record_name = 'activity'
         AND changed_by_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [adminId],
    );
    expect(result.rows[0]).toMatchObject({ field_name: 'policy', new_value: 'private' });
  });
});

// ── getTeamIdsForManager ─────────────────────────────────────────────────────

describe('getTeamIdsForManager', () => {
  it('returns root team and child team IDs for the manager', async () => {
    const ids = await getTeamIdsForManager(managerId);
    expect(ids).toContain(teamId);
    expect(ids).toContain(childTeamId);
  });

  it('returns an empty array for a user who manages no teams', async () => {
    const ids = await getTeamIdsForManager(repId);
    expect(ids).toHaveLength(0);
  });
});

// ── buildVisibilityFilter — admin / viewer ───────────────────────────────────

describe('buildVisibilityFilter — admin role', () => {
  it('returns an empty clause (org-wide access)', async () => {
    const filter = await buildVisibilityFilter('contact', adminId, 'admin', 'c.owner_id', 1);
    expect(filter.clause).toBe('');
    expect(filter.params).toHaveLength(0);
  });
});

describe('buildVisibilityFilter — viewer role', () => {
  it('returns an empty clause (org-wide access)', async () => {
    const filter = await buildVisibilityFilter('contact', viewerId, 'viewer', 'c.owner_id', 1);
    expect(filter.clause).toBe('');
    expect(filter.params).toHaveLength(0);
  });
});

// ── buildVisibilityFilter — manager ─────────────────────────────────────────

describe('buildVisibilityFilter — manager role', () => {
  it('returns an IN clause containing both parent and child team members', async () => {
    const filter = await buildVisibilityFilter('contact', managerId, 'manager', 'c.owner_id', 1);
    expect(filter.clause).toMatch(/c\.owner_id IN \(/);
    expect(filter.params).toContain(teamMember1Id);
    expect(filter.params).toContain(teamMember2Id);
  });

  it('ignores the org visibility policy (manager is always team-scoped)', async () => {
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'contact'`,
    );
    const filter = await buildVisibilityFilter('contact', managerId, 'manager', 'c.owner_id', 1);
    // Even with org policy, manager gets team-scoped filter
    expect(filter.clause).not.toBe('');
  });

  it('falls back to own-records filter when manager has no teams', async () => {
    // Create a manager user who manages no teams
    const loneManager = await createUser(makeUser('lone-manager', 'manager'));
    const filter = await buildVisibilityFilter(
      'contact',
      loneManager.id,
      'manager',
      'c.owner_id',
      1,
    );
    expect(filter.clause).toBe('c.owner_id = $1');
    expect(filter.params).toEqual([loneManager.id]);

    await pool.query('DELETE FROM users WHERE id = $1', [loneManager.id]);
  });

  it('uses correct paramOffset when offset is greater than 1', async () => {
    const filter = await buildVisibilityFilter('contact', managerId, 'manager', 'c.owner_id', 5);
    // All placeholder indices should start from $5
    expect(filter.clause).toMatch(/\$5/);
    expect(filter.clause).not.toMatch(/\$1[^0-9]/);
  });
});

// ── buildVisibilityFilter — rep, org policy ──────────────────────────────────

describe('buildVisibilityFilter — rep role, org policy', () => {
  it('returns empty clause when contact policy is org', async () => {
    const filter = await buildVisibilityFilter('contact', repId, 'rep', 'c.owner_id', 1);
    expect(filter.clause).toBe('');
    expect(filter.params).toHaveLength(0);
  });
});

// ── buildVisibilityFilter — rep, private policy ──────────────────────────────

describe('buildVisibilityFilter — rep role, private policy', () => {
  it('returns owner_id = $N when contact policy is private', async () => {
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'private' WHERE object_type = 'contact'`,
    );

    const filter = await buildVisibilityFilter('contact', repId, 'rep', 'c.owner_id', 1);
    expect(filter.clause).toBe('c.owner_id = $1');
    expect(filter.params).toEqual([repId]);
  });

  it('uses the correct paramOffset for private policy', async () => {
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'private' WHERE object_type = 'contact'`,
    );

    const filter = await buildVisibilityFilter('contact', repId, 'rep', 'd.owner_id', 3);
    expect(filter.clause).toBe('d.owner_id = $3');
    expect(filter.params).toEqual([repId]);
  });
});

// ── buildVisibilityFilter — rep, team policy ─────────────────────────────────

describe('buildVisibilityFilter — rep role, team policy', () => {
  beforeEach(async () => {
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'team' WHERE object_type = 'contact'`,
    );
  });

  it('returns IN clause with team members when rep is in a team', async () => {
    const filter = await buildVisibilityFilter('contact', repId, 'rep', 'c.owner_id', 1);
    expect(filter.clause).toMatch(/c\.owner_id IN \(/);
    // repId's team includes member1 (both are in the alpha team)
    expect(filter.params).toContain(teamMember1Id);
  });

  it('falls back to own-records filter when rep belongs to no team', async () => {
    // Create a rep with no team membership
    const loneRep = await createUser(makeUser('lone-rep', 'rep'));
    const filter = await buildVisibilityFilter('contact', loneRep.id, 'rep', 'c.owner_id', 1);
    expect(filter.clause).toBe('c.owner_id = $1');
    expect(filter.params).toEqual([loneRep.id]);

    await pool.query('DELETE FROM users WHERE id = $1', [loneRep.id]);
  });
});

// ── validateReassignment ─────────────────────────────────────────────────────

describe('validateReassignment', () => {
  it('does not throw for admin users regardless of target', async () => {
    await expect(
      validateReassignment(outsiderId, { id: adminId, role: 'admin' }),
    ).resolves.toBeUndefined();
  });

  it('does not throw for rep users regardless of target', async () => {
    await expect(
      validateReassignment(outsiderId, { id: repId, role: 'rep' }),
    ).resolves.toBeUndefined();
  });

  it('does not throw for viewer users regardless of target', async () => {
    await expect(
      validateReassignment(outsiderId, { id: viewerId, role: 'viewer' }),
    ).resolves.toBeUndefined();
  });

  it('does not throw when manager reassigns to a member of their team', async () => {
    await expect(
      validateReassignment(teamMember1Id, { id: managerId, role: 'manager' }),
    ).resolves.toBeUndefined();
  });

  it('does not throw when manager reassigns to a member of a child team', async () => {
    await expect(
      validateReassignment(teamMember2Id, { id: managerId, role: 'manager' }),
    ).resolves.toBeUndefined();
  });

  it('throws REASSIGNMENT_NOT_PERMITTED when manager reassigns to someone outside their team', async () => {
    await expect(
      validateReassignment(outsiderId, { id: managerId, role: 'manager' }),
    ).rejects.toMatchObject({ code: 'REASSIGNMENT_NOT_PERMITTED' });
  });

  it('throws REASSIGNMENT_NOT_PERMITTED when manager has no teams', async () => {
    const loneManager = await createUser(makeUser('lone-manager-ra', 'manager'));
    await expect(
      validateReassignment(teamMember1Id, { id: loneManager.id, role: 'manager' }),
    ).rejects.toMatchObject({ code: 'REASSIGNMENT_NOT_PERMITTED' });

    await pool.query('DELETE FROM users WHERE id = $1', [loneManager.id]);
  });
});
