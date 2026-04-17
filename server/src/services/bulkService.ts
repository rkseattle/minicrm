/**
 * Bulk service — atomic multi-record operations for contacts, accounts, and deals.
 * All mutations run in a single transaction; partial failures roll back entirely.
 * (MINCRM-188)
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import { writeAuditEntry } from './auditService.js';
import { queueAssignmentNotification } from './notificationService.js';
import { findUserById } from './userService.js';
import { fireAutomationTrigger } from './automationService.js';
import { getStageNames } from './pipelineStageService.js';
import type { AuditActor } from './contactService.js';

/** Valid bulk actions for contacts and accounts */
const CONTACT_ACCOUNT_ACTIONS: ReadonlySet<string> = new Set(['reassign', 'delete']);
/** Valid bulk actions for deals */
const DEAL_ACTIONS: ReadonlySet<string> = new Set(['reassign', 'delete', 'change_stage']);

export type ContactAccountBulkAction = 'reassign' | 'delete';
export type DealBulkAction = 'reassign' | 'delete' | 'change_stage';

/** Input for a bulk operation on contacts */
export interface BulkContactsInput {
  action: ContactAccountBulkAction;
  ids: string[];
  owner_id?: string;
}

/** Input for a bulk operation on accounts */
export interface BulkAccountsInput {
  action: ContactAccountBulkAction;
  ids: string[];
  owner_id?: string;
}

/** Input for a bulk operation on deals */
export interface BulkDealsInput {
  action: DealBulkAction;
  ids: string[];
  owner_id?: string;
  stage?: string;
}

/** Result returned by all bulk operations */
export interface BulkResult {
  affected: number;
}

/** Minimum row shape needed for ownership checks */
interface OwnedRow {
  id: string;
  owner_id: string;
}

/**
 * Checks that the given IDs all belong to the actor (or actor is admin).
 * Returns 'forbidden' if any record is unowned, or the verified IDs on success.
 *
 * Uses a single query with ANY($1) for efficiency; handles up to max-param limits
 * that are unlikely to be hit in practice.
 */
async function verifyOwnership(
  client: PoolClient,
  table: string,
  ids: string[],
  actor: AuditActor & { role: string },
): Promise<{ forbidden: true } | { forbidden: false; rows: OwnedRow[] }> {
  if (actor.role === 'admin') {
    const result = await client.query<OwnedRow>(
      `SELECT id, owner_id FROM ${table} WHERE id = ANY($1)`,
      [ids],
    );
    return { forbidden: false, rows: result.rows };
  }

  const result = await client.query<OwnedRow>(
    `SELECT id, owner_id FROM ${table} WHERE id = ANY($1)`,
    [ids],
  );

  const unowned = result.rows.find((r) => r.owner_id !== actor.id);
  if (unowned) return { forbidden: true };

  return { forbidden: false, rows: result.rows };
}

/**
 * Bulk operation on contacts: reassign owner or delete.
 *
 * Ownership rule: reps may only act on records they own. Any unowned ID → 403.
 * All mutations run in a single transaction.
 *
 * @param input - Validated bulk input
 * @param actor - User performing the action (includes role for ownership check)
 */
export async function bulkContacts(
  input: BulkContactsInput,
  actor: AuditActor & { role: string },
): Promise<BulkResult | { forbidden: true }> {
  const { action, ids, owner_id } = input;

  if (!CONTACT_ACCOUNT_ACTIONS.has(action)) {
    throw Object.assign(new Error(`Invalid action: ${action}`), { code: 'VALIDATION_ERROR' });
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const ownership = await verifyOwnership(client, 'contacts', ids, actor);
    if (ownership.forbidden) {
      await client.query('ROLLBACK');
      return { forbidden: true };
    }

    const rows = ownership.rows;
    if (rows.length === 0) {
      await client.query('COMMIT');
      return { affected: 0 };
    }

    const actualIds = rows.map((r) => r.id);

    if (action === 'delete') {
      const nameResult = await client.query<{ id: string; first_name: string; last_name: string }>(
        'SELECT id, first_name, last_name FROM contacts WHERE id = ANY($1)',
        [actualIds],
      );
      const nameMap = new Map(nameResult.rows.map((r) => [r.id, `${r.first_name} ${r.last_name}`]));

      await client.query('DELETE FROM contacts WHERE id = ANY($1)', [actualIds]);

      for (const id of actualIds) {
        await writeAuditEntry(client, {
          recordType: 'contact',
          recordId: id,
          recordName: nameMap.get(id) ?? '',
          eventType: 'deleted',
          changedById: actor.id,
          changedByName: actor.name,
        });
      }
    } else {
      // reassign
      const nameResult = await client.query<{
        id: string;
        first_name: string;
        last_name: string;
        owner_id: string;
      }>('SELECT id, first_name, last_name, owner_id FROM contacts WHERE id = ANY($1)', [
        actualIds,
      ]);

      await client.query(
        'UPDATE contacts SET owner_id = $1, updated_at = now() WHERE id = ANY($2)',
        [owner_id, actualIds],
      );

      for (const row of nameResult.rows) {
        await writeAuditEntry(client, {
          recordType: 'contact',
          recordId: row.id,
          recordName: `${row.first_name} ${row.last_name}`,
          eventType: 'ownership_reassigned',
          oldValue: row.owner_id,
          newValue: owner_id,
          changedById: actor.id,
          changedByName: actor.name,
        });
      }
    }

    await client.query('COMMIT');

    // Fire-and-forget notifications after commit
    if (action === 'reassign' && owner_id) {
      const newOwner = await findUserById(owner_id);
      if (newOwner) {
        for (const id of actualIds) {
          queueAssignmentNotification(newOwner.id, newOwner.email, newOwner.name, {
            recordType: 'contact',
            recordName: '',
            recordPath: `/contacts/${id}`,
            assignedByName: actor.name,
          });
        }
      }
    }

    return { affected: actualIds.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Bulk operation on accounts: reassign owner or delete.
 *
 * @param input - Validated bulk input
 * @param actor - User performing the action (includes role for ownership check)
 */
export async function bulkAccounts(
  input: BulkAccountsInput,
  actor: AuditActor & { role: string },
): Promise<BulkResult | { forbidden: true }> {
  const { action, ids, owner_id } = input;

  if (!CONTACT_ACCOUNT_ACTIONS.has(action)) {
    throw Object.assign(new Error(`Invalid action: ${action}`), { code: 'VALIDATION_ERROR' });
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const ownership = await verifyOwnership(client, 'accounts', ids, actor);
    if (ownership.forbidden) {
      await client.query('ROLLBACK');
      return { forbidden: true };
    }

    const rows = ownership.rows;
    if (rows.length === 0) {
      await client.query('COMMIT');
      return { affected: 0 };
    }

    const actualIds = rows.map((r) => r.id);

    if (action === 'delete') {
      const nameResult = await client.query<{ id: string; name: string }>(
        'SELECT id, name FROM accounts WHERE id = ANY($1)',
        [actualIds],
      );
      const nameMap = new Map(nameResult.rows.map((r) => [r.id, r.name]));

      await client.query('DELETE FROM accounts WHERE id = ANY($1)', [actualIds]);

      for (const id of actualIds) {
        await writeAuditEntry(client, {
          recordType: 'account',
          recordId: id,
          recordName: nameMap.get(id) ?? '',
          eventType: 'deleted',
          changedById: actor.id,
          changedByName: actor.name,
        });
      }
    } else {
      // reassign
      const nameResult = await client.query<{ id: string; name: string; owner_id: string }>(
        'SELECT id, name, owner_id FROM accounts WHERE id = ANY($1)',
        [actualIds],
      );

      await client.query(
        'UPDATE accounts SET owner_id = $1, updated_at = now() WHERE id = ANY($2)',
        [owner_id, actualIds],
      );

      for (const row of nameResult.rows) {
        await writeAuditEntry(client, {
          recordType: 'account',
          recordId: row.id,
          recordName: row.name,
          eventType: 'ownership_reassigned',
          oldValue: row.owner_id,
          newValue: owner_id,
          changedById: actor.id,
          changedByName: actor.name,
        });
      }
    }

    await client.query('COMMIT');

    if (action === 'reassign' && owner_id) {
      const newOwner = await findUserById(owner_id);
      if (newOwner) {
        for (const id of actualIds) {
          queueAssignmentNotification(newOwner.id, newOwner.email, newOwner.name, {
            recordType: 'account',
            recordName: '',
            recordPath: `/accounts/${id}`,
            assignedByName: actor.name,
          });
        }
      }
    }

    return { affected: actualIds.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Bulk operation on deals: reassign owner, delete, or change stage.
 *
 * Stage is validated against the live pipeline_stages table before the transaction.
 *
 * @param input - Validated bulk input
 * @param actor - User performing the action (includes role for ownership check)
 */
export async function bulkDeals(
  input: BulkDealsInput,
  actor: AuditActor & { role: string },
): Promise<BulkResult | { forbidden: true } | { invalidStage: true }> {
  const { action, ids, owner_id, stage } = input;

  if (!DEAL_ACTIONS.has(action)) {
    throw Object.assign(new Error(`Invalid action: ${action}`), { code: 'VALIDATION_ERROR' });
  }

  // Validate stage against live table before opening transaction
  if (action === 'change_stage') {
    const validStages = await getStageNames();
    if (!stage || !validStages.includes(stage)) {
      return { invalidStage: true };
    }
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const ownership = await verifyOwnership(client, 'deals', ids, actor);
    if (ownership.forbidden) {
      await client.query('ROLLBACK');
      return { forbidden: true };
    }

    const rows = ownership.rows;
    if (rows.length === 0) {
      await client.query('COMMIT');
      return { affected: 0 };
    }

    const actualIds = rows.map((r) => r.id);

    if (action === 'delete') {
      const nameResult = await client.query<{ id: string; name: string }>(
        'SELECT id, name FROM deals WHERE id = ANY($1)',
        [actualIds],
      );
      const nameMap = new Map(nameResult.rows.map((r) => [r.id, r.name]));

      await client.query('DELETE FROM deals WHERE id = ANY($1)', [actualIds]);

      for (const id of actualIds) {
        await writeAuditEntry(client, {
          recordType: 'deal',
          recordId: id,
          recordName: nameMap.get(id) ?? '',
          eventType: 'deleted',
          changedById: actor.id,
          changedByName: actor.name,
        });
      }
    } else if (action === 'reassign') {
      const nameResult = await client.query<{ id: string; name: string; owner_id: string }>(
        'SELECT id, name, owner_id FROM deals WHERE id = ANY($1)',
        [actualIds],
      );

      await client.query('UPDATE deals SET owner_id = $1, updated_at = now() WHERE id = ANY($2)', [
        owner_id,
        actualIds,
      ]);

      for (const row of nameResult.rows) {
        await writeAuditEntry(client, {
          recordType: 'deal',
          recordId: row.id,
          recordName: row.name,
          eventType: 'ownership_reassigned',
          oldValue: row.owner_id,
          newValue: owner_id,
          changedById: actor.id,
          changedByName: actor.name,
        });
      }
    } else {
      // change_stage
      const beforeResult = await client.query<{
        id: string;
        name: string;
        stage: string;
        owner_id: string;
      }>('SELECT id, name, stage, owner_id FROM deals WHERE id = ANY($1)', [actualIds]);

      await client.query('UPDATE deals SET stage = $1, updated_at = now() WHERE id = ANY($2)', [
        stage,
        actualIds,
      ]);

      for (const row of beforeResult.rows) {
        await writeAuditEntry(client, {
          recordType: 'deal',
          recordId: row.id,
          recordName: row.name,
          eventType: 'updated',
          fieldName: 'Stage',
          oldValue: row.stage,
          newValue: stage,
          changedById: actor.id,
          changedByName: actor.name,
        });
      }
    }

    await client.query('COMMIT');

    // Fire-and-forget side effects after commit
    if (action === 'reassign' && owner_id) {
      const newOwner = await findUserById(owner_id);
      if (newOwner) {
        for (const id of actualIds) {
          queueAssignmentNotification(newOwner.id, newOwner.email, newOwner.name, {
            recordType: 'deal',
            recordName: '',
            recordPath: `/deals/${id}`,
            assignedByName: actor.name,
          });
        }
      }
    }

    if (action === 'change_stage') {
      const afterResult = await pool.query<{ id: string; owner_id: string }>(
        'SELECT id, owner_id FROM deals WHERE id = ANY($1)',
        [actualIds],
      );
      for (const row of afterResult.rows) {
        void fireAutomationTrigger('deal_stage_changed', {
          recordId: row.id,
          recordType: 'deal',
          ownerId: row.owner_id,
          newStage: stage!,
        });
      }
    }

    return { affected: actualIds.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
