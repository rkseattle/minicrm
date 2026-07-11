/**
 * Visibility service — resolves org-level data visibility policies and builds
 * the SQL WHERE clause fragments that enforce them at query time. (MINCRM-538)
 *
 * Role semantics:
 *   admin / viewer  — always see all records (org-scoped), policy is ignored
 *   service_account — blocked at the middleware layer; never reaches here
 *   manager         — always sees team-scoped records regardless of policy;
 *                     if the manager belongs to no teams, the filter resolves
 *                     to an empty IN list (no records visible outside their own)
 *   rep             — policy applied:
 *                       'org'     → no additional filter
 *                       'team'    → owner_id IN (team member ids)
 *                       'private' → owner_id = currentUserId
 *
 * The returned SQL fragment and parameter list are injected directly into the
 * caller's WHERE clause. When the filter is empty (org-wide, no restriction)
 * clause is an empty string and params is an empty array.
 */

import pool from '../db.js';
import type {
  VisibilityObjectType,
  VisibilityPolicy,
  VisibilityConfig,
  UpdateVisibilityConfigInput,
} from '@minicrm/shared/schemas/visibilitySchema.js';
import {
  VISIBILITY_OBJECT_TYPES,
  VISIBILITY_POLICIES,
} from '@minicrm/shared/schemas/visibilitySchema.js';
import { getTeamIdsForManager } from './teamService.js';
import { writeAuditEntries } from './auditService.js';
import type { AuditActor } from './auditService.js';
import logger from '../logger.js';

/** Full org visibility configuration as returned by the GET endpoint */
export type { VisibilityConfig };

/** Resolved visibility filter — inject clause into WHERE and spread params into query values */
export interface VisibilityFilter {
  /** SQL fragment to AND into the WHERE clause; empty string when no restriction applies */
  clause: string;
  /** Parameter values corresponding to placeholders in clause, starting at paramOffset */
  params: string[];
}

/** A row from org_visibility_settings */
interface VisibilitySettingRow {
  object_type: VisibilityObjectType;
  policy: VisibilityPolicy;
}

/**
 * Loads the active visibility policy for a single object type from the database.
 * Falls back to 'org' (no restriction) if the row is missing, matching the seed default.
 */
export async function getVisibilityPolicy(
  objectType: VisibilityObjectType,
): Promise<VisibilityPolicy> {
  const result = await pool.query<VisibilitySettingRow>(
    'SELECT policy FROM org_visibility_settings WHERE object_type = $1 LIMIT 1',
    [objectType],
  );
  const raw = result.rows[0]?.policy;
  if (!raw) {
    logger.warn(`org_visibility_settings row for '${objectType}' is missing — falling back to org`);
    return 'org';
  }
  if (!(VISIBILITY_POLICIES as readonly string[]).includes(raw)) {
    logger.warn(`org_visibility_settings policy '${raw}' is invalid — falling back to org`);
    return 'org';
  }
  return raw as VisibilityPolicy;
}

/**
 * Loads all three visibility policies in a single query.
 * Returns a map from object type to policy, falling back to 'org' for any missing rows.
 */
export async function getAllVisibilityPolicies(): Promise<
  Record<VisibilityObjectType, VisibilityPolicy>
> {
  const result = await pool.query<VisibilitySettingRow>(
    'SELECT object_type, policy FROM org_visibility_settings',
  );

  const defaults: Record<VisibilityObjectType, VisibilityPolicy> = {
    contact: 'org',
    deal: 'org',
    activity: 'org',
  };

  for (const row of result.rows) {
    if (
      (VISIBILITY_OBJECT_TYPES as readonly string[]).includes(row.object_type) &&
      (VISIBILITY_POLICIES as readonly string[]).includes(row.policy)
    ) {
      defaults[row.object_type] = row.policy as VisibilityPolicy;
    }
  }
  return defaults;
}

/**
 * Updates one or more per-object-type visibility policies.
 * Each updated policy is written in a single transaction and audit-logged.
 * Unchanged object types are left unmodified.
 *
 * @param updates - Partial config; only provided keys are updated
 * @param actor   - Admin user performing the change
 * @returns The full visibility config after the update
 */
export async function updateVisibilityConfig(
  updates: UpdateVisibilityConfigInput,
  actor: AuditActor,
): Promise<VisibilityConfig> {
  const entries = Object.entries(updates) as [VisibilityObjectType, VisibilityPolicy][];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch current policies before updating so oldValue is captured in audit entries
    const objectTypes = entries.map(([t]) => t);
    const existing = await client.query<{ object_type: string; policy: string }>(
      `SELECT object_type, policy FROM org_visibility_settings WHERE object_type = ANY($1)`,
      [objectTypes],
    );
    const oldPolicies = new Map(existing.rows.map((r) => [r.object_type, r.policy]));

    for (const [objectType, policy] of entries) {
      await client.query(
        `INSERT INTO org_visibility_settings (object_type, policy, updated_at, updated_by)
         VALUES ($1, $2, now(), $3)
         ON CONFLICT (object_type) DO UPDATE
           SET policy = EXCLUDED.policy,
               updated_at = EXCLUDED.updated_at,
               updated_by = EXCLUDED.updated_by`,
        [objectType, policy, actor.id],
      );
    }

    await writeAuditEntries(
      client,
      entries.map(([objectType, policy]) => ({
        recordType: 'org_visibility_settings' as const,
        recordId: null,
        recordName: objectType,
        eventType: 'updated' as const,
        fieldName: 'policy' as const,
        oldValue: oldPolicies.get(objectType) ?? null,
        newValue: policy,
        changedById: actor.id,
        changedByName: actor.name,
      })),
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getAllVisibilityPolicies();
}

/**
 * Resolves and returns the SQL visibility filter for the given requesting user
 * and object type.
 *
 * @param objectType   - The type of record being queried ('contact' | 'deal' | 'activity')
 * @param userId       - UUID of the requesting user
 * @param userRole     - Role of the requesting user
 * @param ownerColumn  - Qualified column name to filter on (e.g. 'c.owner_id', 'd.owner_id')
 * @param paramOffset  - The 1-based index of the first placeholder to use in the returned clause
 *
 * @returns VisibilityFilter with clause string and params array; clause is '' when unrestricted
 */
export async function buildVisibilityFilter(
  objectType: VisibilityObjectType,
  userId: string,
  userRole: string,
  ownerColumn: string,
  paramOffset: number,
): Promise<VisibilityFilter> {
  // admin and viewer always have org-wide read access; no filter needed
  if (userRole === 'admin' || userRole === 'viewer') {
    return { clause: '', params: [] };
  }

  // managers always use team-scoped access, regardless of the active policy
  if (userRole === 'manager') {
    return buildTeamScopedFilter(userId, ownerColumn, paramOffset);
  }

  // reps: apply the active org policy
  const policy = await getVisibilityPolicy(objectType);
  return buildPolicyFilter(policy, userId, ownerColumn, paramOffset);
}

/**
 * Builds an owner_id IN (team member ids) filter for the given manager.
 * When the manager manages no teams, falls back to owner_id = managerId (own records only),
 * rather than an empty IN list that would surface zero records.
 */
async function buildTeamScopedFilter(
  managerId: string,
  ownerColumn: string,
  paramOffset: number,
): Promise<VisibilityFilter> {
  const teamIds = await getTeamIdsForManager(managerId);
  if (teamIds.length === 0) {
    // Manager not assigned to any team — can only see their own records
    return {
      clause: `${ownerColumn} = $${paramOffset}`,
      params: [managerId],
    };
  }

  const memberIds = await resolveTeamMemberIds(teamIds);

  // Always include the manager's own records alongside their team members'.
  // A manager may own records directly (e.g. contacts they created before being
  // assigned as manager_id) and must not lose visibility over them.
  const visibleIds = [...new Set([managerId, ...memberIds])];

  const placeholders = visibleIds.map((_, i) => `$${paramOffset + i}`).join(', ');
  return {
    clause: `${ownerColumn} IN (${placeholders})`,
    params: visibleIds,
  };
}

/**
 * Builds a filter clause for a rep based on the active policy.
 */
async function buildPolicyFilter(
  policy: VisibilityPolicy,
  userId: string,
  ownerColumn: string,
  paramOffset: number,
): Promise<VisibilityFilter> {
  switch (policy) {
    case 'org':
      return { clause: '', params: [] };

    case 'private':
      return {
        clause: `${ownerColumn} = $${paramOffset}`,
        params: [userId],
      };

    case 'team': {
      // Find all teams the user belongs to (as a member or lead), then all member IDs
      const result = await pool.query<{ team_id: string }>(
        'SELECT team_id FROM team_memberships WHERE user_id = $1',
        [userId],
      );
      const teamIds = result.rows.map((r) => r.team_id);

      if (teamIds.length === 0) {
        // User belongs to no teams — fall back to private (own records only)
        return {
          clause: `${ownerColumn} = $${paramOffset}`,
          params: [userId],
        };
      }

      const memberIds = await resolveTeamMemberIds(teamIds);

      if (memberIds.length === 0) {
        return {
          clause: `${ownerColumn} = $${paramOffset}`,
          params: [userId],
        };
      }

      const placeholders = memberIds.map((_, i) => `$${paramOffset + i}`).join(', ');
      return {
        clause: `${ownerColumn} IN (${placeholders})`,
        params: memberIds,
      };
    }
  }
}

/**
 * Validates that a reassignment target (newOwnerId) is permitted for the
 * requesting user. Throws with code REASSIGNMENT_NOT_PERMITTED (403) if:
 *   - the requesting user is a manager AND the new owner is not within their team(s)
 * admin, viewer, and rep roles are not subject to this check.
 *
 * @param newOwnerId     - UUID of the user being assigned ownership
 * @param requestingUser - The user performing the reassignment
 */
export async function validateReassignment(
  newOwnerId: string,
  requestingUser: { id: string; role: string },
): Promise<void> {
  if (requestingUser.role !== 'manager') return;

  const teamIds = await getTeamIdsForManager(requestingUser.id);
  if (teamIds.length === 0) {
    // Manager belongs to no teams — can only keep the same owner, not reassign
    throw Object.assign(new Error('Managers without a team assignment cannot reassign records'), {
      code: 'REASSIGNMENT_NOT_PERMITTED',
    });
  }

  const memberIds = await resolveTeamMemberIds(teamIds);
  // Include the manager's own ID — a manager should be able to self-assign a record.
  const allowedIds = new Set([requestingUser.id, ...memberIds]);
  if (!allowedIds.has(newOwnerId)) {
    throw Object.assign(
      new Error('Managers can only reassign records to members of their own team(s)'),
      { code: 'REASSIGNMENT_NOT_PERMITTED' },
    );
  }
}

/**
 * Answers "can this user read a single already-fetched record owned by ownerId?"
 * using the exact same policy rules as buildVisibilityFilter (org policy for reps,
 * team-scoping for managers, unrestricted for admin/viewer). Intended for
 * single-record GET/action controllers that already have the record in hand and
 * only need a yes/no visibility check — not the strict owner-or-admin equality
 * check those controllers have historically used, which incorrectly rejects
 * managers and org/team-policy reps who can view the record through list
 * endpoints but not through the record's own action endpoints. (MINCRM-472
 * self-review)
 *
 * @param objectType - The type of record being checked ('contact' | 'deal' | 'activity')
 * @param ownerId    - The record's owner_id
 * @param userId     - UUID of the requesting user
 * @param userRole   - Role of the requesting user
 */
export async function canAccessOwnedRecord(
  objectType: VisibilityObjectType,
  ownerId: string,
  userId: string,
  userRole: string,
): Promise<boolean> {
  if (userRole === 'admin' || userRole === 'viewer') return true;
  if (ownerId === userId) return true;

  if (userRole === 'manager') {
    const teamIds = await getTeamIdsForManager(userId);
    if (teamIds.length === 0) return false;
    const memberIds = await resolveTeamMemberIds(teamIds);
    return memberIds.includes(ownerId);
  }

  // rep: apply the active org policy for this object type
  const policy = await getVisibilityPolicy(objectType);
  if (policy === 'org') return true;
  if (policy === 'private') return false; // ownerId === userId already returned true above

  // 'team': visible if ownerId shares a team with the requesting user
  const result = await pool.query<{ team_id: string }>(
    'SELECT team_id FROM team_memberships WHERE user_id = $1',
    [userId],
  );
  const teamIds = result.rows.map((r) => r.team_id);
  if (teamIds.length === 0) return false;
  const memberIds = await resolveTeamMemberIds(teamIds);
  return memberIds.includes(ownerId);
}

/**
 * Given a list of team IDs, returns the deduplicated list of member user UUIDs
 * across all those teams and their subtrees, using a single recursive CTE.
 */
async function resolveTeamMemberIds(teamIds: string[]): Promise<string[]> {
  // Single CTE query for all teams simultaneously to avoid N+1
  const placeholders = teamIds.map((_, i) => `$${i + 1}`).join(', ');
  const result = await pool.query<{ user_id: string }>(
    `
    WITH RECURSIVE subtree AS (
      SELECT id FROM teams WHERE id IN (${placeholders})
      UNION ALL
      SELECT t.id FROM teams t JOIN subtree s ON t.parent_team_id = s.id
    )
    SELECT DISTINCT tm.user_id
      FROM team_memberships tm
      JOIN subtree s ON tm.team_id = s.id
    `,
    teamIds,
  );
  return result.rows.map((r) => r.user_id);
}
