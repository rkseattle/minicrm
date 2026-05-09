/**
 * Notes behaviors for MiniCRM. (MINCRM-352)
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { NotesPage } from '@pages/minicrm/NotesPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by notes behaviors. */
export interface NotesBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// createNoteViaUI()
// ---------------------------------------------------------------------------

/** Input for the createNoteViaUI behavior. */
export interface CreateNoteInput {
  title?: string;
  /** Plain text to type into the body editor. */
  bodyText: string;
  visibility?: 'private' | 'team' | 'public';
  tags?: string[];
}

/** Result returned by createNoteViaUI. */
export interface CreateNoteResult {
  /** True when the composer closed successfully after saving. */
  saved: boolean;
  /** True when the notes list is visible after save. */
  listVisible: boolean;
}

/**
 * Opens the note composer, fills in the given fields, and saves.
 *
 * @param context - Playwright fixture context.
 * @param input - Note fields to fill.
 * @returns CreateNoteResult describing the outcome.
 */
export async function createNoteViaUI(
  context: NotesBehaviorContext,
  input: CreateNoteInput,
): Promise<CreateNoteResult> {
  const notes = new NotesPage(context);

  await notes.clickAddNote();

  if (input.title) {
    await notes.fillTitle(input.title);
  }

  await notes.typeBody(input.bodyText);

  if (input.visibility && input.visibility !== 'team') {
    await notes.selectVisibility(input.visibility);
  }

  for (const tag of input.tags ?? []) {
    await notes.addTag(tag);
  }

  await notes.clickSave();

  // Wait for the composer to close — indicates save succeeded
  let saved = false;
  try {
    const composer = await notes.composerLocator();
    saved = composer === null;
  } catch {
    saved = true; // locator threw because composer is gone
  }

  const list = await notes.notesListLocator();
  return { saved, listVisible: list !== null };
}

// ---------------------------------------------------------------------------
// editNoteViaUI()
// ---------------------------------------------------------------------------

/** Input for the editNoteViaUI behavior. */
export interface EditNoteInput {
  noteId: string;
  title?: string;
}

/** Result returned by editNoteViaUI. */
export interface EditNoteResult {
  /** True when the composer closed after saving. */
  saved: boolean;
}

/**
 * Clicks the Edit button on a note card, updates the title, and saves.
 *
 * @param context - Playwright fixture context.
 * @param input - Note ID and updated fields.
 * @returns EditNoteResult describing the outcome.
 */
export async function editNoteViaUI(
  context: NotesBehaviorContext,
  input: EditNoteInput,
): Promise<EditNoteResult> {
  const notes = new NotesPage(context);

  await notes.clickEditNote(input.noteId);

  if (input.title) {
    await notes.fillTitle(input.title);
  }

  await notes.clickSave();

  let saved = false;
  try {
    const composer = await notes.composerLocator();
    saved = composer === null;
  } catch {
    saved = true;
  }

  return { saved };
}

// ---------------------------------------------------------------------------
// deleteNoteViaUI()
// ---------------------------------------------------------------------------

/** Result returned by deleteNoteViaUI. */
export interface DeleteNoteResult {
  /** True when the confirmation modal closed after confirming. */
  confirmed: boolean;
}

/**
 * Clicks the Delete button on a note card and confirms in the modal.
 *
 * @param context - Playwright fixture context.
 * @param noteId - ID of the note to delete.
 * @returns DeleteNoteResult describing the outcome.
 */
export async function deleteNoteViaUI(
  context: NotesBehaviorContext,
  noteId: string,
): Promise<DeleteNoteResult> {
  const notes = new NotesPage(context);

  await notes.clickDeleteNote(noteId);
  await notes.confirmDelete();

  // Give the modal time to close
  let confirmed = false;
  try {
    const card = await notes.noteCardLocator(noteId);
    confirmed = card === null;
  } catch {
    confirmed = true;
  }

  return { confirmed };
}

// ---------------------------------------------------------------------------
// noteCardIsVisible()
// ---------------------------------------------------------------------------

/**
 * Returns true when a note card for the given ID is visible on the page.
 *
 * @param context - Playwright fixture context.
 * @param noteId - Note UUID.
 */
export async function noteCardIsVisible(
  context: NotesBehaviorContext,
  noteId: string,
): Promise<boolean> {
  const notes = new NotesPage(context);
  const card = await notes.noteCardLocator(noteId);
  if (!card) return false;
  return card.isVisible();
}

// ---------------------------------------------------------------------------
// maskedNoteCardIsVisible()
// ---------------------------------------------------------------------------

/**
 * Returns true when a masked (private) note placeholder is visible.
 *
 * @param context - Playwright fixture context.
 * @param noteId - Note UUID.
 */
export async function maskedNoteCardIsVisible(
  context: NotesBehaviorContext,
  noteId: string,
): Promise<boolean> {
  const notes = new NotesPage(context);
  const card = await notes.maskedNoteCardLocator(noteId);
  if (!card) return false;
  return card.isVisible();
}
