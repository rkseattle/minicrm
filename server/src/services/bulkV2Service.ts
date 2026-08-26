/**
 * Bulk V2 service — per-record failure isolation for bulk PATCH and DELETE operations.
 *
 * Unlike bulkService.ts (which uses all-or-nothing transactions), this service
 * uses PostgreSQL savepoints to allow partial success: one failing record does
 * not roll back mutations to other records in the same batch.
 *
 * Design:
 *   - Single BEGIN/COMMIT wrapping the whole batch
 *   - Each record attempt is wrapped in SAVEPOINT / RELEASE or ROLLBACK TO SAVEPOINT
 *   - succeeded[] and failed[] are accumulated across the loop
 *   - Post-commit side effects (notifications, automation triggers) are fire-and-forget
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import { writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';
import { queueAssignmentNotification } from './notificationService.js';
import { findUserById } from './userService.js';
import { getStageNames } from './pipelineStageService.js';
import { writeDealStageHistoryEntry } from './dealService.js';
import { softDeleteNotesByEntity } from './noteService.js';
import { deleteFindingsForDeletedEntity } from './dataHygieneService.js';
import { dispatchWebhookEvent } from './webhookService.js';
import { fireAutomationTrigger } from './automationService.js';
import logger from '../logger.js';
import type { UserRole } from '@minicrm/shared/schemas/userSchema.js';
import type { UserStatus } from '@minicrm/shared/schemas/userSchema.js';
import { recordPath } from '@minicrm/shared/types/recordPath.js';

// ── Result shape ──────────────────────────────────────────────────────────────

/** Response shape for all bulk V2 operations. */
export interface BulkV2Result {
  succeeded: string[];
  failed: Array<{ id: string; reason: string }>;
}

// ── Input shapes ──────────────────────────────────────────────────────────────

export interface BulkUserPatchInput {
  ids: string[];
  patch: { active?: boolean; role?: UserRole };
}

export interface BulkContactPatchInput {
  ids: string[];
  patch: { owner_id?: string };
}

export interface BulkDealPatchInput {
  ids: string[];
  patch: { owner_id?: string; stage?: string };
}

export interface BulkActivityPatchInput {
  ids: string[];
  patch: { owner_id?: string };
}

export interface BulkLeadPatchInput {
  ids: string[];
  patch: { owner_id?: string };
}

export interface BulkDeleteInput {
  ids: string[];
}

// ── Savepoint helper ──────────────────────────────────────────────────────────

/**
 * Sanitizes a UUID so it can be embedded in a savepoint name.
 * Replaces hyphens with underscores — savepoint names may not contain hyphens.
 */
function savepointName(id: string): string {
  // UUIDs are hex + hyphens; replace hyphens with underscores for valid SQL identifier
  return `sp_${id.replace(/-/g, '_')}`;
}

// ── Users ─────────────────────────────────────────────────────────────────────

/** Minimal user row needed for bulk patch/delete checks */
interface UserBulkRow {
  id: string;
  name: string;
  role: UserRole;
  status: UserStatus;
}

/**
 * Bulk PATCH users: set active status and/or role.
 *
 * Per-record rules:
 *   - User not found (outside visibility or missing): failed("not_found")
 *   - Service account: failed("forbidden")
 *   - Actor trying to deactivate themselves: failed("self_deactivation_not_allowed")
 *
 * @param input - Validated bulk patch input
 * @param actor - Admin performing the action
 */
export async function bulkPatchUsers(
  input: BulkUserPatchInput,
  actor: AuditActor,
): Promise<BulkV2Result> {
  const { ids, patch } = input;
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch all requested rows in one query; missing IDs will not appear in result
    const fetchResult = await client.query<UserBulkRow>(
      `SELECT id, name, role, status FROM users WHERE id = ANY($1)`,
      [ids],
    );
    const rowMap = new Map(fetchResult.rows.map((r) => [r.id, r]));

    for (const id of ids) {
      const row = rowMap.get(id);
      if (!row) {
        failed.push({ id, reason: 'not_found' });
        continue;
      }

      // Service accounts cannot be managed via bulk patch
      if (row.role === 'service_account') {
        failed.push({ id, reason: 'forbidden' });
        continue;
      }

      // Actor cannot deactivate themselves
      if (patch.active === false && id === actor.id) {
        failed.push({ id, reason: 'self_deactivation_not_allowed' });
        continue;
      }

      const sp = savepointName(id);
      try {
        await client.query(`SAVEPOINT ${sp}`);

        if (patch.active !== undefined) {
          const newStatus: UserStatus = patch.active ? 'active' : 'inactive';
          await client.query(`UPDATE users SET status = $1, updated_at = now() WHERE id = $2`, [
            newStatus,
            id,
          ]);
          const eventType = patch.active ? 'reactivated' : 'deactivated';
          await writeAuditEntry(client, {
            recordType: 'user',
            recordId: id,
            recordName: row.name,
            eventType,
            changedById: actor.id,
            changedByName: actor.name,
          });
        }

        if (patch.role !== undefined) {
          await client.query(`UPDATE users SET role = $1, updated_at = now() WHERE id = $2`, [
            patch.role,
            id,
          ]);
          await writeAuditEntry(client, {
            recordType: 'user',
            recordId: id,
            recordName: row.name,
            eventType: 'role_changed',
            fieldName: 'Role',
            oldValue: row.role,
            newValue: patch.role,
            changedById: actor.id,
            changedByName: actor.name,
          });
        }

        await client.query(`RELEASE SAVEPOINT ${sp}`);
        succeeded.push(id);
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        logger.warn({ err, id }, 'bulkPatchUsers: per-record failure');
        failed.push({ id, reason: 'internal_error' });
      }
    }

    await client.query('COMMIT');
    return { succeeded, failed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Bulk DELETE users.
 *
 * Per-record rules:
 *   - User not found: failed("not_found")
 *   - Service account: failed("forbidden")
 *   - Actor deleting themselves: failed("forbidden")
 *
 * @param input - Validated bulk delete input
 * @param actor - Admin performing the action
 */
export async function bulkDeleteUsers(
  input: BulkDeleteInput,
  actor: AuditActor,
): Promise<BulkV2Result> {
  const { ids } = input;
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const fetchResult = await client.query<UserBulkRow>(
      `SELECT id, name, role, status FROM users WHERE id = ANY($1)`,
      [ids],
    );
    const rowMap = new Map(fetchResult.rows.map((r) => [r.id, r]));

    for (const id of ids) {
      const row = rowMap.get(id);
      if (!row) {
        failed.push({ id, reason: 'not_found' });
        continue;
      }

      if (row.role === 'service_account') {
        failed.push({ id, reason: 'forbidden' });
        continue;
      }

      // Actor cannot delete themselves
      if (id === actor.id) {
        failed.push({ id, reason: 'forbidden' });
        continue;
      }

      const sp = savepointName(id);
      try {
        await client.query(`SAVEPOINT ${sp}`);

        await client.query(`DELETE FROM users WHERE id = $1`, [id]);

        await writeAuditEntry(client, {
          recordType: 'user',
          recordId: id,
          recordName: row.name,
          eventType: 'deleted',
          changedById: actor.id,
          changedByName: actor.name,
        });

        await client.query(`RELEASE SAVEPOINT ${sp}`);
        succeeded.push(id);
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        logger.warn({ err, id }, 'bulkDeleteUsers: per-record failure');
        failed.push({ id, reason: 'internal_error' });
      }
    }

    await client.query('COMMIT');
    return { succeeded, failed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Contacts ──────────────────────────────────────────────────────────────────

/** Minimal contact row for bulk operations */
interface ContactBulkRow {
  id: string;
  first_name: string;
  last_name: string;
  owner_id: string;
}

/**
 * Bulk PATCH contacts: reassign owner_id.
 *
 * Visibility: only contacts visible to the actor (via their role scope) are
 * attempted; IDs not returned by the scoped SELECT are reported as not_found.
 * Non-admin actors can only reassign contacts they own.
 *
 * @param input - Validated bulk patch input
 * @param actor - User performing the action (includes role for ownership check)
 */
export async function bulkPatchContacts(
  input: BulkContactPatchInput,
  actor: AuditActor & { role: string },
): Promise<BulkV2Result> {
  const { ids, patch } = input;
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch all rows visible to the actor (no RLS — service-layer ownership check below)
    const fetchResult = await client.query<ContactBulkRow>(
      `SELECT id, first_name, last_name, owner_id FROM contacts WHERE id = ANY($1)`,
      [ids],
    );
    const rowMap = new Map(fetchResult.rows.map((r) => [r.id, r]));

    // Accumulate new owner lookup for post-commit notifications
    const reassignedIds: string[] = [];

    for (const id of ids) {
      const row = rowMap.get(id);
      if (!row) {
        failed.push({ id, reason: 'not_found' });
        continue;
      }

      // Non-admins can only act on their own records
      if (actor.role !== 'admin' && row.owner_id !== actor.id) {
        failed.push({ id, reason: 'forbidden' });
        continue;
      }

      const sp = savepointName(id);
      try {
        await client.query(`SAVEPOINT ${sp}`);

        if (patch.owner_id !== undefined) {
          await client.query(
            `UPDATE contacts SET owner_id = $1, updated_at = now() WHERE id = $2`,
            [patch.owner_id, id],
          );
          await writeAuditEntry(client, {
            recordType: 'contact',
            recordId: id,
            recordName: `${row.first_name} ${row.last_name}`,
            eventType: 'ownership_reassigned',
            oldValue: row.owner_id,
            newValue: patch.owner_id,
            changedById: actor.id,
            changedByName: actor.name,
          });
          reassignedIds.push(id);
        }

        await client.query(`RELEASE SAVEPOINT ${sp}`);
        succeeded.push(id);
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        logger.warn({ err, id }, 'bulkPatchContacts: per-record failure');
        failed.push({ id, reason: 'internal_error' });
      }
    }

    await client.query('COMMIT');

    // Fire-and-forget assignment notifications after commit
    if (patch.owner_id && reassignedIds.length > 0) {
      const newOwner = await findUserById(patch.owner_id);
      if (newOwner) {
        for (const id of reassignedIds) {
          const row = rowMap.get(id);
          queueAssignmentNotification(newOwner.id, newOwner.email, newOwner.name, {
            recordType: 'contact',
            recordName: row ? `${row.first_name} ${row.last_name}` : '',
            recordPath: recordPath('contact', id),
            assignedByName: actor.name,
          });
        }
      }
    }

    return { succeeded, failed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Bulk DELETE contacts.
 *
 * Also soft-deletes associated notes in the same savepoint to prevent orphaned
 * active notes, mirroring the single-record deleteContact pattern.
 *
 * @param input - Validated bulk delete input
 * @param actor - User performing the action
 */
export async function bulkDeleteContacts(
  input: BulkDeleteInput,
  actor: AuditActor & { role: string },
): Promise<BulkV2Result> {
  const { ids } = input;
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const fetchResult = await client.query<ContactBulkRow>(
      `SELECT id, first_name, last_name, owner_id FROM contacts WHERE id = ANY($1)`,
      [ids],
    );
    const rowMap = new Map(fetchResult.rows.map((r) => [r.id, r]));

    for (const id of ids) {
      const row = rowMap.get(id);
      if (!row) {
        failed.push({ id, reason: 'not_found' });
        continue;
      }

      if (actor.role !== 'admin' && row.owner_id !== actor.id) {
        failed.push({ id, reason: 'forbidden' });
        continue;
      }

      const sp = savepointName(id);
      try {
        await client.query(`SAVEPOINT ${sp}`);

        await softDeleteNotesByEntity(client, 'contact', id);
        await deleteFindingsForDeletedEntity(client, 'contact', id);
        await client.query(`DELETE FROM contacts WHERE id = $1`, [id]);

        await writeAuditEntry(client, {
          recordType: 'contact',
          recordId: id,
          recordName: `${row.first_name} ${row.last_name}`,
          eventType: 'deleted',
          changedById: actor.id,
          changedByName: actor.name,
        });

        await client.query(`RELEASE SAVEPOINT ${sp}`);
        succeeded.push(id);
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        logger.warn({ err, id }, 'bulkDeleteContacts: per-record failure');
        failed.push({ id, reason: 'internal_error' });
      }
    }

    await client.query('COMMIT');
    return { succeeded, failed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Deals ─────────────────────────────────────────────────────────────────────

/** Minimal deal row for bulk operations */
interface DealBulkRow {
  id: string;
  name: string;
  stage: string;
  owner_id: string;
  pipeline_id: string;
}

/**
 * Bulk PATCH deals: reassign owner_id and/or change stage.
 *
 * Stage is validated against the live pipeline_stages table before the loop.
 *
 * @param input - Validated bulk patch input
 * @param actor - User performing the action
 */
export async function bulkPatchDeals(
  input: BulkDealPatchInput,
  actor: AuditActor & { role: string },
): Promise<BulkV2Result> {
  const { ids, patch } = input;
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  // Validate stage before opening a transaction
  if (patch.stage !== undefined) {
    const validStages = await getStageNames();
    if (!validStages.includes(patch.stage)) {
      throw Object.assign(new Error(`Invalid stage: "${patch.stage}"`), {
        code: 'VALIDATION_ERROR',
      });
    }
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const fetchResult = await client.query<DealBulkRow>(
      `SELECT id, name, stage, owner_id, pipeline_id FROM deals WHERE id = ANY($1)`,
      [ids],
    );
    const rowMap = new Map(fetchResult.rows.map((r) => [r.id, r]));

    const reassignedIds: string[] = [];

    for (const id of ids) {
      const row = rowMap.get(id);
      if (!row) {
        failed.push({ id, reason: 'not_found' });
        continue;
      }

      if (actor.role !== 'admin' && row.owner_id !== actor.id) {
        failed.push({ id, reason: 'forbidden' });
        continue;
      }

      const sp = savepointName(id);
      try {
        await client.query(`SAVEPOINT ${sp}`);

        if (patch.owner_id !== undefined) {
          await client.query(`UPDATE deals SET owner_id = $1, updated_at = now() WHERE id = $2`, [
            patch.owner_id,
            id,
          ]);
          await writeAuditEntry(client, {
            recordType: 'deal',
            recordId: id,
            recordName: row.name,
            eventType: 'ownership_reassigned',
            oldValue: row.owner_id,
            newValue: patch.owner_id,
            changedById: actor.id,
            changedByName: actor.name,
          });
          reassignedIds.push(id);
        }

        if (patch.stage !== undefined) {
          await client.query(`UPDATE deals SET stage = $1, updated_at = now() WHERE id = $2`, [
            patch.stage,
            id,
          ]);
          await writeAuditEntry(client, {
            recordType: 'deal',
            recordId: id,
            recordName: row.name,
            eventType: 'updated',
            fieldName: 'Stage',
            oldValue: row.stage,
            newValue: patch.stage,
            changedById: actor.id,
            changedByName: actor.name,
          });
          // Stage history row on a real transition only
          if (row.stage !== patch.stage) {
            await writeDealStageHistoryEntry(client, id, row.pipeline_id, patch.stage);
          }
        }

        await client.query(`RELEASE SAVEPOINT ${sp}`);
        succeeded.push(id);
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        logger.warn({ err, id }, 'bulkPatchDeals: per-record failure');
        failed.push({ id, reason: 'internal_error' });
      }
    }

    await client.query('COMMIT');

    // Fire-and-forget side effects after commit
    if (patch.owner_id && reassignedIds.length > 0) {
      const newOwner = await findUserById(patch.owner_id);
      if (newOwner) {
        for (const id of reassignedIds) {
          const row = rowMap.get(id);
          queueAssignmentNotification(newOwner.id, newOwner.email, newOwner.name, {
            recordType: 'deal',
            recordName: row?.name ?? '',
            recordPath: recordPath('deal', id),
            assignedByName: actor.name,
          });
        }
      }
    }

    if (patch.stage) {
      const stage = patch.stage;
      for (const id of succeeded) {
        const row = rowMap.get(id);
        if (!row) continue;
        void fireAutomationTrigger('deal_stage_changed', {
          recordId: id,
          recordType: 'deal',
          ownerId: patch.owner_id ?? row.owner_id,
          newStage: stage,
        });
        void dispatchWebhookEvent(
          'deal.stage_changed',
          { id, name: row.name, stage },
          { stage: row.stage },
        );
        if (stage === 'Closed Won') {
          void dispatchWebhookEvent('deal.won', { id, name: row.name, stage });
        }
        if (stage === 'Closed Lost') {
          void dispatchWebhookEvent('deal.lost', { id, name: row.name, stage });
        }
      }
    }

    return { succeeded, failed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Bulk DELETE deals.
 *
 * Also soft-deletes associated notes in the same savepoint.
 *
 * @param input - Validated bulk delete input
 * @param actor - User performing the action
 */
export async function bulkDeleteDeals(
  input: BulkDeleteInput,
  actor: AuditActor & { role: string },
): Promise<BulkV2Result> {
  const { ids } = input;
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const fetchResult = await client.query<DealBulkRow>(
      `SELECT id, name, stage, owner_id FROM deals WHERE id = ANY($1)`,
      [ids],
    );
    const rowMap = new Map(fetchResult.rows.map((r) => [r.id, r]));

    for (const id of ids) {
      const row = rowMap.get(id);
      if (!row) {
        failed.push({ id, reason: 'not_found' });
        continue;
      }

      if (actor.role !== 'admin' && row.owner_id !== actor.id) {
        failed.push({ id, reason: 'forbidden' });
        continue;
      }

      const sp = savepointName(id);
      try {
        await client.query(`SAVEPOINT ${sp}`);

        await softDeleteNotesByEntity(client, 'deal', id);
        await deleteFindingsForDeletedEntity(client, 'opportunity', id);
        await client.query(`DELETE FROM deals WHERE id = $1`, [id]);

        await writeAuditEntry(client, {
          recordType: 'deal',
          recordId: id,
          recordName: row.name,
          eventType: 'deleted',
          changedById: actor.id,
          changedByName: actor.name,
        });

        await client.query(`RELEASE SAVEPOINT ${sp}`);
        succeeded.push(id);
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        logger.warn({ err, id }, 'bulkDeleteDeals: per-record failure');
        failed.push({ id, reason: 'internal_error' });
      }
    }

    await client.query('COMMIT');
    return { succeeded, failed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Activities ────────────────────────────────────────────────────────────────

/** Minimal activity row for bulk operations */
interface ActivityBulkRow {
  id: string;
  subject: string;
  owner_id: string;
}

/**
 * Bulk PATCH activities: reassign owner_id.
 *
 * @param input - Validated bulk patch input
 * @param actor - User performing the action
 */
export async function bulkPatchActivities(
  input: BulkActivityPatchInput,
  actor: AuditActor & { role: string },
): Promise<BulkV2Result> {
  const { ids, patch } = input;
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const fetchResult = await client.query<ActivityBulkRow>(
      `SELECT id, subject, owner_id FROM activities WHERE id = ANY($1)`,
      [ids],
    );
    const rowMap = new Map(fetchResult.rows.map((r) => [r.id, r]));

    const reassignedIds: string[] = [];

    for (const id of ids) {
      const row = rowMap.get(id);
      if (!row) {
        failed.push({ id, reason: 'not_found' });
        continue;
      }

      if (actor.role !== 'admin' && row.owner_id !== actor.id) {
        failed.push({ id, reason: 'forbidden' });
        continue;
      }

      const sp = savepointName(id);
      try {
        await client.query(`SAVEPOINT ${sp}`);

        if (patch.owner_id !== undefined) {
          await client.query(
            `UPDATE activities SET owner_id = $1, updated_at = now() WHERE id = $2`,
            [patch.owner_id, id],
          );
          await writeAuditEntry(client, {
            recordType: 'activity',
            recordId: id,
            recordName: row.subject,
            eventType: 'ownership_reassigned',
            oldValue: row.owner_id,
            newValue: patch.owner_id,
            changedById: actor.id,
            changedByName: actor.name,
          });
          reassignedIds.push(id);
        }

        await client.query(`RELEASE SAVEPOINT ${sp}`);
        succeeded.push(id);
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        logger.warn({ err, id }, 'bulkPatchActivities: per-record failure');
        failed.push({ id, reason: 'internal_error' });
      }
    }

    await client.query('COMMIT');

    // Fire-and-forget assignment notifications after commit
    if (patch.owner_id && reassignedIds.length > 0) {
      const newOwner = await findUserById(patch.owner_id);
      if (newOwner) {
        for (const id of reassignedIds) {
          const row = rowMap.get(id);
          queueAssignmentNotification(newOwner.id, newOwner.email, newOwner.name, {
            recordType: 'activity',
            recordName: row?.subject ?? '',
            recordPath: recordPath('activity', id),
            assignedByName: actor.name,
          });
        }
      }
    }

    return { succeeded, failed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Bulk DELETE activities.
 *
 * @param input - Validated bulk delete input
 * @param actor - User performing the action
 */
export async function bulkDeleteActivities(
  input: BulkDeleteInput,
  actor: AuditActor & { role: string },
): Promise<BulkV2Result> {
  const { ids } = input;
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const fetchResult = await client.query<ActivityBulkRow>(
      `SELECT id, subject, owner_id FROM activities WHERE id = ANY($1)`,
      [ids],
    );
    const rowMap = new Map(fetchResult.rows.map((r) => [r.id, r]));

    for (const id of ids) {
      const row = rowMap.get(id);
      if (!row) {
        failed.push({ id, reason: 'not_found' });
        continue;
      }

      if (actor.role !== 'admin' && row.owner_id !== actor.id) {
        failed.push({ id, reason: 'forbidden' });
        continue;
      }

      const sp = savepointName(id);
      try {
        await client.query(`SAVEPOINT ${sp}`);

        await client.query(`DELETE FROM activities WHERE id = $1`, [id]);

        await writeAuditEntry(client, {
          recordType: 'activity',
          recordId: id,
          recordName: row.subject,
          eventType: 'deleted',
          changedById: actor.id,
          changedByName: actor.name,
        });

        await client.query(`RELEASE SAVEPOINT ${sp}`);
        succeeded.push(id);
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        logger.warn({ err, id }, 'bulkDeleteActivities: per-record failure');
        failed.push({ id, reason: 'internal_error' });
      }
    }

    await client.query('COMMIT');
    return { succeeded, failed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Leads ─────────────────────────────────────────────────────────────────────

/** Minimal lead row for bulk operations */
interface LeadBulkRow {
  id: string;
  first_name: string;
  last_name: string | null;
  owner_id: string;
}

/**
 * Bulk PATCH leads: reassign owner_id.
 *
 * Leads share their capability namespace with contacts (ContactsEdit / ContactsDelete).
 *
 * @param input - Validated bulk patch input
 * @param actor - User performing the action
 */
export async function bulkPatchLeads(
  input: BulkLeadPatchInput,
  actor: AuditActor & { role: string },
): Promise<BulkV2Result> {
  const { ids, patch } = input;
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const fetchResult = await client.query<LeadBulkRow>(
      `SELECT id, first_name, last_name, owner_id FROM leads WHERE id = ANY($1)`,
      [ids],
    );
    const rowMap = new Map(fetchResult.rows.map((r) => [r.id, r]));

    const reassignedIds: string[] = [];

    for (const id of ids) {
      const row = rowMap.get(id);
      if (!row) {
        failed.push({ id, reason: 'not_found' });
        continue;
      }

      if (actor.role !== 'admin' && row.owner_id !== actor.id) {
        failed.push({ id, reason: 'forbidden' });
        continue;
      }

      const sp = savepointName(id);
      try {
        await client.query(`SAVEPOINT ${sp}`);

        if (patch.owner_id !== undefined) {
          await client.query(`UPDATE leads SET owner_id = $1, updated_at = now() WHERE id = $2`, [
            patch.owner_id,
            id,
          ]);
          const recordName = row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name;
          await writeAuditEntry(client, {
            recordType: 'lead',
            recordId: id,
            recordName,
            eventType: 'ownership_reassigned',
            oldValue: row.owner_id,
            newValue: patch.owner_id,
            changedById: actor.id,
            changedByName: actor.name,
          });
          reassignedIds.push(id);
        }

        await client.query(`RELEASE SAVEPOINT ${sp}`);
        succeeded.push(id);
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        logger.warn({ err, id }, 'bulkPatchLeads: per-record failure');
        failed.push({ id, reason: 'internal_error' });
      }
    }

    await client.query('COMMIT');

    if (patch.owner_id && reassignedIds.length > 0) {
      const newOwner = await findUserById(patch.owner_id);
      if (newOwner) {
        for (const id of reassignedIds) {
          const row = rowMap.get(id);
          const recordName = row?.last_name
            ? `${row.first_name} ${row.last_name}`
            : (row?.first_name ?? '');
          queueAssignmentNotification(newOwner.id, newOwner.email, newOwner.name, {
            recordType: 'lead',
            recordName,
            recordPath: recordPath('lead', id),
            assignedByName: actor.name,
          });
        }
      }
    }

    return { succeeded, failed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Bulk DELETE leads.
 *
 * Also soft-deletes associated notes in the same savepoint, matching the
 * single-record deleteLead pattern.
 *
 * @param input - Validated bulk delete input
 * @param actor - User performing the action
 */
export async function bulkDeleteLeads(
  input: BulkDeleteInput,
  actor: AuditActor & { role: string },
): Promise<BulkV2Result> {
  const { ids } = input;
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const fetchResult = await client.query<LeadBulkRow>(
      `SELECT id, first_name, last_name, owner_id FROM leads WHERE id = ANY($1)`,
      [ids],
    );
    const rowMap = new Map(fetchResult.rows.map((r) => [r.id, r]));

    for (const id of ids) {
      const row = rowMap.get(id);
      if (!row) {
        failed.push({ id, reason: 'not_found' });
        continue;
      }

      if (actor.role !== 'admin' && row.owner_id !== actor.id) {
        failed.push({ id, reason: 'forbidden' });
        continue;
      }

      const sp = savepointName(id);
      try {
        await client.query(`SAVEPOINT ${sp}`);

        await softDeleteNotesByEntity(client, 'lead', id);
        await client.query(`DELETE FROM leads WHERE id = $1`, [id]);

        const recordName = row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name;
        await writeAuditEntry(client, {
          recordType: 'lead',
          recordId: id,
          recordName,
          eventType: 'deleted',
          changedById: actor.id,
          changedByName: actor.name,
        });

        await client.query(`RELEASE SAVEPOINT ${sp}`);
        succeeded.push(id);
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        logger.warn({ err, id }, 'bulkDeleteLeads: per-record failure');
        failed.push({ id, reason: 'internal_error' });
      }
    }

    await client.query('COMMIT');
    return { succeeded, failed };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
