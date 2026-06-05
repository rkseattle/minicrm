/**
 * Sequences API module (MINCRM-403).
 * Wraps the sales sequence and enrollment endpoints.
 */

import apiClient from './axiosInstance.js';
import type {
  SequenceResponse,
  SequenceStepResponse,
  EnrollmentResponse,
  CreateSequenceInput,
  UpdateSequenceInput,
  CreateSequenceStepInput,
  UpdateSequenceStepInput,
} from '@shared/schemas/sequenceSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';
import { PAGINATION_DEFAULT_LIMIT } from '@shared/schemas/paginationSchema.js';

/** React Query cache key for the sequences list */
export const SEQUENCES_QUERY_KEY = ['sequences'] as const;

/** React Query cache key factory for a single sequence */
export const sequenceQueryKey = (id: string) => ['sequences', id] as const;

/** React Query cache key factory for steps of a sequence */
export const sequenceStepsQueryKey = (sequenceId: string) =>
  ['sequences', sequenceId, 'steps'] as const;

/** React Query cache key factory for enrollments on a contact */
export const contactEnrollmentsQueryKey = (contactId: string) =>
  ['contacts', contactId, 'sequence-enrollments'] as const;

interface SequenceSingleResponse {
  sequence: SequenceResponse;
}

interface StepSingleResponse {
  step: SequenceStepResponse;
}

interface StepsListResponse {
  steps: SequenceStepResponse[];
}

interface EnrollmentSingleResponse {
  enrollment: EnrollmentResponse;
}

interface EnrollmentsListResponse {
  enrollments: EnrollmentResponse[];
}

// ── Sequence CRUD ──────────────────────────────────────────────────────────────

/**
 * Returns a paginated list of sequences.
 */
export async function listSequences(
  page = 1,
  limit = PAGINATION_DEFAULT_LIMIT,
): Promise<PaginatedResponse<SequenceResponse>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  const response = await apiClient.get<PaginatedResponse<SequenceResponse>>(`/sequences?${params}`);
  return response.data;
}

/**
 * Returns a single sequence by UUID.
 */
export async function getSequence(id: string): Promise<SequenceSingleResponse> {
  const response = await apiClient.get<SequenceSingleResponse>(`/sequences/${id}`);
  return response.data;
}

/**
 * Creates a new sequence. Admin only.
 */
export async function createSequence(data: CreateSequenceInput): Promise<SequenceSingleResponse> {
  const response = await apiClient.post<SequenceSingleResponse>('/sequences', data);
  return response.data;
}

/**
 * Updates a sequence. Admin only.
 */
export async function updateSequence(
  id: string,
  data: UpdateSequenceInput,
): Promise<SequenceSingleResponse> {
  const response = await apiClient.patch<SequenceSingleResponse>(`/sequences/${id}`, data);
  return response.data;
}

/**
 * Deletes a sequence. Admin only. Throws 409 if active enrollments exist.
 */
export async function deleteSequence(id: string): Promise<void> {
  await apiClient.delete(`/sequences/${id}`);
}

// ── Step CRUD ──────────────────────────────────────────────────────────────────

/**
 * Returns all steps for a sequence ordered by sort_order.
 */
export async function listSequenceSteps(sequenceId: string): Promise<StepsListResponse> {
  const response = await apiClient.get<StepsListResponse>(`/sequences/${sequenceId}/steps`);
  return response.data;
}

/**
 * Adds a step to a sequence. Admin only.
 */
export async function createSequenceStep(
  sequenceId: string,
  data: CreateSequenceStepInput,
): Promise<StepSingleResponse> {
  const response = await apiClient.post<StepSingleResponse>(`/sequences/${sequenceId}/steps`, data);
  return response.data;
}

/**
 * Updates a step. Admin only.
 */
export async function updateSequenceStep(
  sequenceId: string,
  stepId: string,
  data: UpdateSequenceStepInput,
): Promise<StepSingleResponse> {
  const response = await apiClient.patch<StepSingleResponse>(
    `/sequences/${sequenceId}/steps/${stepId}`,
    data,
  );
  return response.data;
}

/**
 * Deletes a step. Admin only.
 */
export async function deleteSequenceStep(sequenceId: string, stepId: string): Promise<void> {
  await apiClient.delete(`/sequences/${sequenceId}/steps/${stepId}`);
}

// ── Enrollment ─────────────────────────────────────────────────────────────────

/**
 * Returns all sequence enrollments for a contact.
 */
export async function listContactEnrollments(contactId: string): Promise<EnrollmentsListResponse> {
  const response = await apiClient.get<EnrollmentsListResponse>(
    `/contacts/${contactId}/sequence-enrollments`,
  );
  return response.data;
}

/**
 * Enrolls a contact in a sequence.
 */
export async function enrollContact(
  contactId: string,
  sequenceId: string,
): Promise<EnrollmentSingleResponse> {
  const response = await apiClient.post<EnrollmentSingleResponse>(
    `/contacts/${contactId}/sequence-enrollments`,
    { sequence_id: sequenceId },
  );
  return response.data;
}

/**
 * Unenrolls a contact (by enrollment ID).
 */
export async function unenrollContact(enrollmentId: string): Promise<EnrollmentSingleResponse> {
  const response = await apiClient.delete<EnrollmentSingleResponse>(
    `/sequence-enrollments/${enrollmentId}`,
  );
  return response.data;
}
