/**
 * Sequence service — business logic for sales sequences and enrollments (MINCRM-403).
 * All database access for sales_sequences, sales_sequence_steps, sequence_enrollments,
 * and sequence_enrollment_logs goes through this module.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import logger from '../logger.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import type {
  CreateSequenceInput,
  UpdateSequenceInput,
  CreateSequenceStepInput,
  UpdateSequenceStepInput,
} from '@minicrm/shared/schemas/sequenceSchema.js';
import {
  sendEmailStepConfigSchema,
  logCallReminderStepConfigSchema,
  createTaskStepConfigSchema,
} from '@minicrm/shared/schemas/sequenceSchema.js';
import { writeAuditEntry, SYSTEM_ACTOR } from './auditService.js';
import type { AuditActor } from './auditService.js';

// ── Row types ──────────────────────────────────────────────────────────────────

export interface SequenceRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  created_by: string | null;
  /** Computed at query time from a subquery */
  step_count: number;
  /** Computed at query time from a subquery */
  active_enrollment_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface SequenceStepRow {
  id: string;
  sequence_id: string;
  sort_order: number;
  action_type: string;
  action_config: Record<string, unknown>;
  delay_days: number;
  created_at: Date;
  updated_at: Date;
}

export interface EnrollmentRow {
  id: string;
  sequence_id: string;
  sequence_name: string;
  contact_id: string;
  enrolled_by_id: string | null;
  enrolled_at: Date;
  status: 'active' | 'completed' | 'unenrolled';
  current_step_id: string | null;
  current_step_sort_order: number | null;
  next_action_at: Date | null;
  unenrolled_at: Date | null;
}

export interface EnrollmentLogRow {
  id: string;
  enrollment_id: string;
  step_id: string | null;
  executed_at: Date;
  action_type: string;
  outcome: 'success' | 'skipped' | 'error';
  error_message: string | null;
}

// ── Allowed update field sets (SQL injection guards) ───────────────────────────

const ALLOWED_SEQUENCE_UPDATE_FIELDS: ReadonlySet<keyof UpdateSequenceInput> = new Set([
  'name',
  'description',
  'enabled',
]);

const ALLOWED_STEP_UPDATE_FIELDS: ReadonlySet<keyof UpdateSequenceStepInput> = new Set([
  'sort_order',
  'action_type',
  'action_config',
  'delay_days',
]);

// ── SELECT helpers ─────────────────────────────────────────────────────────────

const SEQUENCE_SELECT = `
  s.id, s.name, s.description, s.enabled, s.created_by, s.created_at, s.updated_at,
  (SELECT COUNT(*)::int FROM sales_sequence_steps WHERE sequence_id = s.id) AS step_count,
  (SELECT COUNT(*)::int FROM sequence_enrollments WHERE sequence_id = s.id AND status = 'active') AS active_enrollment_count
`;

const ENROLLMENT_SELECT = `
  e.id, e.sequence_id, seq.name AS sequence_name, e.contact_id,
  e.enrolled_by_id, e.enrolled_at, e.status, e.current_step_id,
  step.sort_order AS current_step_sort_order,
  e.next_action_at, e.unenrolled_at
`;

// ── Validate action_config shape ───────────────────────────────────────────────

/**
 * Validates the action_config for a given action_type.
 * Returns an error message string on failure, or null when valid.
 */
export function validateStepActionConfig(
  actionType: string,
  actionConfig: Record<string, unknown>,
): string | null {
  if (actionType === 'send_email') {
    const parsed = sendEmailStepConfigSchema.safeParse(actionConfig);
    if (!parsed.success) return `action_config: ${parsed.error.errors[0].message}`;
  } else if (actionType === 'log_call_reminder') {
    const parsed = logCallReminderStepConfigSchema.safeParse(actionConfig);
    if (!parsed.success) return `action_config: ${parsed.error.errors[0].message}`;
  } else if (actionType === 'create_task') {
    const parsed = createTaskStepConfigSchema.safeParse(actionConfig);
    if (!parsed.success) return `action_config: ${parsed.error.errors[0].message}`;
  }
  return null;
}

// ── Sequence CRUD ──────────────────────────────────────────────────────────────

/**
 * Creates a new sales sequence.
 */
export async function createSequence(
  params: CreateSequenceInput & { created_by: string },
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<SequenceRow> {
  const { name, description, enabled, created_by } = params;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO sales_sequences (name, description, enabled, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [name, description ?? null, enabled, created_by],
    );
    const id = insertResult.rows[0].id;

    await writeAuditEntry(client, {
      recordType: 'sequence',
      recordId: id,
      recordName: name,
      eventType: 'created',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    return (await findSequenceById(id))!;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Finds a single sequence by UUID, including computed step_count and active_enrollment_count.
 */
export async function findSequenceById(id: string): Promise<SequenceRow | null> {
  const result = await pool.query<SequenceRow>(
    `SELECT ${SEQUENCE_SELECT}
     FROM sales_sequences s
     WHERE s.id = $1
     LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Returns a paginated list of sequences ordered by name ascending.
 */
export async function listSequences(page = 1, limit = 25): Promise<PaginatedResponse<SequenceRow>> {
  const offset = (page - 1) * limit;

  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM sales_sequences'),
    pool.query<SequenceRow>(
      `SELECT ${SEQUENCE_SELECT}
       FROM sales_sequences s
       ORDER BY s.name ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
  ]);

  return {
    data: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  };
}

/**
 * Updates one or more fields on an existing sequence.
 */
export async function updateSequence(
  id: string,
  params: UpdateSequenceInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<SequenceRow | null> {
  const fields = (Object.keys(params) as (keyof UpdateSequenceInput)[]).filter((f) =>
    ALLOWED_SEQUENCE_UPDATE_FIELDS.has(f),
  );

  if (fields.length === 0) {
    return findSequenceById(id);
  }

  const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateResult = await client.query<{ id: string; name: string }>(
      `UPDATE sales_sequences
       SET ${setClauses}, updated_at = now()
       WHERE id = $1
       RETURNING id, name`,
      [id, ...fields.map((f) => params[f])],
    );

    if (updateResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const { name } = updateResult.rows[0];

    await writeAuditEntry(client, {
      recordType: 'sequence',
      recordId: id,
      recordName: name,
      eventType: 'updated',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    return findSequenceById(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deletes a sequence and all its steps (CASCADE). Returns null if not found.
 * Refuses deletion when there are active enrollments to prevent orphaned work.
 */
export async function deleteSequence(
  id: string,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<SequenceRow | null> {
  const existing = await findSequenceById(id);
  if (!existing) return null;

  if (existing.active_enrollment_count > 0) {
    const err = new Error(
      'Cannot delete a sequence with active enrollments. Unenroll all contacts first.',
    );
    Object.assign(err, { code: 'SEQUENCE_HAS_ACTIVE_ENROLLMENTS' });
    throw err;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const deleteResult = await client.query<{ id: string }>(
      `DELETE FROM sales_sequences WHERE id = $1 RETURNING id`,
      [id],
    );

    if (!deleteResult.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    await writeAuditEntry(client, {
      recordType: 'sequence',
      recordId: existing.id,
      recordName: existing.name,
      eventType: 'deleted',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    return existing;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Step CRUD ──────────────────────────────────────────────────────────────────

/**
 * Returns all steps for a sequence, ordered by sort_order ascending.
 */
export async function listSteps(sequenceId: string): Promise<SequenceStepRow[]> {
  const result = await pool.query<SequenceStepRow>(
    `SELECT id, sequence_id, sort_order, action_type, action_config, delay_days, created_at, updated_at
     FROM sales_sequence_steps
     WHERE sequence_id = $1
     ORDER BY sort_order ASC`,
    [sequenceId],
  );
  return result.rows;
}

/**
 * Finds a single step by UUID.
 */
export async function findStepById(id: string): Promise<SequenceStepRow | null> {
  const result = await pool.query<SequenceStepRow>(
    `SELECT id, sequence_id, sort_order, action_type, action_config, delay_days, created_at, updated_at
     FROM sales_sequence_steps
     WHERE id = $1
     LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Adds a new step to a sequence. Throws 409 if sort_order conflicts.
 */
export async function createStep(
  sequenceId: string,
  params: CreateSequenceStepInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<SequenceStepRow> {
  const { sort_order, action_type, action_config, delay_days } = params;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO sales_sequence_steps (sequence_id, sort_order, action_type, action_config, delay_days)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id`,
      [sequenceId, sort_order, action_type, JSON.stringify(action_config), delay_days],
    );
    const stepId = insertResult.rows[0].id;

    await writeAuditEntry(client, {
      recordType: 'sequence',
      recordId: sequenceId,
      recordName: `step ${sort_order} (${action_type})`,
      eventType: 'updated',
      fieldName: 'step_added',
      newValue: stepId,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    return (await findStepById(stepId))!;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Updates one or more fields on an existing step. Returns null if not found.
 */
export async function updateStep(
  stepId: string,
  params: UpdateSequenceStepInput,
): Promise<SequenceStepRow | null> {
  const fields = (Object.keys(params) as (keyof UpdateSequenceStepInput)[]).filter((f) =>
    ALLOWED_STEP_UPDATE_FIELDS.has(f),
  );

  if (fields.length === 0) {
    return findStepById(stepId);
  }

  const setClauses = fields
    .map((f, i) => (f === 'action_config' ? `${f} = $${i + 2}::jsonb` : `${f} = $${i + 2}`))
    .join(', ');

  const values = fields.map((f) => (f === 'action_config' ? JSON.stringify(params[f]) : params[f]));

  const updateResult = await pool.query<{ id: string }>(
    `UPDATE sales_sequence_steps
     SET ${setClauses}, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [stepId, ...values],
  );

  if (updateResult.rowCount === 0) return null;

  return findStepById(stepId);
}

/**
 * Deletes a step by UUID. Returns null if not found.
 */
export async function deleteStep(
  stepId: string,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<SequenceStepRow | null> {
  const existing = await findStepById(stepId);
  if (!existing) return null;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const deleteResult = await client.query<{ id: string }>(
      `DELETE FROM sales_sequence_steps WHERE id = $1 RETURNING id`,
      [stepId],
    );

    if (!deleteResult.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    await writeAuditEntry(client, {
      recordType: 'sequence',
      recordId: existing.sequence_id,
      recordName: `step ${existing.sort_order} (${existing.action_type})`,
      eventType: 'updated',
      fieldName: 'step_deleted',
      oldValue: stepId,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    return existing;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Enrollment CRUD ────────────────────────────────────────────────────────────

/**
 * Finds a single enrollment by UUID.
 */
export async function findEnrollmentById(id: string): Promise<EnrollmentRow | null> {
  const result = await pool.query<EnrollmentRow>(
    `SELECT ${ENROLLMENT_SELECT}
     FROM sequence_enrollments e
     JOIN sales_sequences seq ON seq.id = e.sequence_id
     LEFT JOIN sales_sequence_steps step ON step.id = e.current_step_id
     WHERE e.id = $1
     LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Returns all enrollments for a contact, newest first.
 */
export async function listEnrollmentsForContact(contactId: string): Promise<EnrollmentRow[]> {
  const result = await pool.query<EnrollmentRow>(
    `SELECT ${ENROLLMENT_SELECT}
     FROM sequence_enrollments e
     JOIN sales_sequences seq ON seq.id = e.sequence_id
     LEFT JOIN sales_sequence_steps step ON step.id = e.current_step_id
     WHERE e.contact_id = $1
     ORDER BY e.enrolled_at DESC`,
    [contactId],
  );
  return result.rows;
}

/**
 * Enrolls a contact in a sequence.
 * Finds the first step and schedules it according to delay_days.
 * Throws 409 if the contact is already actively enrolled in this sequence.
 * Throws 404-equivalent if the sequence is not found or has no steps.
 */
export async function enrollContact(
  sequenceId: string,
  contactId: string,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<EnrollmentRow> {
  const sequence = await findSequenceById(sequenceId);
  if (!sequence) {
    const err = new Error('Sequence not found');
    Object.assign(err, { code: 'SEQUENCE_NOT_FOUND' });
    throw err;
  }

  const steps = await listSteps(sequenceId);
  if (steps.length === 0) {
    const err = new Error('Cannot enroll in a sequence with no steps');
    Object.assign(err, { code: 'SEQUENCE_HAS_NO_STEPS' });
    throw err;
  }

  const firstStep = steps[0]!;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // next_action_at = now() + delay_days for first step
    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO sequence_enrollments
         (sequence_id, contact_id, enrolled_by_id, status, current_step_id, next_action_at)
       VALUES ($1, $2, $3, 'active', $4, now() + ($5 || ' days')::interval)
       RETURNING id`,
      [
        sequenceId,
        contactId,
        actor.id === SYSTEM_ACTOR.id ? null : actor.id,
        firstStep.id,
        firstStep.delay_days,
      ],
    );

    await writeAuditEntry(client, {
      recordType: 'sequence_enrollment',
      recordId: insertResult.rows[0].id,
      recordName: sequence.name,
      eventType: 'created',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    return (await findEnrollmentById(insertResult.rows[0].id))!;
  } catch (err) {
    await client.query('ROLLBACK');
    // pg unique-violation on the partial index → duplicate active enrollment
    if ((err as NodeJS.ErrnoException).code === '23505') {
      const conflict = new Error('Contact is already actively enrolled in this sequence');
      Object.assign(conflict, { code: 'ENROLLMENT_DUPLICATE' });
      throw conflict;
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Unenrolls a contact from a sequence by setting status to 'unenrolled'.
 * Returns null if the enrollment is not found.
 */
export async function unenrollContact(
  enrollmentId: string,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<EnrollmentRow | null> {
  const existing = await findEnrollmentById(enrollmentId);
  if (!existing) return null;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateResult = await client.query<{ id: string }>(
      `UPDATE sequence_enrollments
       SET status = 'unenrolled', unenrolled_at = now(), next_action_at = NULL, updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [enrollmentId],
    );

    if (updateResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    await writeAuditEntry(client, {
      recordType: 'sequence_enrollment',
      recordId: enrollmentId,
      recordName: existing.sequence_name,
      eventType: 'updated',
      fieldName: 'status',
      oldValue: existing.status,
      newValue: 'unenrolled',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    return findEnrollmentById(enrollmentId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Cron job: advance due enrollments ─────────────────────────────────────────

/**
 * Processes all active enrollments whose next_action_at is in the past.
 * For each due enrollment:
 *   1. Executes the current step's action (creates a Task or Call activity).
 *   2. Logs the result in sequence_enrollment_logs.
 *   3. Advances current_step_id to the next step (or marks the enrollment completed).
 *
 * Called every 15 minutes by node-cron in server.ts (MINCRM-403).
 * Errors in individual enrollments are caught and logged so one bad enrollment
 * never blocks the others.
 */
export async function advanceDueEnrollments(): Promise<void> {
  // Fetch all due active enrollments with their step and contact details
  const dueResult = await pool.query<{
    enrollment_id: string;
    sequence_id: string;
    sequence_name: string;
    contact_id: string;
    contact_name: string;
    contact_owner_id: string;
    step_id: string;
    step_sort_order: number;
    action_type: string;
    action_config: Record<string, unknown>;
    delay_days: number;
  }>(
    `SELECT
       e.id                                        AS enrollment_id,
       e.sequence_id,
       seq.name                                    AS sequence_name,
       e.contact_id,
       (c.first_name || ' ' || c.last_name)        AS contact_name,
       c.owner_id                                  AS contact_owner_id,
       step.id                                     AS step_id,
       step.sort_order                             AS step_sort_order,
       step.action_type,
       step.action_config,
       step.delay_days
     FROM sequence_enrollments e
     JOIN sales_sequences seq         ON seq.id  = e.sequence_id
     JOIN sales_sequence_steps step   ON step.id = e.current_step_id
     JOIN contacts c                  ON c.id    = e.contact_id
     WHERE e.status = 'active'
       AND e.next_action_at <= now()`,
  );

  if (dueResult.rows.length === 0) return;

  logger.info(`sequence cron: processing ${dueResult.rows.length} due enrollment(s)`);

  for (const row of dueResult.rows) {
    try {
      await processEnrollmentStep(row);
    } catch (err) {
      logger.error(
        { err, enrollmentId: row.enrollment_id },
        'sequence cron: failed to advance enrollment',
      );
    }
  }
}

/**
 * Executes one enrollment's current step, logs the result, then advances to the
 * next step or marks the enrollment completed. Runs in a single transaction.
 */
async function processEnrollmentStep(row: {
  enrollment_id: string;
  sequence_id: string;
  sequence_name: string;
  contact_id: string;
  contact_name: string;
  contact_owner_id: string;
  step_id: string;
  step_sort_order: number;
  action_type: string;
  action_config: Record<string, unknown>;
  delay_days: number;
}): Promise<void> {
  // Find the next step (sort_order > current) ordered ascending
  const nextStepResult = await pool.query<{ id: string; delay_days: number }>(
    `SELECT id, delay_days
     FROM sales_sequence_steps
     WHERE sequence_id = $1 AND sort_order > $2
     ORDER BY sort_order ASC
     LIMIT 1`,
    [row.sequence_id, row.step_sort_order],
  );

  const nextStep = nextStepResult.rows[0] ?? null;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Execute the action — create a Task or Call activity on the contact
    const activitySubject = buildActivitySubject(row.action_type, row.action_config);
    const activityType = row.action_type === 'log_call_reminder' ? 'Call' : 'Task';

    await client.query(
      `INSERT INTO activities (type, subject, notes, status, contact_id, owner_id)
       VALUES ($1, $2, $3, 'open', $4, $5)`,
      [
        activityType,
        activitySubject,
        buildActivityNotes(row.action_type, row.action_config),
        row.contact_id,
        row.contact_owner_id,
      ],
    );

    // Log the execution
    await client.query(
      `INSERT INTO sequence_enrollment_logs
         (enrollment_id, step_id, action_type, outcome)
       VALUES ($1, $2, $3, 'success')`,
      [row.enrollment_id, row.step_id, row.action_type],
    );

    if (nextStep) {
      // Advance to next step
      await client.query(
        `UPDATE sequence_enrollments
         SET current_step_id = $1,
             next_action_at  = now() + ($2 || ' days')::interval,
             updated_at      = now()
         WHERE id = $3`,
        [nextStep.id, nextStep.delay_days, row.enrollment_id],
      );
    } else {
      // No more steps — mark completed
      await client.query(
        `UPDATE sequence_enrollments
         SET status         = 'completed',
             current_step_id = NULL,
             next_action_at  = NULL,
             updated_at      = now()
         WHERE id = $1`,
        [row.enrollment_id],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');

    // Record the failure in the log (best-effort — outside the rolled-back tx)
    await pool
      .query(
        `INSERT INTO sequence_enrollment_logs
           (enrollment_id, step_id, action_type, outcome, error_message)
         VALUES ($1, $2, $3, 'error', $4)`,
        [
          row.enrollment_id,
          row.step_id,
          row.action_type,
          err instanceof Error ? err.message : String(err),
        ],
      )
      .catch((logErr: unknown) => {
        logger.error({ logErr }, 'sequence cron: failed to write error log entry');
      });

    throw err;
  } finally {
    client.release();
  }
}

/** Returns the activity subject line for a given step action. */
function buildActivitySubject(actionType: string, actionConfig: Record<string, unknown>): string {
  if (actionType === 'send_email') {
    return `Send email: ${String(actionConfig['subject'] ?? 'Follow-up')}`;
  }
  if (actionType === 'log_call_reminder') {
    return String(actionConfig['subject'] ?? 'Call reminder');
  }
  // create_task
  return String(actionConfig['subject'] ?? 'Follow-up task');
}

/** Returns the activity notes for a given step action, or null. */
function buildActivityNotes(
  actionType: string,
  actionConfig: Record<string, unknown>,
): string | null {
  if (actionType === 'send_email') {
    // Include the email body as a note so reps see what to send
    return String(actionConfig['body'] ?? '');
  }
  return actionConfig['notes'] ? String(actionConfig['notes']) : null;
}
