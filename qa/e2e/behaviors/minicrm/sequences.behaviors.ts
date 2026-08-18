/**
 * Sequences behaviors for MiniCRM.
 *
 * Provides REST API helpers for creating and managing sales sequences,
 * sequence steps, and enrollments in E2E tests.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 *
 */

import type { RestClient } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// API data types
// ---------------------------------------------------------------------------

/** Shape returned by GET/POST /api/v1/sequences/:id. */
export interface TestSequence {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  created_by: string | null;
  step_count: number;
  active_enrollment_count: number;
  created_at: string;
  updated_at: string;
}

/** Shape returned by GET/POST /api/v1/sequences/:id/steps. */
export interface TestSequenceStep {
  id: string;
  sequence_id: string;
  sort_order: number;
  action_type: string;
  action_config: Record<string, unknown>;
  delay_days: number;
  created_at: string;
  updated_at: string;
}

/** Shape returned by enrollment endpoints. */
export interface TestEnrollment {
  id: string;
  sequence_id: string;
  sequence_name: string;
  contact_id: string;
  enrolled_by_id: string | null;
  enrolled_at: string;
  status: 'active' | 'completed' | 'unenrolled';
  current_step_id: string | null;
  current_step_sort_order: number | null;
  next_action_at: string | null;
  unenrolled_at: string | null;
}

// ---------------------------------------------------------------------------
// Sequence CRUD
// ---------------------------------------------------------------------------

/**
 * Creates a sequence via the REST API.
 *
 * @param restClient - Authenticated RestClient (must be admin).
 * @param params - Sequence creation parameters.
 * @returns The created sequence.
 */
export async function createSequence(
  restClient: RestClient,
  params: { name: string; description?: string; enabled?: boolean },
): Promise<TestSequence> {
  const res = await restClient.post<{ sequence: TestSequence }>('/api/v1/sequences', {
    name: params.name,
    description: params.description,
    enabled: params.enabled ?? true,
  });
  return res.body.sequence;
}

/**
 * Deletes a sequence via the REST API.
 *
 * @param restClient - Authenticated RestClient (must be admin).
 * @param sequenceId - UUID of the sequence to delete.
 */
export async function deleteSequence(restClient: RestClient, sequenceId: string): Promise<void> {
  await restClient.delete(`/api/v1/sequences/${sequenceId}`);
}

/**
 * Fetches a single sequence by ID.
 *
 * @param restClient - Authenticated RestClient.
 * @param sequenceId - UUID of the sequence.
 * @returns The sequence record.
 */
export async function getSequence(
  restClient: RestClient,
  sequenceId: string,
): Promise<TestSequence> {
  const res = await restClient.get<{ sequence: TestSequence }>(`/api/v1/sequences/${sequenceId}`);
  return res.body.sequence;
}

// ---------------------------------------------------------------------------
// Step CRUD
// ---------------------------------------------------------------------------

/**
 * Adds a step to a sequence via the REST API.
 *
 * @param restClient - Authenticated RestClient (must be admin).
 * @param sequenceId - UUID of the parent sequence.
 * @param params - Step creation parameters.
 * @returns The created step.
 */
export async function createSequenceStep(
  restClient: RestClient,
  sequenceId: string,
  params: {
    sort_order: number;
    action_type: string;
    action_config: Record<string, unknown>;
    delay_days?: number;
  },
): Promise<TestSequenceStep> {
  const res = await restClient.post<{ step: TestSequenceStep }>(
    `/api/v1/sequences/${sequenceId}/steps`,
    {
      sort_order: params.sort_order,
      action_type: params.action_type,
      action_config: params.action_config,
      delay_days: params.delay_days ?? 0,
    },
  );
  return res.body.step;
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

/**
 * Enrolls a contact in a sequence via the REST API.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - UUID of the contact to enroll.
 * @param sequenceId - UUID of the sequence.
 * @returns The created enrollment.
 */
export async function enrollContact(
  restClient: RestClient,
  contactId: string,
  sequenceId: string,
): Promise<TestEnrollment> {
  const res = await restClient.post<{ enrollment: TestEnrollment }>(
    `/api/v1/contacts/${contactId}/sequence-enrollments`,
    { sequence_id: sequenceId },
  );
  return res.body.enrollment;
}

/**
 * Unenrolls a contact by enrollment ID.
 *
 * @param restClient - Authenticated RestClient.
 * @param enrollmentId - UUID of the enrollment to unenroll.
 * @returns The updated enrollment with status 'unenrolled'.
 */
export async function unenrollContact(
  restClient: RestClient,
  enrollmentId: string,
): Promise<TestEnrollment> {
  const res = await restClient.delete<{ enrollment: TestEnrollment }>(
    `/api/v1/sequence-enrollments/${enrollmentId}`,
  );
  return res.body.enrollment;
}

/**
 * Fetches all enrollments for a contact.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - UUID of the contact.
 * @returns Array of enrollment records.
 */
export async function getContactEnrollments(
  restClient: RestClient,
  contactId: string,
): Promise<TestEnrollment[]> {
  const res = await restClient.get<{ enrollments: TestEnrollment[] }>(
    `/api/v1/contacts/${contactId}/sequence-enrollments`,
  );
  return res.body.enrollments;
}
