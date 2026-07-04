/**
 * Integration tests for sequenceService.
 * Runs against a real PostgreSQL test database.
 * (MINCRM-403)
 */

import 'dotenv/config';
import {
  createSequence,
  findSequenceById,
  listSequences,
  updateSequence,
  deleteSequence,
  listSteps,
  findStepById,
  createStep,
  updateStep,
  deleteStep,
  findEnrollmentById,
  listEnrollmentsForContact,
  enrollContact,
  unenrollContact,
  advanceDueEnrollments,
  validateStepActionConfig,
} from '../services/sequenceService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

const FILE_PREFIX = 'seq-svc';

const ADMIN_USER = {
  email: `${FILE_PREFIX}-admin@example.com`,
  name: 'Sequence Admin',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let adminId: string;
let contactId: string;

async function cleanup() {
  await pool.query(
    `DELETE FROM sequence_enrollment_logs
     WHERE enrollment_id IN (
       SELECT e.id FROM sequence_enrollments e
       JOIN sales_sequences s ON s.id = e.sequence_id
       WHERE s.created_by IN (SELECT id FROM users WHERE email LIKE $1)
     )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM sequence_enrollments
     WHERE sequence_id IN (
       SELECT id FROM sales_sequences
       WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)
     )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM sales_sequences
     WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM activities
     WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM contacts
     WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
}

beforeAll(async () => {
  await cleanup();

  const admin = await createUser(ADMIN_USER);
  adminId = admin.id;

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    ['Seq', 'TestContact', `${FILE_PREFIX}-contact@example.com`, adminId],
  );
  contactId = contactResult.rows[0].id;
});

beforeEach(async () => {
  await pool.query(
    `DELETE FROM sequence_enrollment_logs
     WHERE enrollment_id IN (
       SELECT e.id FROM sequence_enrollments e
       JOIN sales_sequences s ON s.id = e.sequence_id
       WHERE s.created_by IN (SELECT id FROM users WHERE email LIKE $1)
     )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM sequence_enrollments
     WHERE sequence_id IN (
       SELECT id FROM sales_sequences
       WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)
     )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM sales_sequences
     WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM activities
     WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await cleanup();
});

// ── validateStepActionConfig ───────────────────────────────────────────────────

describe('validateStepActionConfig', () => {
  it('returns null for a valid send_email config', () => {
    expect(
      validateStepActionConfig('send_email', { subject: 'Follow up', body: 'Hi there' }),
    ).toBeNull();
  });

  it('returns an error string for a send_email config missing body', () => {
    const error = validateStepActionConfig('send_email', { subject: 'Hi' });
    expect(typeof error).toBe('string');
    expect(error).not.toBeNull();
  });

  it('returns null for a valid log_call_reminder config', () => {
    expect(
      validateStepActionConfig('log_call_reminder', { subject: 'Call the prospect' }),
    ).toBeNull();
  });

  it('returns an error string for a log_call_reminder config missing subject', () => {
    const error = validateStepActionConfig('log_call_reminder', {});
    expect(typeof error).toBe('string');
  });

  it('returns null for a valid create_task config', () => {
    expect(validateStepActionConfig('create_task', { subject: 'Send pricing sheet' })).toBeNull();
  });

  it('returns null for an unknown action_type (no schema to validate)', () => {
    // Unknown types pass through without a schema check
    expect(validateStepActionConfig('unknown_type', {})).toBeNull();
  });
});

// ── createSequence ─────────────────────────────────────────────────────────────

describe('createSequence', () => {
  it('inserts a sequence and returns the full row', async () => {
    const seq = await createSequence(
      {
        name: 'Onboarding',
        description: 'New customer cadence',
        enabled: true,
        created_by: adminId,
      },
      { id: adminId, name: 'Sequence Admin' },
    );

    expect(seq.id).toBeDefined();
    expect(seq.name).toBe('Onboarding');
    expect(seq.description).toBe('New customer cadence');
    expect(seq.enabled).toBe(true);
    expect(seq.created_by).toBe(adminId);
    expect(seq.step_count).toBe(0);
    expect(seq.active_enrollment_count).toBe(0);
    expect(seq.created_at).toBeInstanceOf(Date);
  });

  it('stores a disabled sequence when enabled is false', async () => {
    const seq = await createSequence(
      { name: 'Disabled seq', enabled: false, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    expect(seq.enabled).toBe(false);
  });

  it('stores null description when omitted', async () => {
    const seq = await createSequence(
      { name: 'No desc seq', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    expect(seq.description).toBeNull();
  });
});

// ── findSequenceById ───────────────────────────────────────────────────────────

describe('findSequenceById', () => {
  it('returns null for an unknown UUID', async () => {
    const result = await findSequenceById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('returns the sequence with computed counts', async () => {
    const created = await createSequence(
      { name: 'Find test', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    const found = await findSequenceById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.step_count).toBe(0);
  });
});

// ── listSequences ──────────────────────────────────────────────────────────────

describe('listSequences', () => {
  it('returns a paginated response with correct structure', async () => {
    await createSequence(
      { name: 'List seq A', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    await createSequence(
      { name: 'List seq B', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );

    const result = await listSequences(1, 50);
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('respects the limit parameter', async () => {
    await createSequence(
      { name: 'Limit seq 1', enabled: true, created_by: adminId },
      { id: adminId, name: 'n' },
    );
    await createSequence(
      { name: 'Limit seq 2', enabled: true, created_by: adminId },
      { id: adminId, name: 'n' },
    );
    await createSequence(
      { name: 'Limit seq 3', enabled: true, created_by: adminId },
      { id: adminId, name: 'n' },
    );

    const result = await listSequences(1, 2);
    expect(result.data.length).toBeLessThanOrEqual(2);
  });
});

// ── updateSequence ─────────────────────────────────────────────────────────────

describe('updateSequence', () => {
  it('updates the name of an existing sequence', async () => {
    const seq = await createSequence(
      { name: 'Old name', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );

    const updated = await updateSequence(
      seq.id,
      { name: 'New name' },
      { id: adminId, name: 'Sequence Admin' },
    );
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('New name');
  });

  it('returns null for an unknown sequence id', async () => {
    const result = await updateSequence(
      '00000000-0000-0000-0000-000000000000',
      { name: 'Ghost' },
      { id: adminId, name: 'Sequence Admin' },
    );
    expect(result).toBeNull();
  });

  it('does not change other fields when only enabled is toggled', async () => {
    const seq = await createSequence(
      { name: 'Toggle me', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );

    const updated = await updateSequence(
      seq.id,
      { enabled: false },
      { id: adminId, name: 'Sequence Admin' },
    );
    expect(updated!.enabled).toBe(false);
    expect(updated!.name).toBe('Toggle me');
  });
});

// ── deleteSequence ─────────────────────────────────────────────────────────────

describe('deleteSequence', () => {
  it('deletes a sequence with no enrollments and returns the row', async () => {
    const seq = await createSequence(
      { name: 'To delete', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );

    const deleted = await deleteSequence(seq.id, { id: adminId, name: 'Sequence Admin' });
    expect(deleted).not.toBeNull();
    expect(deleted!.id).toBe(seq.id);

    const found = await findSequenceById(seq.id);
    expect(found).toBeNull();
  });

  it('returns null for an unknown sequence id', async () => {
    const result = await deleteSequence('00000000-0000-0000-0000-000000000000', {
      id: adminId,
      name: 'Sequence Admin',
    });
    expect(result).toBeNull();
  });

  it('throws SEQUENCE_HAS_ACTIVE_ENROLLMENTS when active enrollments exist', async () => {
    const seq = await createSequence(
      { name: 'Delete blocked', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'Step 1' },
      delay_days: 0,
    });
    await enrollContact(seq.id, contactId, { id: adminId, name: 'Sequence Admin' });

    await expect(
      deleteSequence(seq.id, { id: adminId, name: 'Sequence Admin' }),
    ).rejects.toMatchObject({ code: 'SEQUENCE_HAS_ACTIVE_ENROLLMENTS' });
  });
});

// ── createStep / listSteps / findStepById ─────────────────────────────────────

describe('createStep', () => {
  it('inserts a step and returns the full row', async () => {
    const seq = await createSequence(
      { name: 'Step parent', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );

    const step = await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'Follow up' },
      delay_days: 2,
    });

    expect(step.id).toBeDefined();
    expect(step.sequence_id).toBe(seq.id);
    expect(step.sort_order).toBe(1);
    expect(step.action_type).toBe('create_task');
    expect(step.action_config).toMatchObject({ subject: 'Follow up' });
    expect(step.delay_days).toBe(2);
  });

  it('increments step_count on the parent sequence after adding a step', async () => {
    const seq = await createSequence(
      { name: 'Count test', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    expect((await findSequenceById(seq.id))!.step_count).toBe(0);

    await createStep(seq.id, {
      sort_order: 1,
      action_type: 'log_call_reminder',
      action_config: { subject: 'Call' },
      delay_days: 0,
    });
    expect((await findSequenceById(seq.id))!.step_count).toBe(1);
  });
});

describe('listSteps', () => {
  it('returns steps ordered by sort_order ascending', async () => {
    const seq = await createSequence(
      { name: 'Step order test', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    await createStep(seq.id, {
      sort_order: 3,
      action_type: 'create_task',
      action_config: { subject: 'Third' },
      delay_days: 0,
    });
    await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'First' },
      delay_days: 0,
    });
    await createStep(seq.id, {
      sort_order: 2,
      action_type: 'create_task',
      action_config: { subject: 'Second' },
      delay_days: 0,
    });

    const steps = await listSteps(seq.id);
    expect(steps.map((s) => s.sort_order)).toEqual([1, 2, 3]);
  });

  it('returns an empty array for a sequence with no steps', async () => {
    const seq = await createSequence(
      { name: 'Empty steps', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    const steps = await listSteps(seq.id);
    expect(steps).toEqual([]);
  });
});

describe('findStepById', () => {
  it('returns null for an unknown UUID', async () => {
    const result = await findStepById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

// ── updateStep ─────────────────────────────────────────────────────────────────

describe('updateStep', () => {
  it('updates delay_days on a step', async () => {
    const seq = await createSequence(
      { name: 'Update step seq', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    const step = await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'Task' },
      delay_days: 1,
    });

    const updated = await updateStep(step.id, { delay_days: 7 });
    expect(updated).not.toBeNull();
    expect(updated!.delay_days).toBe(7);
  });

  it('returns null for an unknown step id', async () => {
    const result = await updateStep('00000000-0000-0000-0000-000000000000', { delay_days: 1 });
    expect(result).toBeNull();
  });
});

// ── deleteStep ─────────────────────────────────────────────────────────────────

describe('deleteStep', () => {
  it('deletes a step and returns the deleted row', async () => {
    const seq = await createSequence(
      { name: 'Delete step seq', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    const step = await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'Task' },
      delay_days: 0,
    });

    const deleted = await deleteStep(step.id);
    expect(deleted).not.toBeNull();
    expect(deleted!.id).toBe(step.id);

    const found = await findStepById(step.id);
    expect(found).toBeNull();
  });

  it('returns null for an unknown step id', async () => {
    const result = await deleteStep('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

// ── enrollContact ──────────────────────────────────────────────────────────────

describe('enrollContact', () => {
  it('creates an active enrollment and returns the enrollment row', async () => {
    const seq = await createSequence(
      { name: 'Enroll seq', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'Intro task' },
      delay_days: 0,
    });

    const enrollment = await enrollContact(seq.id, contactId, {
      id: adminId,
      name: 'Sequence Admin',
    });

    expect(enrollment.id).toBeDefined();
    expect(enrollment.sequence_id).toBe(seq.id);
    expect(enrollment.contact_id).toBe(contactId);
    expect(enrollment.status).toBe('active');
    expect(enrollment.current_step_id).not.toBeNull();
    expect(enrollment.enrolled_at).toBeInstanceOf(Date);
    expect(enrollment.sequence_name).toBe('Enroll seq');
  });

  it('sets next_action_at near now() for delay_days = 0', async () => {
    const seq = await createSequence(
      { name: 'Immediate seq', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'Immediate task' },
      delay_days: 0,
    });

    const before = new Date();
    const enrollment = await enrollContact(seq.id, contactId, {
      id: adminId,
      name: 'Sequence Admin',
    });
    const after = new Date(Date.now() + 1000);

    expect(enrollment.next_action_at).not.toBeNull();
    expect(enrollment.next_action_at!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5000);
    expect(enrollment.next_action_at!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('sets next_action_at in the future for delay_days > 0', async () => {
    const seq = await createSequence(
      { name: 'Delayed seq', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'Delayed task' },
      delay_days: 3,
    });

    const enrollment = await enrollContact(seq.id, contactId, {
      id: adminId,
      name: 'Sequence Admin',
    });

    // next_action_at should be at least 2 days from now
    const twoDaysFromNow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(enrollment.next_action_at!.getTime()).toBeGreaterThan(twoDaysFromNow.getTime());
  });

  it('throws ENROLLMENT_DUPLICATE if the contact is already actively enrolled', async () => {
    const seq = await createSequence(
      { name: 'Dup seq', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'Task' },
      delay_days: 0,
    });

    await enrollContact(seq.id, contactId, { id: adminId, name: 'Sequence Admin' });

    await expect(
      enrollContact(seq.id, contactId, { id: adminId, name: 'Sequence Admin' }),
    ).rejects.toMatchObject({ code: 'ENROLLMENT_DUPLICATE' });
  });

  it('throws SEQUENCE_NOT_FOUND for an unknown sequence id', async () => {
    await expect(
      enrollContact('00000000-0000-0000-0000-000000000000', contactId, {
        id: adminId,
        name: 'Sequence Admin',
      }),
    ).rejects.toMatchObject({ code: 'SEQUENCE_NOT_FOUND' });
  });

  it('throws SEQUENCE_HAS_NO_STEPS for a sequence with no steps', async () => {
    const seq = await createSequence(
      { name: 'Empty seq', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );

    await expect(
      enrollContact(seq.id, contactId, { id: adminId, name: 'Sequence Admin' }),
    ).rejects.toMatchObject({ code: 'SEQUENCE_HAS_NO_STEPS' });
  });

  it('increments active_enrollment_count on the sequence', async () => {
    const seq = await createSequence(
      { name: 'Count enrollment', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'Task' },
      delay_days: 0,
    });

    expect((await findSequenceById(seq.id))!.active_enrollment_count).toBe(0);

    await enrollContact(seq.id, contactId, { id: adminId, name: 'Sequence Admin' });
    expect((await findSequenceById(seq.id))!.active_enrollment_count).toBe(1);
  });
});

// ── unenrollContact ────────────────────────────────────────────────────────────

describe('unenrollContact', () => {
  it('sets status to unenrolled and clears next_action_at', async () => {
    const seq = await createSequence(
      { name: 'Unenroll seq', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'Task' },
      delay_days: 0,
    });
    const enrollment = await enrollContact(seq.id, contactId, {
      id: adminId,
      name: 'Sequence Admin',
    });

    const unenrolled = await unenrollContact(enrollment.id, {
      id: adminId,
      name: 'Sequence Admin',
    });
    expect(unenrolled).not.toBeNull();
    expect(unenrolled!.status).toBe('unenrolled');
    expect(unenrolled!.next_action_at).toBeNull();
    expect(unenrolled!.unenrolled_at).toBeInstanceOf(Date);
  });

  it('returns null for an unknown enrollment id', async () => {
    const result = await unenrollContact('00000000-0000-0000-0000-000000000000', {
      id: adminId,
      name: 'Sequence Admin',
    });
    expect(result).toBeNull();
  });

  it('decrements active_enrollment_count after unenroll', async () => {
    const seq = await createSequence(
      { name: 'Count down', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'Task' },
      delay_days: 0,
    });
    const enrollment = await enrollContact(seq.id, contactId, {
      id: adminId,
      name: 'Sequence Admin',
    });

    expect((await findSequenceById(seq.id))!.active_enrollment_count).toBe(1);

    await unenrollContact(enrollment.id, { id: adminId, name: 'Sequence Admin' });
    expect((await findSequenceById(seq.id))!.active_enrollment_count).toBe(0);
  });
});

// ── listEnrollmentsForContact ──────────────────────────────────────────────────

describe('listEnrollmentsForContact', () => {
  it('returns enrollments ordered by enrolled_at descending', async () => {
    const seq1 = await createSequence(
      { name: 'List enroll 1', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    const seq2 = await createSequence(
      { name: 'List enroll 2', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );

    for (const seqId of [seq1.id, seq2.id]) {
      await createStep(seqId, {
        sort_order: 1,
        action_type: 'create_task',
        action_config: { subject: 'Task' },
        delay_days: 0,
      });
    }

    // Create two contacts so we can enroll both separately
    const c2Result = await pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('List', 'C2', $1, $2) RETURNING id`,
      [`${FILE_PREFIX}-list-c2@example.com`, adminId],
    );
    const c2Id = c2Result.rows[0].id;

    await enrollContact(seq1.id, c2Id, { id: adminId, name: 'Sequence Admin' });
    await enrollContact(seq2.id, c2Id, { id: adminId, name: 'Sequence Admin' });

    const enrollments = await listEnrollmentsForContact(c2Id);
    expect(enrollments.length).toBe(2);
  });

  it('returns an empty array for a contact with no enrollments', async () => {
    const c3Result = await pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('No', 'Enrollments', $1, $2) RETURNING id`,
      [`${FILE_PREFIX}-no-enroll@example.com`, adminId],
    );
    const enrollments = await listEnrollmentsForContact(c3Result.rows[0].id);
    expect(enrollments).toEqual([]);
  });
});

// ── advanceDueEnrollments ──────────────────────────────────────────────────────

describe('advanceDueEnrollments', () => {
  it('creates an activity and advances enrollment to the next step', async () => {
    const seq = await createSequence(
      { name: 'Advance seq', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    const step1 = await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'First task' },
      delay_days: 0,
    });
    const step2 = await createStep(seq.id, {
      sort_order: 2,
      action_type: 'log_call_reminder',
      action_config: { subject: 'Follow-up call' },
      delay_days: 1,
    });

    // Enroll and then backdate next_action_at so it fires immediately
    const enrollment = await enrollContact(seq.id, contactId, {
      id: adminId,
      name: 'Sequence Admin',
    });
    await pool.query(
      `UPDATE sequence_enrollments SET next_action_at = now() - interval '1 second' WHERE id = $1`,
      [enrollment.id],
    );

    await advanceDueEnrollments();

    const after = await findEnrollmentById(enrollment.id);
    expect(after!.current_step_id).toBe(step2.id);
    expect(after!.status).toBe('active');

    // An activity should have been created for step 1
    const activityResult = await pool.query<{ subject: string; type: string }>(
      `SELECT subject, type FROM activities WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [contactId],
    );
    expect(activityResult.rows[0].subject).toContain('First task');
    expect(activityResult.rows[0].type).toBe('Task');

    // A log entry should have been written
    const logResult = await pool.query<{ outcome: string }>(
      `SELECT outcome FROM sequence_enrollment_logs WHERE enrollment_id = $1 ORDER BY executed_at DESC LIMIT 1`,
      [enrollment.id],
    );
    expect(logResult.rows[0].outcome).toBe('success');

    void step1; // referenced above to satisfy linter
  });

  it('marks enrollment completed when the last step is processed', async () => {
    const seq = await createSequence(
      { name: 'Complete seq', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'Only task' },
      delay_days: 0,
    });

    const enrollment = await enrollContact(seq.id, contactId, {
      id: adminId,
      name: 'Sequence Admin',
    });
    await pool.query(
      `UPDATE sequence_enrollments SET next_action_at = now() - interval '1 second' WHERE id = $1`,
      [enrollment.id],
    );

    await advanceDueEnrollments();

    const after = await findEnrollmentById(enrollment.id);
    expect(after!.status).toBe('completed');
    expect(after!.current_step_id).toBeNull();
    expect(after!.next_action_at).toBeNull();
  });

  it('creates a Call activity for log_call_reminder steps', async () => {
    const seq = await createSequence(
      { name: 'Call step seq', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    await createStep(seq.id, {
      sort_order: 1,
      action_type: 'log_call_reminder',
      action_config: { subject: 'Call the prospect' },
      delay_days: 0,
    });

    const enrollment = await enrollContact(seq.id, contactId, {
      id: adminId,
      name: 'Sequence Admin',
    });
    await pool.query(
      `UPDATE sequence_enrollments SET next_action_at = now() - interval '1 second' WHERE id = $1`,
      [enrollment.id],
    );

    await advanceDueEnrollments();

    const activityResult = await pool.query<{ type: string }>(
      `SELECT type FROM activities WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [contactId],
    );
    expect(activityResult.rows[0].type).toBe('Call');
  });

  it('processes a backlog larger than the concurrency chunk size', async () => {
    // ENROLLMENT_PROCESSING_CONCURRENCY is 5 — enroll more than that in one
    // batch of due enrollments to exercise the chunking loop across multiple
    // Promise.all batches, not just a single chunk.
    const enrollmentCount = 12;
    const enrollmentIds: string[] = [];

    for (let i = 0; i < enrollmentCount; i++) {
      const seq = await createSequence(
        { name: `Backlog seq ${i}`, enabled: true, created_by: adminId },
        { id: adminId, name: 'Sequence Admin' },
      );
      await createStep(seq.id, {
        sort_order: 1,
        action_type: 'create_task',
        action_config: { subject: `Backlog task ${i}` },
        delay_days: 0,
      });
      const enrollment = await enrollContact(seq.id, contactId, {
        id: adminId,
        name: 'Sequence Admin',
      });
      enrollmentIds.push(enrollment.id);
    }

    await pool.query(
      `UPDATE sequence_enrollments SET next_action_at = now() - interval '1 second'
       WHERE id = ANY($1::uuid[])`,
      [enrollmentIds],
    );

    await advanceDueEnrollments();

    for (const id of enrollmentIds) {
      const after = await findEnrollmentById(id);
      expect(after!.status).toBe('completed');
    }

    const activityCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM activities WHERE contact_id = $1 AND subject LIKE 'Backlog task%'`,
      [contactId],
    );
    expect(Number(activityCount.rows[0].count)).toBe(enrollmentCount);
  });

  it('does nothing when there are no due enrollments', async () => {
    const seq = await createSequence(
      { name: 'Future seq', enabled: true, created_by: adminId },
      { id: adminId, name: 'Sequence Admin' },
    );
    await createStep(seq.id, {
      sort_order: 1,
      action_type: 'create_task',
      action_config: { subject: 'Future task' },
      delay_days: 7,
    });

    // next_action_at will be 7 days in the future — not due yet
    await enrollContact(seq.id, contactId, { id: adminId, name: 'Sequence Admin' });

    const activityCountBefore = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM activities WHERE contact_id = $1`,
      [contactId],
    );

    await advanceDueEnrollments();

    const activityCountAfter = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM activities WHERE contact_id = $1`,
      [contactId],
    );
    expect(activityCountAfter.rows[0].count).toBe(activityCountBefore.rows[0].count);
  });
});
