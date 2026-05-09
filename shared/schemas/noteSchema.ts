/**
 * Shared Zod schemas and TypeScript types for the notes feature. (MINCRM-352)
 * Used by both client and server.
 */

import { z } from 'zod';

/** Valid entity types that can have notes attached */
export const NOTE_ENTITY_TYPES = ['contact', 'account', 'deal', 'lead'] as const;
export type NoteEntityType = (typeof NOTE_ENTITY_TYPES)[number];

/** Visibility levels for a note */
export const NOTE_VISIBILITIES = ['private', 'team', 'public'] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const createNoteSchema = z.object({
  title: z.string().max(255).optional(),
  /** Serialised Lexical editor state JSON */
  body: z.string().min(1, 'Note body is required'),
  visibility: z.enum(NOTE_VISIBILITIES).default('team'),
  tags: z.array(z.string()).default([]),
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z.object({
  title: z.string().max(255).optional(),
  body: z.string().min(1).optional(),
  visibility: z.enum(NOTE_VISIBILITIES).optional(),
  tags: z.array(z.string()).optional(),
});

export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

/** Full note response returned to the client; body/title omitted for masked private notes */
export interface NoteResponse {
  id: string;
  entity_type: NoteEntityType;
  entity_id: string;
  /** Omitted when the note is private and the caller is not the creator */
  title: string | null;
  /** Omitted when the note is private and the caller is not the creator */
  body: string | null;
  /** Omitted when the note is private and the caller is not the creator */
  body_text: string | null;
  visibility: NoteVisibility;
  tags: string[];
  created_by: string;
  created_by_name: string;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
  /** True when the note is private and body/title have been omitted */
  is_masked: boolean;
}
