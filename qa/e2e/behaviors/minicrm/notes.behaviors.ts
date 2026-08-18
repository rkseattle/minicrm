/**
 * Notes behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 */

import type { RestClient } from '@framework/clients/rest-client.js';
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

  // Wait for the composer to disappear — indicates save succeeded
  let saved = false;
  try {
    await notes.waitForComposerClosed();
    saved = true;
  } catch {
    saved = false;
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
    await notes.waitForComposerClosed();
    saved = true;
  } catch {
    saved = false;
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

  // Wait for the delete modal to close — indicates the action was processed
  let confirmed = false;
  try {
    await notes.waitForDeleteModalClosed();
    confirmed = true;
  } catch {
    confirmed = false;
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

// ---------------------------------------------------------------------------
// API data-fetch helpers
// ---------------------------------------------------------------------------

/** Shape of a note returned by GET /api/v1/contact/:id/notes/:noteId. */
export interface NoteRow {
  id: string;
  title: string | null;
  body: string;
  visibility: 'team' | 'private';
  is_masked: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

/** Shape of a paginated notes list. */
export interface NoteListRow {
  id: string;
  title: string | null;
  visibility: 'team' | 'private';
  is_masked: boolean;
  tags: string[];
  total: number;
}

/** Parameters for creating a note via the API. */
export interface CreateNoteParams {
  body: string;
  title?: string;
  visibility?: 'team' | 'private';
  tags?: string[];
}

/**
 * Creates a note on a contact via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - Contact UUID.
 * @param params - Note fields.
 * @returns The created note record.
 */
export async function createNoteViaApi(
  restClient: RestClient,
  contactId: string,
  params: CreateNoteParams,
): Promise<NoteRow> {
  const res = await restClient.post<{ note: NoteRow }>(
    `/api/v1/contact/${contactId}/notes`,
    params,
  );
  return res.body.note;
}

/**
 * Fetches a single note by ID from the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - Contact UUID.
 * @param noteId - Note UUID.
 * @returns The note record.
 */
export async function getNoteById(
  restClient: RestClient,
  contactId: string,
  noteId: string,
): Promise<NoteRow> {
  const res = await restClient.get<{ note: NoteRow }>(
    `/api/v1/contact/${contactId}/notes/${noteId}`,
  );
  return res.body.note;
}

/**
 * Lists notes for a contact from the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - Contact UUID.
 * @returns Object with data array and total count.
 */
export async function listNotes(
  restClient: RestClient,
  contactId: string,
): Promise<{ data: NoteListRow[]; total: number }> {
  const res = await restClient.get<{ data: NoteListRow[]; total: number }>(
    `/api/v1/contact/${contactId}/notes`,
  );
  return { data: res.body.data, total: res.body.total };
}

/**
 * Patches a note's fields via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - Contact UUID.
 * @param noteId - Note UUID.
 * @param patch - Fields to update.
 */
export async function patchNote(
  restClient: RestClient,
  contactId: string,
  noteId: string,
  patch: Partial<Pick<NoteRow, 'title' | 'body' | 'visibility' | 'tags'>>,
): Promise<void> {
  await restClient.patch(`/api/v1/contact/${contactId}/notes/${noteId}`, patch);
}

/**
 * Deletes a note via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param contactId - Contact UUID.
 * @param noteId - Note UUID.
 */
export async function deleteNote(
  restClient: RestClient,
  contactId: string,
  noteId: string,
): Promise<void> {
  await restClient.delete(`/api/v1/contact/${contactId}/notes/${noteId}`);
}

/**
 * Fetches audit log entries for a record via the per-record endpoint.
 *
 * @param restClient - Authenticated RestClient.
 * @param recordType - Record type (e.g. 'contact').
 * @param recordId - Record UUID.
 * @param all - When true, includes all events including note_created/updated/deleted.
 * @returns Object with entries array.
 */
export async function getRecordAuditLog(
  restClient: RestClient,
  recordType: string,
  recordId: string,
  all = false,
): Promise<{ entries: Array<{ event_type: string; field_name: string | null }> }> {
  const query = `?record_type=${recordType}&record_id=${recordId}${all ? '&all=true' : ''}`;
  const res = await restClient.get<{
    entries: Array<{ event_type: string; field_name: string | null }>;
  }>(`/api/v1/audit-log/record${query}`);
  return { entries: res.body.entries };
}

// ---------------------------------------------------------------------------
// Locator-accessor behaviors — wrap NotesPage locators
// so spec files never import @pages/* directly.
// ---------------------------------------------------------------------------

/** Waits for the notes section container to become visible on an entity detail page. */
export async function waitForNotesSection(context: NotesBehaviorContext): Promise<void> {
  const locator = await new NotesPage(context).sectionLocator();
  await locator.waitFor({ state: 'visible' });
}

/**
 * Waits for the note card for the given ID to become visible, with an optional timeout (ms).
 * The card may not be immediately in the DOM after navigation.
 */
export async function waitForNoteCard(
  noteId: string,
  context: NotesBehaviorContext,
  timeout = 8_000,
): Promise<void> {
  // waitForPresent polls document.querySelector before resolve() so we don't hit
  // the 2s HealingLocator probe timeout while the note card is still mounting.
  await context.page.waitForPresent(`[data-testid="note-card-${noteId}"]`, timeout);
  const locator = await new NotesPage(context).noteCardLocator(noteId);
  if (locator) {
    await locator.waitFor({ state: 'visible', timeout });
  }
}

/**
 * Waits for the note card for the given ID to be removed from the DOM.
 * Used after a delete to confirm the list has refreshed.
 */
export async function waitForNoteCardDetached(
  noteId: string,
  context: NotesBehaviorContext,
  timeout = 8_000,
): Promise<void> {
  // The note card is fully removed from the DOM after deletion — use waitForAbsent
  // to poll document.querySelector rather than resolve() which would throw.
  await context.page.waitForAbsent(`[data-testid="note-card-${noteId}"]`, timeout);
}

/** Asserts the note card for the given ID is visible. */
export async function expectNoteCardVisible(
  noteId: string,
  context: NotesBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NotesPage(context).noteCardLocator(noteId);
  // noteCardLocator is nullable; null means the card is absent, which fails visibility.
  if (locator === null) throw new Error(`note card for ${noteId} not found`);
  await expect(locator).toBeVisible();
}

/** Waits for the masked (private) note card for the given ID to become visible. */
export async function waitForMaskedNoteCard(
  noteId: string,
  context: NotesBehaviorContext,
  timeout?: number,
): Promise<void> {
  const locator = await new NotesPage(context).maskedNoteCardLocator(noteId);
  await locator?.waitFor({ state: 'visible', ...(timeout !== undefined ? { timeout } : {}) });
}

/** Asserts the masked (private) note card for the given ID is visible. */
export async function expectMaskedNoteCardVisible(
  noteId: string,
  context: NotesBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NotesPage(context).maskedNoteCardLocator(noteId);
  // maskedNoteCardLocator is nullable; if it resolves to null the masked element
  // is absent from the page which would fail the visibility assertion anyway.
  if (locator === null) throw new Error(`masked note card for ${noteId} not found`);
  await expect(locator).toBeVisible();
}

/** Returns true when the masked note card for the given ID is absent or hidden. */
export async function isMaskedNoteCardHidden(
  noteId: string,
  context: NotesBehaviorContext,
): Promise<boolean> {
  const locator = await new NotesPage(context).maskedNoteCardLocator(noteId);
  return locator === null || !(await locator.isVisible().catch(() => false));
}

/** Returns true when the note card for the given ID is absent or hidden. */
export async function isNoteCardHidden(
  noteId: string,
  context: NotesBehaviorContext,
): Promise<boolean> {
  const locator = await new NotesPage(context).noteCardLocator(noteId);
  return locator === null || !(await locator.isVisible().catch(() => false));
}

/**
 * Waits for the note title to become visible and asserts it has the expected text.
 * Used after editing a note to confirm the updated title is rendered.
 */
export async function expectNoteTitleText(
  noteId: string,
  expectedText: string,
  context: NotesBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NotesPage(context).noteTitleLocator(noteId);
  await locator.waitFor({ state: 'visible', ...(timeout !== undefined ? { timeout } : {}) });
  await expect(locator).toHaveText(expectedText);
}

/** Returns the text content of the title element inside a note card. */
export async function getNoteCardTitle(
  noteId: string,
  context: NotesBehaviorContext,
): Promise<string | null> {
  const locator = await new NotesPage(context).noteTitleLocator(noteId);
  return locator.textContent();
}

/** Returns the text content of the body element inside a note card (null if absent). */
export async function getNoteCardBody(
  noteId: string,
  context: NotesBehaviorContext,
): Promise<string | null> {
  const locator = await new NotesPage(context).noteBodyLocator(noteId);
  if (!locator) return null;
  return locator.textContent();
}

/**
 * Returns true when the note is team-visible (either the card is visible, or it is not masked).
 * Used to assert that a note changed from private to team is accessible in the UI.
 */
export async function isNoteTeamVisible(
  noteId: string,
  context: NotesBehaviorContext,
): Promise<boolean> {
  const noteCard = await new NotesPage(context).noteCardLocator(noteId);
  const maskedCard = await new NotesPage(context).maskedNoteCardLocator(noteId);
  const isNoteVisible = noteCard ? await noteCard.isVisible().catch(() => false) : false;
  const isMasked = maskedCard ? await maskedCard.isVisible().catch(() => false) : false;
  return isNoteVisible || !isMasked;
}

/** Returns true when the note body element is absent (null locator) — used to verify rep B cannot see a private note's body. */
export async function isNoteBodyAbsent(
  noteId: string,
  context: NotesBehaviorContext,
): Promise<boolean> {
  const locator = await new NotesPage(context).noteBodyLocator(noteId);
  return locator === null;
}
