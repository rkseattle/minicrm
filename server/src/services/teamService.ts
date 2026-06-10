/**
 * Team service — all database operations for team and team membership management.
 * All business logic and SQL for the teams feature belongs here. (MINCRM-537)
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CreateTeamInput,
  UpdateTeamInput,
  TeamResponse,
  TeamMemberResponse,
  TeamMemberRole,
} from '@minicrm/shared/schemas/teamSchema.js';
import { writeAuditEntry, writeAuditEntries, diffFields, SYSTEM_ACTOR } from './auditService.js';
import type { AuditActor } from './auditService.js';

/** Full team row as stored in the database */
export interface TeamRow {
  id: string;
  name: string;
  manager_id: string | null;
  parent_team_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Team row joined with manager name for API responses */
interface TeamRowWithManager extends TeamRow {
  manager_name: string | null;
}

/** Membership row joined with user details for API responses */
interface MembershipRowWithUser {
  team_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role: TeamMemberRole;
}

function toTeamResponse(row: TeamRowWithManager): TeamResponse {
  return {
    id: row.id,
    name: row.name,
    manager_id: row.manager_id,
    manager_name: row.manager_name,
    parent_team_id: row.parent_team_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function toTeamMemberResponse(row: MembershipRowWithUser): TeamMemberResponse {
  return {
    team_id: row.team_id,
    user_id: row.user_id,
    user_name: row.user_name,
    user_email: row.user_email,
    role: row.role,
  };
}

/**
 * Checks whether setting parent_team_id on teamId to proposedParentId would
 * create a cycle in the team hierarchy. Returns true when a cycle would occur.
 *
 * Uses a recursive CTE to walk the ancestry chain of proposedParentId upward.
 * If teamId appears anywhere in that chain, the assignment would form a loop.
 */
async function wouldCreateCycle(
  client: PoolClient,
  teamId: string,
  proposedParentId: string,
): Promise<boolean> {
  if (teamId === proposedParentId) return true;

  const result = await client.query<{ id: string }>(
    `
    WITH RECURSIVE ancestry AS (
      SELECT id, parent_team_id
        FROM teams
       WHERE id = $1
      UNION ALL
      SELECT t.id, t.parent_team_id
        FROM teams t
        JOIN ancestry a ON t.id = a.parent_team_id
    )
    SELECT id FROM ancestry WHERE id = $2
    `,
    [proposedParentId, teamId],
  );
  return result.rows.length > 0;
}

/** Fetches a single team row with manager name join using the shared pool. Does not check existence. */
async function fetchTeamWithManager(id: string): Promise<TeamResponse> {
  const result = await pool.query<TeamRowWithManager>(
    `SELECT t.id, t.name, t.manager_id, t.parent_team_id, t.created_at, t.updated_at,
            u.name AS manager_name
       FROM teams t
       LEFT JOIN users u ON u.id = t.manager_id
      WHERE t.id = $1`,
    [id],
  );
  // Safe non-null assertion: callers only call this after confirming the row exists.
  return toTeamResponse(result.rows[0]!);
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

/**
 * Creates a new team.
 * Throws TEAM_NAME_DUPLICATE (23505) when a team with the same name exists.
 */
export async function createTeam(
  params: CreateTeamInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<TeamResponse> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertResult = await client.query<TeamRow>(
      `INSERT INTO teams (name, manager_id, parent_team_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [params.name, params.manager_id ?? null, params.parent_team_id ?? null],
    );
    const team = insertResult.rows[0]!;

    await writeAuditEntry(client, {
      recordType: 'team',
      recordId: team.id,
      recordName: team.name,
      eventType: 'created',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    return fetchTeamWithManager(team.id);
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23505') {
      throw Object.assign(new Error(`A team with the name "${params.name}" already exists`), {
        code: 'TEAM_NAME_DUPLICATE',
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns a single team by ID with manager name, or null when not found.
 */
export async function getTeamById(id: string): Promise<TeamResponse | null> {
  const result = await pool.query<TeamRowWithManager>(
    `SELECT t.id, t.name, t.manager_id, t.parent_team_id, t.created_at, t.updated_at,
            u.name AS manager_name
       FROM teams t
       LEFT JOIN users u ON u.id = t.manager_id
      WHERE t.id = $1`,
    [id],
  );
  if (!result.rows[0]) return null;
  return toTeamResponse(result.rows[0]);
}

/**
 * Returns all teams ordered by name.
 */
export async function listTeams(): Promise<TeamResponse[]> {
  const result = await pool.query<TeamRowWithManager>(
    `SELECT t.id, t.name, t.manager_id, t.parent_team_id, t.created_at, t.updated_at,
            u.name AS manager_name
       FROM teams t
       LEFT JOIN users u ON u.id = t.manager_id
      ORDER BY t.name ASC`,
  );
  return result.rows.map(toTeamResponse);
}

/**
 * Updates a team's mutable fields.
 * Rejects circular parent references with TEAM_CIRCULAR_REFERENCE.
 * Returns null when the team does not exist.
 */
export async function updateTeam(
  id: string,
  params: UpdateTeamInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<TeamResponse | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const beforeResult = await client.query<TeamRow>('SELECT * FROM teams WHERE id = $1', [id]);
    const before = beforeResult.rows[0];
    if (!before) {
      await client.query('ROLLBACK');
      return null;
    }

    if (params.parent_team_id !== undefined && params.parent_team_id !== null) {
      if (await wouldCreateCycle(client, id, params.parent_team_id)) {
        throw Object.assign(
          new Error('Setting this parent would create a circular team hierarchy'),
          { code: 'TEAM_CIRCULAR_REFERENCE' },
        );
      }
    }

    const afterResult = await client.query<TeamRow>(
      `UPDATE teams
          SET name           = COALESCE($2, name),
              manager_id     = CASE WHEN $3::boolean THEN $4::uuid ELSE manager_id END,
              parent_team_id = CASE WHEN $5::boolean THEN $6::uuid ELSE parent_team_id END
        WHERE id = $1
        RETURNING *`,
      [
        id,
        params.name ?? null,
        params.manager_id !== undefined,
        params.manager_id ?? null,
        params.parent_team_id !== undefined,
        params.parent_team_id ?? null,
      ],
    );
    const after = afterResult.rows[0]!;

    const auditBase = {
      recordType: 'team' as const,
      recordId: id,
      recordName: after.name,
      changedById: actor.id,
      changedByName: actor.name,
    };

    const entries = diffFields(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      auditBase,
    );

    if (entries.length > 0) {
      await writeAuditEntries(client, entries);
    }

    await client.query('COMMIT');
    return fetchTeamWithManager(id);
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23505') {
      throw Object.assign(new Error('A team with this name already exists'), {
        code: 'TEAM_NAME_DUPLICATE',
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deletes a team.
 * Rejects deletion when child teams reference this team as their parent (TEAM_HAS_CHILDREN).
 * Returns false when the team does not exist.
 */
export async function deleteTeam(id: string, actor: AuditActor = SYSTEM_ACTOR): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const teamResult = await client.query<{ name: string }>(
      'SELECT name FROM teams WHERE id = $1',
      [id],
    );
    if (!teamResult.rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    const teamName = teamResult.rows[0].name;

    const childResult = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM teams WHERE parent_team_id = $1',
      [id],
    );
    if (parseInt(childResult.rows[0]!.count, 10) > 0) {
      throw Object.assign(new Error('Cannot delete a team that has child teams'), {
        code: 'TEAM_HAS_CHILDREN',
      });
    }

    await client.query('DELETE FROM teams WHERE id = $1', [id]);

    await writeAuditEntry(client, {
      recordType: 'team',
      recordId: id,
      recordName: teamName,
      eventType: 'deleted',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Membership ─────────────────────────────────────────────────────────────────

/**
 * Returns the list of members for a given team, ordered by user name.
 */
export async function listTeamMembers(teamId: string): Promise<TeamMemberResponse[]> {
  const result = await pool.query<MembershipRowWithUser>(
    `SELECT tm.team_id, tm.user_id, u.name AS user_name, u.email AS user_email, tm.role
       FROM team_memberships tm
       JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = $1
      ORDER BY u.name ASC`,
    [teamId],
  );
  return result.rows.map(toTeamMemberResponse);
}

/**
 * Adds a user to a team with the given role.
 * Throws TEAM_MEMBER_ALREADY_EXISTS when the membership already exists.
 * Throws TEAM_OR_USER_NOT_FOUND when either FK reference is invalid.
 */
export async function addTeamMember(
  teamId: string,
  userId: string,
  role: TeamMemberRole,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<TeamMemberResponse> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, $3)`,
      [teamId, userId, role],
    );

    await writeAuditEntry(client, {
      recordType: 'team',
      recordId: teamId,
      eventType: 'updated',
      fieldName: 'member_added',
      newValue: userId,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    const result = await pool.query<MembershipRowWithUser>(
      `SELECT tm.team_id, tm.user_id, u.name AS user_name, u.email AS user_email, tm.role
         FROM team_memberships tm
         JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = $1 AND tm.user_id = $2`,
      [teamId, userId],
    );
    // Safe: we just inserted this row.
    return toTeamMemberResponse(result.rows[0]!);
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23505') {
      throw Object.assign(new Error('User is already a member of this team'), {
        code: 'TEAM_MEMBER_ALREADY_EXISTS',
      });
    }
    if ((err as { code?: string }).code === '23503') {
      throw Object.assign(new Error('Team or user not found'), {
        code: 'TEAM_OR_USER_NOT_FOUND',
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes a user from a team.
 * Returns false when the membership does not exist.
 */
export async function removeTeamMember(
  teamId: string,
  userId: string,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      'DELETE FROM team_memberships WHERE team_id = $1 AND user_id = $2',
      [teamId, userId],
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    await writeAuditEntry(client, {
      recordType: 'team',
      recordId: teamId,
      eventType: 'updated',
      fieldName: 'member_removed',
      oldValue: userId,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Hierarchy helper ───────────────────────────────────────────────────────────

/**
 * Returns the UUIDs of all users who are members of the given team.
 *
 * When recursive=true, walks the full team subtree rooted at teamId using a
 * single recursive CTE — no N+1 queries regardless of hierarchy depth.
 * When recursive=false, returns only direct members of the specified team.
 */
export async function getTeamMemberIds(teamId: string, recursive: boolean): Promise<string[]> {
  if (!recursive) {
    const result = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM team_memberships WHERE team_id = $1',
      [teamId],
    );
    return result.rows.map((r) => r.user_id);
  }

  // Recursive CTE: enumerate the team subtree, then collect all member user_ids
  const result = await pool.query<{ user_id: string }>(
    `
    WITH RECURSIVE subtree AS (
      SELECT id FROM teams WHERE id = $1
      UNION ALL
      SELECT t.id FROM teams t JOIN subtree s ON t.parent_team_id = s.id
    )
    SELECT DISTINCT tm.user_id
      FROM team_memberships tm
      JOIN subtree s ON tm.team_id = s.id
    `,
    [teamId],
  );
  return result.rows.map((r) => r.user_id);
}
