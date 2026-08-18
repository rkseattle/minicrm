/**
 * Unit tests for teamService.
 *
 * Tests run against a real PostgreSQL test database.
 * Teams and memberships are truncated before each test.
 */

import 'dotenv/config';
import {
  createTeam,
  getTeamById,
  listTeams,
  updateTeam,
  deleteTeam,
  listTeamMembers,
  addTeamMember,
  removeTeamMember,
  getTeamMemberIds,
  getCoMemberIds,
} from '../services/teamService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

const ACTOR = { id: '00000000-0000-0000-0000-000000000001', name: 'Test Actor' };

const BASE_USER = {
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
  role: 'rep' as const,
};

beforeEach(async () => {
  // Memberships reference teams and users — delete in dependency order
  await pool.query('DELETE FROM team_memberships');
  await pool.query('DELETE FROM teams');
  await pool.query("DELETE FROM users WHERE email LIKE 'team-svc-%'");
});

// ── createTeam ─────────────────────────────────────────────────────────────────

describe('createTeam', () => {
  it('inserts a team and returns the full response', async () => {
    const team = await createTeam({ name: 'Alpha Team' }, ACTOR);

    expect(team.id).toBeDefined();
    expect(team.name).toBe('Alpha Team');
    expect(team.manager_id).toBeNull();
    expect(team.parent_team_id).toBeNull();
    expect(team.created_at).toBeDefined();
  });

  it('stores manager_id and returns manager_name', async () => {
    const manager = await createUser({
      ...BASE_USER,
      email: 'team-svc-manager@example.com',
      name: 'Manager User',
    });

    const team = await createTeam({ name: 'Manager Team', manager_id: manager.id }, ACTOR);

    expect(team.manager_id).toBe(manager.id);
    expect(team.manager_name).toBe('Manager User');
  });

  it('stores parent_team_id for a child team', async () => {
    const parent = await createTeam({ name: 'Parent Team' }, ACTOR);
    const child = await createTeam({ name: 'Child Team', parent_team_id: parent.id }, ACTOR);

    expect(child.parent_team_id).toBe(parent.id);
  });

  it('throws TEAM_NAME_DUPLICATE when name is already taken', async () => {
    await createTeam({ name: 'Duplicate' }, ACTOR);

    await expect(createTeam({ name: 'Duplicate' }, ACTOR)).rejects.toMatchObject({
      code: 'TEAM_NAME_DUPLICATE',
    });
  });

  it('writes an audit entry on creation', async () => {
    const team = await createTeam({ name: 'Audited Team' }, ACTOR);

    const audit = await pool.query(
      "SELECT * FROM audit_log WHERE record_type = 'team' AND record_id = $1 AND event_type = 'created'",
      [team.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].changed_by_id).toBe(ACTOR.id);
  });
});

// ── getTeamById ────────────────────────────────────────────────────────────────

describe('getTeamById', () => {
  it('returns a team when found', async () => {
    const created = await createTeam({ name: 'Findable Team' }, ACTOR);
    const found = await getTeamById(created.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it('returns null for a non-existent ID', async () => {
    const result = await getTeamById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

// ── listTeams ──────────────────────────────────────────────────────────────────

describe('listTeams', () => {
  it('returns all teams ordered by name', async () => {
    await createTeam({ name: 'Zebra Team' }, ACTOR);
    await createTeam({ name: 'Alpha Team' }, ACTOR);

    const teams = await listTeams();

    const names = teams.map((t) => t.name);
    expect(names).toContain('Zebra Team');
    expect(names).toContain('Alpha Team');
    // Should be sorted ascending
    const alphaIdx = names.indexOf('Alpha Team');
    const zebraIdx = names.indexOf('Zebra Team');
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });

  it('returns member_count = 0 for teams with no members', async () => {
    const team = await createTeam({ name: 'Empty Team' }, ACTOR);
    const teams = await listTeams();
    const found = teams.find((t) => t.id === team.id);
    expect(found).toBeDefined();
    expect(found!.member_count).toBe(0);
  });

  it('returns correct member_count after adding members', async () => {
    const user1 = await createUser({
      ...BASE_USER,
      email: 'team-svc-mc1@example.com',
      name: 'MC User 1',
    });
    const user2 = await createUser({
      ...BASE_USER,
      email: 'team-svc-mc2@example.com',
      name: 'MC User 2',
    });
    const team = await createTeam({ name: 'Counted Team' }, ACTOR);
    await addTeamMember(team.id, user1.id, 'member', ACTOR);
    await addTeamMember(team.id, user2.id, 'lead', ACTOR);

    const teams = await listTeams();
    const found = teams.find((t) => t.id === team.id);
    expect(found).toBeDefined();
    expect(found!.member_count).toBe(2);
  });
});

// ── updateTeam ─────────────────────────────────────────────────────────────────

describe('updateTeam', () => {
  it('updates name and returns the updated team', async () => {
    const team = await createTeam({ name: 'Old Name' }, ACTOR);
    const updated = await updateTeam(team.id, { name: 'New Name' }, ACTOR);

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('New Name');
  });

  it('returns null for a non-existent team', async () => {
    const result = await updateTeam('00000000-0000-0000-0000-000000000000', { name: 'X' }, ACTOR);
    expect(result).toBeNull();
  });

  it('throws TEAM_NAME_DUPLICATE on name collision', async () => {
    await createTeam({ name: 'Existing' }, ACTOR);
    const team = await createTeam({ name: 'Rename Target' }, ACTOR);

    await expect(updateTeam(team.id, { name: 'Existing' }, ACTOR)).rejects.toMatchObject({
      code: 'TEAM_NAME_DUPLICATE',
    });
  });

  it('throws TEAM_CIRCULAR_REFERENCE when creating a cycle', async () => {
    const a = await createTeam({ name: 'Cycle A' }, ACTOR);
    const b = await createTeam({ name: 'Cycle B', parent_team_id: a.id }, ACTOR);

    // Making A a child of B would form A → B → A
    await expect(updateTeam(a.id, { parent_team_id: b.id }, ACTOR)).rejects.toMatchObject({
      code: 'TEAM_CIRCULAR_REFERENCE',
    });
  });

  it('rejects a team setting itself as its own parent', async () => {
    const team = await createTeam({ name: 'Self Parent' }, ACTOR);

    await expect(updateTeam(team.id, { parent_team_id: team.id }, ACTOR)).rejects.toMatchObject({
      code: 'TEAM_CIRCULAR_REFERENCE',
    });
  });

  it('writes audit entries for changed fields', async () => {
    const team = await createTeam({ name: 'Before Name' }, ACTOR);
    await updateTeam(team.id, { name: 'After Name' }, ACTOR);

    const audit = await pool.query(
      "SELECT * FROM audit_log WHERE record_type = 'team' AND record_id = $1 AND event_type = 'updated'",
      [team.id],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });
});

// ── deleteTeam ─────────────────────────────────────────────────────────────────

describe('deleteTeam', () => {
  it('deletes a team and returns true', async () => {
    const team = await createTeam({ name: 'To Delete' }, ACTOR);
    const result = await deleteTeam(team.id, ACTOR);

    expect(result).toBe(true);
    expect(await getTeamById(team.id)).toBeNull();
  });

  it('returns false for a non-existent team', async () => {
    const result = await deleteTeam('00000000-0000-0000-0000-000000000000', ACTOR);
    expect(result).toBe(false);
  });

  it('throws TEAM_HAS_CHILDREN when child teams exist', async () => {
    const parent = await createTeam({ name: 'Has Children' }, ACTOR);
    await createTeam({ name: 'Child Of Has Children', parent_team_id: parent.id }, ACTOR);

    await expect(deleteTeam(parent.id, ACTOR)).rejects.toMatchObject({
      code: 'TEAM_HAS_CHILDREN',
    });
  });

  it('writes an audit entry on deletion', async () => {
    const team = await createTeam({ name: 'Audit Delete' }, ACTOR);
    await deleteTeam(team.id, ACTOR);

    const audit = await pool.query(
      "SELECT * FROM audit_log WHERE record_type = 'team' AND record_id = $1 AND event_type = 'deleted'",
      [team.id],
    );
    expect(audit.rows).toHaveLength(1);
  });
});

// ── addTeamMember / removeTeamMember / listTeamMembers ─────────────────────────

describe('team membership', () => {
  it('adds a member and returns the full membership response', async () => {
    const team = await createTeam({ name: 'Membership Team' }, ACTOR);
    const user = await createUser({
      ...BASE_USER,
      email: 'team-svc-member@example.com',
      name: 'Member User',
    });

    const member = await addTeamMember(team.id, user.id, 'member', ACTOR);

    expect(member.team_id).toBe(team.id);
    expect(member.user_id).toBe(user.id);
    expect(member.user_name).toBe('Member User');
    expect(member.role).toBe('member');
  });

  it('lists members for a team', async () => {
    const team = await createTeam({ name: 'List Members Team' }, ACTOR);
    const user = await createUser({
      ...BASE_USER,
      email: 'team-svc-list-member@example.com',
      name: 'Listed Member',
    });
    await addTeamMember(team.id, user.id, 'lead', ACTOR);

    const members = await listTeamMembers(team.id);

    expect(members).toHaveLength(1);
    expect(members[0]!.user_id).toBe(user.id);
    expect(members[0]!.role).toBe('lead');
  });

  it('throws TEAM_MEMBER_ALREADY_EXISTS on duplicate membership', async () => {
    const team = await createTeam({ name: 'Dupe Member Team' }, ACTOR);
    const user = await createUser({
      ...BASE_USER,
      email: 'team-svc-dupe-member@example.com',
      name: 'Dupe Member',
    });

    await addTeamMember(team.id, user.id, 'member', ACTOR);

    await expect(addTeamMember(team.id, user.id, 'member', ACTOR)).rejects.toMatchObject({
      code: 'TEAM_MEMBER_ALREADY_EXISTS',
    });
  });

  it('removes a member and returns true', async () => {
    const team = await createTeam({ name: 'Remove Member Team' }, ACTOR);
    const user = await createUser({
      ...BASE_USER,
      email: 'team-svc-remove-member@example.com',
      name: 'Remove Member',
    });
    await addTeamMember(team.id, user.id, 'member', ACTOR);

    const result = await removeTeamMember(team.id, user.id, ACTOR);

    expect(result).toBe(true);
    expect(await listTeamMembers(team.id)).toHaveLength(0);
  });

  it('returns false when removing a non-existent membership', async () => {
    const team = await createTeam({ name: 'No Members Team' }, ACTOR);

    const result = await removeTeamMember(team.id, '00000000-0000-0000-0000-000000000000', ACTOR);
    expect(result).toBe(false);
  });

  it('a user can be a member of multiple teams', async () => {
    const teamA = await createTeam({ name: 'Multi Team A' }, ACTOR);
    const teamB = await createTeam({ name: 'Multi Team B' }, ACTOR);
    const user = await createUser({
      ...BASE_USER,
      email: 'team-svc-multi@example.com',
      name: 'Multi Member',
    });

    await addTeamMember(teamA.id, user.id, 'member', ACTOR);
    await addTeamMember(teamB.id, user.id, 'lead', ACTOR);

    const membersA = await listTeamMembers(teamA.id);
    const membersB = await listTeamMembers(teamB.id);

    expect(membersA.some((m) => m.user_id === user.id)).toBe(true);
    expect(membersB.some((m) => m.user_id === user.id)).toBe(true);
  });
});

// ── getTeamMemberIds ───────────────────────────────────────────────────────────

describe('getTeamMemberIds', () => {
  it('returns direct member IDs when recursive=false', async () => {
    const team = await createTeam({ name: 'Direct Team' }, ACTOR);
    const child = await createTeam({ name: 'Direct Child', parent_team_id: team.id }, ACTOR);
    const user1 = await createUser({
      ...BASE_USER,
      email: 'team-svc-direct1@example.com',
      name: 'Direct Member 1',
    });
    const user2 = await createUser({
      ...BASE_USER,
      email: 'team-svc-direct2@example.com',
      name: 'Direct Member 2',
    });

    await addTeamMember(team.id, user1.id, 'member', ACTOR);
    await addTeamMember(child.id, user2.id, 'member', ACTOR);

    const ids = await getTeamMemberIds(team.id, false);

    expect(ids).toContain(user1.id);
    expect(ids).not.toContain(user2.id);
  });

  it('returns all subtree member IDs when recursive=true via a single CTE', async () => {
    const root = await createTeam({ name: 'CTE Root' }, ACTOR);
    const mid = await createTeam({ name: 'CTE Mid', parent_team_id: root.id }, ACTOR);
    const leaf = await createTeam({ name: 'CTE Leaf', parent_team_id: mid.id }, ACTOR);
    const users = await Promise.all(
      ['root', 'mid', 'leaf'].map((label, i) =>
        createUser({
          ...BASE_USER,
          email: `team-svc-cte${i}@example.com`,
          name: `CTE User ${label}`,
        }),
      ),
    );

    await addTeamMember(root.id, users[0]!.id, 'member', ACTOR);
    await addTeamMember(mid.id, users[1]!.id, 'member', ACTOR);
    await addTeamMember(leaf.id, users[2]!.id, 'member', ACTOR);

    const ids = await getTeamMemberIds(root.id, true);

    expect(ids).toContain(users[0]!.id);
    expect(ids).toContain(users[1]!.id);
    expect(ids).toContain(users[2]!.id);
  });

  it('deduplicates users who appear in multiple subtree teams', async () => {
    const root = await createTeam({ name: 'Dedup Root' }, ACTOR);
    const child = await createTeam({ name: 'Dedup Child', parent_team_id: root.id }, ACTOR);
    const user = await createUser({
      ...BASE_USER,
      email: 'team-svc-dedup@example.com',
      name: 'Dedup User',
    });

    await addTeamMember(root.id, user.id, 'member', ACTOR);
    await addTeamMember(child.id, user.id, 'lead', ACTOR);

    const ids = await getTeamMemberIds(root.id, true);
    const occurrences = ids.filter((id) => id === user.id).length;

    expect(occurrences).toBe(1);
  });
});

// ── getCoMemberIds ────────────────────────────────────────────────

describe('getCoMemberIds', () => {
  it('returns [userId] when the user belongs to no teams', async () => {
    const user = await createUser({
      ...BASE_USER,
      email: 'team-svc-comember-solo@example.com',
      name: 'Solo User',
    });

    const ids = await getCoMemberIds(user.id);

    expect(ids).toHaveLength(1);
    expect(ids).toContain(user.id);
  });

  it('returns the user plus co-members when they share a team', async () => {
    const userA = await createUser({
      ...BASE_USER,
      email: 'team-svc-comember-a@example.com',
      name: 'Co-Member A',
    });
    const userB = await createUser({
      ...BASE_USER,
      email: 'team-svc-comember-b@example.com',
      name: 'Co-Member B',
    });
    const team = await createTeam({ name: 'CoMember Team' }, ACTOR);
    await addTeamMember(team.id, userA.id, 'member', ACTOR);
    await addTeamMember(team.id, userB.id, 'member', ACTOR);

    const ids = await getCoMemberIds(userA.id);

    expect(ids).toContain(userA.id);
    expect(ids).toContain(userB.id);
  });

  it('unions members across multiple teams the user belongs to', async () => {
    const userA = await createUser({
      ...BASE_USER,
      email: 'team-svc-comember-multi-a@example.com',
      name: 'Multi Team A',
    });
    const userB = await createUser({
      ...BASE_USER,
      email: 'team-svc-comember-multi-b@example.com',
      name: 'Multi Team B',
    });
    const userC = await createUser({
      ...BASE_USER,
      email: 'team-svc-comember-multi-c@example.com',
      name: 'Multi Team C',
    });
    const team1 = await createTeam({ name: 'Multi Team 1' }, ACTOR);
    const team2 = await createTeam({ name: 'Multi Team 2' }, ACTOR);
    await addTeamMember(team1.id, userA.id, 'member', ACTOR);
    await addTeamMember(team1.id, userB.id, 'member', ACTOR);
    await addTeamMember(team2.id, userA.id, 'member', ACTOR);
    await addTeamMember(team2.id, userC.id, 'member', ACTOR);

    const ids = await getCoMemberIds(userA.id);

    expect(ids).toContain(userA.id);
    expect(ids).toContain(userB.id);
    expect(ids).toContain(userC.id);
  });

  it('does not include users who share no team with the requesting user', async () => {
    const userA = await createUser({
      ...BASE_USER,
      email: 'team-svc-comember-exclude-a@example.com',
      name: 'Exclude A',
    });
    const userB = await createUser({
      ...BASE_USER,
      email: 'team-svc-comember-exclude-b@example.com',
      name: 'Exclude B',
    });
    const unrelated = await createUser({
      ...BASE_USER,
      email: 'team-svc-comember-unrelated@example.com',
      name: 'Unrelated User',
    });
    const sharedTeam = await createTeam({ name: 'Shared Team' }, ACTOR);
    const otherTeam = await createTeam({ name: 'Other Team' }, ACTOR);
    await addTeamMember(sharedTeam.id, userA.id, 'member', ACTOR);
    await addTeamMember(sharedTeam.id, userB.id, 'member', ACTOR);
    await addTeamMember(otherTeam.id, unrelated.id, 'member', ACTOR);

    const ids = await getCoMemberIds(userA.id);

    expect(ids).toContain(userA.id);
    expect(ids).toContain(userB.id);
    expect(ids).not.toContain(unrelated.id);
  });

  it('deduplicates IDs when a co-member shares multiple teams with the user', async () => {
    const userA = await createUser({
      ...BASE_USER,
      email: 'team-svc-comember-dedup-a@example.com',
      name: 'Dedup CoMember A',
    });
    const userB = await createUser({
      ...BASE_USER,
      email: 'team-svc-comember-dedup-b@example.com',
      name: 'Dedup CoMember B',
    });
    const team1 = await createTeam({ name: 'Dedup CoMember Team 1' }, ACTOR);
    const team2 = await createTeam({ name: 'Dedup CoMember Team 2' }, ACTOR);
    await addTeamMember(team1.id, userA.id, 'member', ACTOR);
    await addTeamMember(team1.id, userB.id, 'member', ACTOR);
    await addTeamMember(team2.id, userA.id, 'member', ACTOR);
    await addTeamMember(team2.id, userB.id, 'member', ACTOR);

    const ids = await getCoMemberIds(userA.id);
    const occurrences = ids.filter((id) => id === userB.id).length;

    expect(occurrences).toBe(1);
  });
});
