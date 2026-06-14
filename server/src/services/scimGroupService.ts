/**
 * SCIM Group service — all DB access for SCIM 2.0 Group provisioning. (MINCRM-541)
 *
 * Handles provisioning CRM teams from SCIM Groups, syncing team memberships,
 * and managing scim_group_role_mappings so that group membership events
 * automatically assign/revoke custom roles.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import { writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';
import logger from '../logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Full teams row including the scim_group_id column added in migration 112 */
export interface ScimGroupRow {
  id: string;
  name: string;
  scim_group_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ScimGroupMember {
  value: string; // CRM user ID
  display: string; // user display name
}

export interface ScimGroup {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'];
  id: string;
  displayName: string;
  members: ScimGroupMember[];
  meta: {
    resourceType: 'Group';
    created: string;
    lastModified: string;
    location: string;
  };
}

/** Row shape returned by scim_group_role_mappings queries */
export interface ScimGroupRoleMappingRow {
  id: string;
  scim_group_id: string;
  group_name: string;
  role_id: string;
  created_at: Date;
}

// ── Serializer ─────────────────────────────────────────────────────────────────

/** Converts a DB row + member list into a SCIM Group resource object */
export function toScimGroup(
  row: ScimGroupRow,
  members: ScimGroupMember[],
  baseUrl: string,
): ScimGroup {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
    id: row.id,
    displayName: row.name,
    members,
    meta: {
      resourceType: 'Group',
      created: row.created_at.toISOString(),
      lastModified: row.updated_at.toISOString(),
      location: `${baseUrl}/scim/v2/Groups/${row.id}`,
    },
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Loads team members for one or more teams in a single JOIN query.
 * Returns a map of teamId → ScimGroupMember[].
 */
async function loadMembersForTeams(teamIds: string[]): Promise<Map<string, ScimGroupMember[]>> {
  const result = await pool.query<{ team_id: string; user_id: string; user_name: string }>(
    `SELECT tm.team_id, tm.user_id, u.name AS user_name
       FROM team_memberships tm
       JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ANY($1::uuid[])`,
    [teamIds],
  );

  const map = new Map<string, ScimGroupMember[]>();
  for (const row of result.rows) {
    const list = map.get(row.team_id) ?? [];
    list.push({ value: row.user_id, display: row.user_name });
    map.set(row.team_id, list);
  }
  return map;
}

// ── Group provisioning ─────────────────────────────────────────────────────────

/**
 * Creates a new CRM team for the given SCIM group ID, or returns the existing
 * team if one already exists for that externalGroupId (idempotent).
 */
export async function provisionScimGroup(
  externalGroupId: string,
  displayName: string,
  actor: AuditActor,
): Promise<ScimGroupRow> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotency check — if a team already exists for this SCIM group, return it
    const existing = await client.query<ScimGroupRow>(
      `SELECT id, name, scim_group_id, created_at, updated_at
         FROM teams
        WHERE scim_group_id = $1`,
      [externalGroupId],
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      // Non-null assertion safe: length > 0 guarantees rows[0] exists
      return existing.rows[0]!;
    }

    const insertResult = await client.query<ScimGroupRow>(
      `INSERT INTO teams (name, scim_group_id, manager_id, parent_team_id, created_at, updated_at)
       VALUES ($1, $2, NULL, NULL, now(), now())
       RETURNING id, name, scim_group_id, created_at, updated_at`,
      [displayName, externalGroupId],
    );

    // Non-null assertion safe: INSERT ... RETURNING always returns exactly one row
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

    logger.info({ teamId: team.id, scimGroupId: externalGroupId }, 'SCIM: provisioned new team');
    return team;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fetches a team by its SCIM external group ID plus its current member list.
 * Returns null if no team with that scim_group_id exists.
 */
export async function getScimGroup(
  scimGroupId: string,
): Promise<{ group: ScimGroupRow; members: ScimGroupMember[] } | null> {
  const groupResult = await pool.query<ScimGroupRow>(
    `SELECT id, name, scim_group_id, created_at, updated_at
       FROM teams
      WHERE scim_group_id = $1`,
    [scimGroupId],
  );

  if (groupResult.rows.length === 0) {
    return null;
  }

  // Non-null assertion safe: length > 0 guarantees rows[0] exists
  const group = groupResult.rows[0]!;
  const memberMap = await loadMembersForTeams([group.id]);
  const members = memberMap.get(group.id) ?? [];

  return { group, members };
}

/**
 * Fetches a team by its CRM team UUID plus its current member list.
 * Returns null if the team does not exist.
 */
export async function getScimGroupById(
  teamId: string,
): Promise<{ group: ScimGroupRow; members: ScimGroupMember[] } | null> {
  const groupResult = await pool.query<ScimGroupRow>(
    `SELECT id, name, scim_group_id, created_at, updated_at
       FROM teams
      WHERE id = $1`,
    [teamId],
  );

  if (groupResult.rows.length === 0) {
    return null;
  }

  // Non-null assertion safe: length > 0 guarantees rows[0] exists
  const group = groupResult.rows[0]!;
  const memberMap = await loadMembersForTeams([group.id]);
  const members = memberMap.get(group.id) ?? [];

  return { group, members };
}

/**
 * Lists all SCIM-provisioned teams (those with a non-null scim_group_id),
 * each including their current member list.
 */
export async function listScimGroups(): Promise<
  { group: ScimGroupRow; members: ScimGroupMember[] }[]
> {
  const groupResult = await pool.query<ScimGroupRow>(
    `SELECT id, name, scim_group_id, created_at, updated_at
       FROM teams
      WHERE scim_group_id IS NOT NULL
      ORDER BY name ASC`,
  );

  if (groupResult.rows.length === 0) {
    return [];
  }

  const teamIds = groupResult.rows.map((r) => r.id);
  const memberMap = await loadMembersForTeams(teamIds);

  return groupResult.rows.map((group) => ({
    group,
    members: memberMap.get(group.id) ?? [],
  }));
}

/**
 * Syncs a team's memberships to exactly match the provided memberUserIds list.
 * Users added to the team also receive the mapped custom role (if any).
 * Users removed from the team have the mapped custom role revoked (if any).
 *
 * All changes happen inside a single transaction.
 */
export async function syncScimGroupMembers(
  teamId: string,
  memberUserIds: string[],
  actor: AuditActor,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch the team's scim_group_id so we can look up the role mapping
    const teamResult = await client.query<{ scim_group_id: string | null; name: string }>(
      `SELECT scim_group_id, name FROM teams WHERE id = $1`,
      [teamId],
    );

    if (teamResult.rows.length === 0) {
      const err = new Error('Team not found') as Error & { statusCode: number; code: string };
      err.statusCode = 404;
      err.code = 'TEAM_NOT_FOUND';
      throw err;
    }

    // Non-null assertion safe: length > 0 guarantees rows[0] exists
    const team = teamResult.rows[0]!;

    // 2. Fetch current memberships
    const currentResult = await client.query<{ user_id: string }>(
      `SELECT user_id FROM team_memberships WHERE team_id = $1`,
      [teamId],
    );
    const currentMemberIds = new Set(currentResult.rows.map((r) => r.user_id));
    const incomingMemberIds = new Set(memberUserIds);

    const toAdd = memberUserIds.filter((uid) => !currentMemberIds.has(uid));
    const toRemove = [...currentMemberIds].filter((uid) => !incomingMemberIds.has(uid));

    // 3. Look up the role mapping for this SCIM group (if any)
    let mappedRoleId: string | null = null;
    if (team.scim_group_id) {
      const mappingResult = await client.query<{ role_id: string }>(
        `SELECT role_id FROM scim_group_role_mappings WHERE scim_group_id = $1`,
        [team.scim_group_id],
      );
      if (mappingResult.rows.length > 0) {
        // Non-null assertion safe: length > 0 guarantees rows[0] exists
        mappedRoleId = mappingResult.rows[0]!.role_id;
      }
    }

    // 4. Insert new memberships
    for (const userId of toAdd) {
      await client.query(
        `INSERT INTO team_memberships (team_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT (team_id, user_id) DO NOTHING`,
        [teamId, userId],
      );

      if (mappedRoleId) {
        await client.query(
          `INSERT INTO user_custom_roles (user_id, role_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [userId, mappedRoleId],
        );
      }

      await writeAuditEntry(client, {
        recordType: 'team',
        recordId: teamId,
        recordName: team.name,
        eventType: 'updated',
        fieldName: 'member_added',
        newValue: userId,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    // 5. Remove memberships
    for (const userId of toRemove) {
      await client.query(`DELETE FROM team_memberships WHERE team_id = $1 AND user_id = $2`, [
        teamId,
        userId,
      ]);

      if (mappedRoleId) {
        await client.query(`DELETE FROM user_custom_roles WHERE user_id = $1 AND role_id = $2`, [
          userId,
          mappedRoleId,
        ]);
      }

      await writeAuditEntry(client, {
        recordType: 'team',
        recordId: teamId,
        recordName: team.name,
        eventType: 'updated',
        fieldName: 'member_removed',
        oldValue: userId,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    await client.query('COMMIT');

    logger.info(
      { teamId, added: toAdd.length, removed: toRemove.length },
      'SCIM: synced group members',
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deletes a SCIM-provisioned team and all its memberships.
 * Returns true if the team was found and deleted; false if it did not exist.
 */
export async function deleteScimGroup(teamId: string, actor: AuditActor): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch team name for the audit entry before deleting
    const teamResult = await client.query<{ name: string }>(
      `SELECT name FROM teams WHERE id = $1`,
      [teamId],
    );

    if (teamResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    // Non-null assertion safe: length > 0 guarantees rows[0] exists
    const teamName = teamResult.rows[0]!.name;

    // Remove memberships first (FK constraint)
    await client.query(`DELETE FROM team_memberships WHERE team_id = $1`, [teamId]);

    // Delete the team itself
    await client.query(`DELETE FROM teams WHERE id = $1`, [teamId]);

    await writeAuditEntry(client, {
      recordType: 'team',
      recordId: teamId,
      recordName: teamName,
      eventType: 'deleted',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    logger.info({ teamId }, 'SCIM: deleted team');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Group-role mapping management ──────────────────────────────────────────────

/**
 * Upserts a mapping from a SCIM group ID to a MiniCRM custom role.
 * If a mapping already exists for scimGroupId, the role_id and group_name
 * are updated to the new values.
 */
export async function setScimGroupRoleMapping(
  scimGroupId: string,
  groupName: string,
  roleId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO scim_group_role_mappings (scim_group_id, group_name, role_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (scim_group_id)
     DO UPDATE SET role_id = EXCLUDED.role_id, group_name = EXCLUDED.group_name`,
    [scimGroupId, groupName, roleId],
  );
}

/**
 * Removes the role mapping for a SCIM group.
 * Returns true if a row was deleted; false if no mapping existed.
 */
export async function deleteScimGroupRoleMapping(scimGroupId: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM scim_group_role_mappings WHERE scim_group_id = $1`, [
    scimGroupId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Returns all group-role mappings, ordered by group name ascending.
 */
export async function listScimGroupRoleMappings(): Promise<ScimGroupRoleMappingRow[]> {
  const result = await pool.query<ScimGroupRoleMappingRow>(
    `SELECT id, scim_group_id, group_name, role_id, created_at
       FROM scim_group_role_mappings
      ORDER BY group_name ASC`,
  );
  return result.rows;
}
