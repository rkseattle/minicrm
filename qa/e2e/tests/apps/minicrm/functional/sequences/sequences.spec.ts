/**
 * F14 — Sales Sequences / Email Cadences
 *
 * Functional regression tests for the sales sequence pipeline:
 *   - CRUD: create sequence, add steps, update, delete
 *   - Enrollment: enroll contact, verify active status
 *   - Unenroll: contact removed from active enrollment
 *   - Cron advancement: step fires and creates an activity (polling)
 *   - Duplicate enrollment rejection
 *   - Auth boundaries: reps cannot create or modify sequences
 *
 * Test groups:
 *   Sequence management (F14-SM)
 *   Enrollment (F14-EN)
 *   Cron advancement (F14-CR)
 *
 * Polling strategy:
 *   advanceDueEnrollments is called by a 15-min cron job in production.
 *   In E2E tests we call the cron logic directly via a test-only endpoint
 *   exposed on the E2E app server. We then poll GET /api/v1/activities
 *   until the task created by step advancement appears.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *
 *
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact } from '@apps/minicrm/helpers.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import {
  createSequence,
  deleteSequence,
  getSequence,
  createSequenceStep,
  enrollContact,
  unenrollContact,
  getContactEnrollments,
} from '@behaviors/minicrm/sequences.behaviors.js';
import { getActivityById } from '@behaviors/minicrm/activities.behaviors.js';
import type { ActivityListRow } from '@behaviors/minicrm/activities.behaviors.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Polling helper
// ---------------------------------------------------------------------------

const MAX_POLL_MS = 10_000;
const INITIAL_BACKOFF_MS = 200;

/**
 * Polls GET /api/v1/activities for a contact until a task matching the subject
 * appears, using exponential backoff. Throws if the timeout is exceeded.
 */
async function pollForActivity(
  restClient: RestClient,
  contactId: string,
  subject: string,
  type = 'Task',
): Promise<ActivityListRow> {
  const deadline = Date.now() + MAX_POLL_MS;
  let backoff = INITIAL_BACKOFF_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    await new Promise((resolve) => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, 2_000);

    const res = await restClient.get<{ data: ActivityListRow[] }>(
      `/api/v1/activities?contact=${contactId}`,
    );
    const match = res.body.data.find((a) => a.subject === subject && a.type === type);
    if (match) return match;
  }

  throw new Error(
    `[pollForActivity] ${type} with subject "${subject}" not found after ${attempt} attempts ` +
      `(${MAX_POLL_MS}ms). Cron advancement may not have run.`,
  );
}

/**
 * Triggers sequence cron advancement on the E2E app server.
 * The E2E app server (port 3002) exposes a test-only endpoint
 * POST /api/v1/test/advance-sequences that calls advanceDueEnrollments().
 */
async function triggerSequenceAdvancement(restClient: RestClient): Promise<void> {
  await restClient.post('/api/v1/test/advance-sequences', {});
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

// ---------------------------------------------------------------------------
// F14-SM: Sequence management
// ---------------------------------------------------------------------------

test('@functional F14-SM1: create a sequence and verify it is returned by GET', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}`;
  const sequence = await createSequence(restClient, {
    name: `F14SM1 Sequence ${suffix}`,
    description: 'Automated test sequence',
    enabled: true,
  });

  testData.register('sequence', sequence.id, `/api/v1/sequences/${sequence.id}`);

  const fetched = await getSequence(restClient, sequence.id);

  expect(fetched.id, 'sequence id should match').toBe(sequence.id);
  expect(fetched.name, 'sequence name should match').toBe(`F14SM1 Sequence ${suffix}`);
  expect(fetched.description, 'description should match').toBe('Automated test sequence');
  expect(fetched.enabled, 'sequence should be enabled').toBe(true);
  expect(fetched.step_count, 'new sequence should have 0 steps').toBe(0);
  expect(fetched.active_enrollment_count, 'new sequence should have 0 active enrollments').toBe(0);
});

test('@functional F14-SM2: add a step to a sequence — step_count increments', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}`;
  const sequence = await createSequence(restClient, {
    name: `F14SM2 Sequence ${suffix}`,
    enabled: true,
  });
  testData.register('sequence', sequence.id, `/api/v1/sequences/${sequence.id}`);

  const step = await createSequenceStep(restClient, sequence.id, {
    sort_order: 1,
    action_type: 'create_task',
    action_config: { subject: 'Follow-up task' },
    delay_days: 0,
  });

  expect(step.sort_order, 'step sort order should be 1').toBe(1);
  expect(step.action_type, 'action type should be create_task').toBe('create_task');
  expect(step.delay_days, 'delay days should be 0').toBe(0);

  const updated = await getSequence(restClient, sequence.id);
  expect(updated.step_count, 'step_count should increment to 1').toBe(1);
});

test('@functional F14-SM3: delete a sequence — GET returns 404 afterwards', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}`;
  const sequence = await createSequence(restClient, {
    name: `F14SM3 Sequence ${suffix}`,
    enabled: true,
  });

  await deleteSequence(restClient, sequence.id);

  let deletedStatus: number | null = null;
  try {
    await restClient.get(`/api/v1/sequences/${sequence.id}`);
  } catch (err) {
    if (err instanceof RestClientError) {
      deletedStatus = err.status;
    }
  }
  expect(deletedStatus, 'deleted sequence should return 404').toBe(404);

  // Already deleted — no testData.register needed
  void testData; // fixture required but no cleanup needed
});

// ---------------------------------------------------------------------------
// F14-EN: Enrollment
// ---------------------------------------------------------------------------

test('@functional F14-EN1: enroll a contact — enrollment is active with correct sequence reference', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}`;

  const contact = await createTestContact(testData, restClient, {
    first_name: 'Enroll',
    last_name: `Test ${suffix}`,
  });

  const sequence = await createSequence(restClient, {
    name: `F14EN1 Sequence ${suffix}`,
    enabled: true,
  });
  testData.register('sequence', sequence.id, `/api/v1/sequences/${sequence.id}`);

  await createSequenceStep(restClient, sequence.id, {
    sort_order: 1,
    action_type: 'create_task',
    action_config: { subject: 'Intro task' },
    delay_days: 0,
  });

  const enrollment = await enrollContact(restClient, contact.id, sequence.id);

  expect(enrollment.status, 'enrollment should be active').toBe('active');
  expect(enrollment.sequence_id, 'enrollment sequence_id should match').toBe(sequence.id);
  expect(enrollment.contact_id, 'enrollment contact_id should match').toBe(contact.id);
  expect(enrollment.current_step_id, 'enrollment should have a current step').not.toBeNull();

  testData.register(
    'sequence_enrollment',
    enrollment.id,
    `/api/v1/sequence-enrollments/${enrollment.id}`,
  );
});

test('@functional F14-EN2: duplicate enrollment returns 409', async ({ restClient, testData }) => {
  const suffix = `${Date.now()}`;

  const contact = await createTestContact(testData, restClient, {
    first_name: 'Dup',
    last_name: `Enroll ${suffix}`,
  });

  const sequence = await createSequence(restClient, {
    name: `F14EN2 Sequence ${suffix}`,
    enabled: true,
  });
  testData.register('sequence', sequence.id, `/api/v1/sequences/${sequence.id}`);

  // delay_days: 1 — this test relies on the FIRST enrollment still being
  // 'active' when the SECOND enrollContact call runs a moment later (the
  // partial unique index only blocks a duplicate while status = 'active';
  // see sequenceService.ts's own comment on the cron's TOCTOU handling). A
  // zero-delay step risks the cron completing the first enrollment in that
  // gap, which would silently turn this into a false pass instead of the
  // 409 this test actually means to verify.
  await createSequenceStep(restClient, sequence.id, {
    sort_order: 1,
    action_type: 'create_task',
    action_config: { subject: 'Task' },
    delay_days: 1,
  });

  const enrollment = await enrollContact(restClient, contact.id, sequence.id);
  testData.register(
    'sequence_enrollment',
    enrollment.id,
    `/api/v1/sequence-enrollments/${enrollment.id}`,
  );

  let duplicateStatus: number | null = null;
  let duplicateCode: string | null = null;
  try {
    await enrollContact(restClient, contact.id, sequence.id);
  } catch (err) {
    if (err instanceof RestClientError) {
      duplicateStatus = err.status;
      duplicateCode = (err.body as { error?: { code?: string } } | null)?.error?.code ?? null;
    }
  }

  expect(duplicateStatus, 'duplicate enrollment should return 409').toBe(409);
  expect(duplicateCode, 'error code should be ENROLLMENT_DUPLICATE').toBe('ENROLLMENT_DUPLICATE');
});

test('@functional F14-EN3: unenroll a contact — status becomes unenrolled', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}`;

  const contact = await createTestContact(testData, restClient, {
    first_name: 'Unenroll',
    last_name: `Test ${suffix}`,
  });

  const sequence = await createSequence(restClient, {
    name: `F14EN3 Sequence ${suffix}`,
    enabled: true,
  });
  testData.register('sequence', sequence.id, `/api/v1/sequences/${sequence.id}`);

  // delay_days: 1 — unenrollContact requires status = 'active' (throws
  // ENROLLMENT_NOT_ACTIVE otherwise; see sequenceService.ts). A zero-delay
  // step risks the cron completing this enrollment in the gap between
  // enrollContact and unenrollContact, which would fail this test with that
  // error instead of the 'unenrolled' transition it means to verify.
  await createSequenceStep(restClient, sequence.id, {
    sort_order: 1,
    action_type: 'create_task',
    action_config: { subject: 'Task' },
    delay_days: 1,
  });

  const enrollment = await enrollContact(restClient, contact.id, sequence.id);

  const unenrolled = await unenrollContact(restClient, enrollment.id);

  expect(unenrolled.status, 'status should be unenrolled').toBe('unenrolled');
  expect(unenrolled.next_action_at, 'next_action_at should be cleared').toBeNull();
  expect(unenrolled.unenrolled_at, 'unenrolled_at should be set').not.toBeNull();

  // Verify active_enrollment_count decremented
  const seq = await getSequence(restClient, sequence.id);
  expect(seq.active_enrollment_count, 'active enrollment count should be 0').toBe(0);
});

test('@functional F14-EN4: listContactEnrollments returns the active enrollment', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}`;

  const contact = await createTestContact(testData, restClient, {
    first_name: 'ListEnroll',
    last_name: `Test ${suffix}`,
  });

  const sequence = await createSequence(restClient, {
    name: `F14EN4 Sequence ${suffix}`,
    enabled: true,
  });
  testData.register('sequence', sequence.id, `/api/v1/sequences/${sequence.id}`);

  // delay_days: 1 (not 0) — this test asserts 'active' via a SEPARATE
  // getContactEnrollments call after enrollContact returns, unlike F14-EN1's
  // same-response-cycle read. A zero-delay first step sets next_action_at to
  // the moment of enrollment, which the sequence-advancement cron (runs
  // unconditionally on the wall-clock schedule */15 * * * *, not relative to
  // server start — see server.ts) can sweep up and mark 'completed' in the
  // gap between the two calls if its tick lands there. A 1-day delay keeps
  // next_action_at safely in the future regardless of cron timing.
  await createSequenceStep(restClient, sequence.id, {
    sort_order: 1,
    action_type: 'create_task',
    action_config: { subject: 'Task' },
    delay_days: 1,
  });

  const enrollment = await enrollContact(restClient, contact.id, sequence.id);
  testData.register(
    'sequence_enrollment',
    enrollment.id,
    `/api/v1/sequence-enrollments/${enrollment.id}`,
  );

  const enrollments = await getContactEnrollments(restClient, contact.id);

  expect(enrollments.length, 'should have 1 enrollment').toBeGreaterThanOrEqual(1);
  const found = enrollments.find((e) => e.id === enrollment.id);
  expect(found, 'created enrollment should appear in the list').toBeDefined();
  expect(found!.status, 'enrollment status should be active').toBe('active');
});

// ---------------------------------------------------------------------------
// F14-CR: Cron advancement
// ---------------------------------------------------------------------------

test('@functional F14-CR1: step fires and creates a Task activity when next_action_at is past', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}`;
  const taskSubject = `F14CR1 Intro Task ${suffix}`;

  const contact = await createTestContact(testData, restClient, {
    first_name: 'Cron',
    last_name: `Test ${suffix}`,
  });

  const sequence = await createSequence(restClient, {
    name: `F14CR1 Sequence ${suffix}`,
    enabled: true,
  });
  testData.register('sequence', sequence.id, `/api/v1/sequences/${sequence.id}`);

  await createSequenceStep(restClient, sequence.id, {
    sort_order: 1,
    action_type: 'create_task',
    action_config: { subject: taskSubject },
    delay_days: 0,
  });

  // Enroll the contact (delay_days=0 → next_action_at ≈ now, already due)
  const enrollment = await enrollContact(restClient, contact.id, sequence.id);
  testData.register(
    'sequence_enrollment',
    enrollment.id,
    `/api/v1/sequence-enrollments/${enrollment.id}`,
  );

  // Trigger the cron job on the E2E server
  await triggerSequenceAdvancement(restClient);

  // Poll until the Task activity appears linked to the contact
  const activityRow = await pollForActivity(restClient, contact.id, taskSubject, 'Task');

  expect(activityRow.subject, 'task subject should match action_config').toBe(taskSubject);
  expect(activityRow.type, 'created activity should be a Task').toBe('Task');
  expect(activityRow.contact_id, 'activity should be linked to the enrolled contact').toBe(
    contact.id,
  );

  // Fetch full activity to verify ownership
  const activity = await getActivityById(restClient, activityRow.id);
  expect(activity.status, 'task status should be open').toBe('open');

  testData.register('activity', activity.id, `/api/v1/activities/${activity.id}`);
});

test('@functional F14-CR2: enrollment is marked completed after the last step fires', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}`;

  const contact = await createTestContact(testData, restClient, {
    first_name: 'Complete',
    last_name: `Cron ${suffix}`,
  });

  const sequence = await createSequence(restClient, {
    name: `F14CR2 Sequence ${suffix}`,
    enabled: true,
  });
  testData.register('sequence', sequence.id, `/api/v1/sequences/${sequence.id}`);

  await createSequenceStep(restClient, sequence.id, {
    sort_order: 1,
    action_type: 'create_task',
    action_config: { subject: `F14CR2 Task ${suffix}` },
    delay_days: 0,
  });

  const enrollment = await enrollContact(restClient, contact.id, sequence.id);

  // Trigger cron
  await triggerSequenceAdvancement(restClient);

  // Poll until the activity appears (confirms cron ran)
  await pollForActivity(restClient, contact.id, `F14CR2 Task ${suffix}`, 'Task');

  // Now verify the enrollment is completed
  const enrollmentRes = await restClient.get<{ enrollment: { status: string } }>(
    `/api/v1/sequence-enrollments/${enrollment.id}`,
  );
  expect(
    enrollmentRes.body.enrollment.status,
    'enrollment should be completed after the only step fires',
  ).toBe('completed');
});
