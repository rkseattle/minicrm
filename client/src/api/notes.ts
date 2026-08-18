/**
 * Notes API module.
 * Wraps the notes CRUD endpoints. All endpoints require authentication.
 */

import apiClient from './axiosInstance.js';
import type {
  CreateNoteInput,
  UpdateNoteInput,
  NoteEntityType,
  NoteResponse,
} from '@shared/schemas/noteSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';

/** React Query cache key factory for notes — keyed by entity type + entity ID */
export const notesQueryKey = (entityType: NoteEntityType, entityId: string) =>
  ['notes', entityType, entityId] as const;

export interface NoteEnvelope {
  note: NoteResponse;
}

/**
 * Returns a paginated list of notes for a parent entity.
 *
 * @param entityType - One of: contact | account | deal | lead
 * @param entityId - UUID of the parent entity
 * @param page - 1-based page number
 * @param limit - Records per page
 */
export async function listNotes(
  entityType: NoteEntityType,
  entityId: string,
  page = 1,
  limit = 25,
): Promise<PaginatedResponse<NoteResponse>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  const response = await apiClient.get<PaginatedResponse<NoteResponse>>(
    `/${entityType}/${entityId}/notes?${params}`,
  );
  return response.data;
}

/**
 * Returns a single note by ID.
 *
 * @param entityType - Parent entity type
 * @param entityId - Parent entity UUID
 * @param noteId - Note UUID
 */
export async function getNote(
  entityType: NoteEntityType,
  entityId: string,
  noteId: string,
): Promise<NoteEnvelope> {
  const response = await apiClient.get<NoteEnvelope>(`/${entityType}/${entityId}/notes/${noteId}`);
  return response.data;
}

/**
 * Creates a new note on the given entity.
 *
 * @param entityType - Parent entity type
 * @param entityId - Parent entity UUID
 * @param data - Note fields
 */
export async function createNote(
  entityType: NoteEntityType,
  entityId: string,
  data: CreateNoteInput,
): Promise<NoteEnvelope> {
  const response = await apiClient.post<NoteEnvelope>(`/${entityType}/${entityId}/notes`, data);
  return response.data;
}

/**
 * Updates a note. Only the creator or an admin may update.
 *
 * @param entityType - Parent entity type
 * @param entityId - Parent entity UUID
 * @param noteId - Note UUID
 * @param data - Fields to update
 */
export async function updateNote(
  entityType: NoteEntityType,
  entityId: string,
  noteId: string,
  data: UpdateNoteInput,
): Promise<NoteEnvelope> {
  const response = await apiClient.patch<NoteEnvelope>(
    `/${entityType}/${entityId}/notes/${noteId}`,
    data,
  );
  return response.data;
}

/**
 * Soft-deletes a note. Only the creator or an admin may delete.
 *
 * @param entityType - Parent entity type
 * @param entityId - Parent entity UUID
 * @param noteId - Note UUID
 */
export async function deleteNote(
  entityType: NoteEntityType,
  entityId: string,
  noteId: string,
): Promise<void> {
  await apiClient.delete(`/${entityType}/${entityId}/notes/${noteId}`);
}
