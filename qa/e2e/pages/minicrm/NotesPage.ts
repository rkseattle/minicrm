/**
 * NotesPage — Page Object for the MiniCRM notes section.
 *
 * Used on any entity detail page that embeds the NotesSection component:
 * contact, account, deal, and lead detail pages.
 *
 * MINCRM-352
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Context required by NotesPage. */
export interface NotesPageContext {
  page: PageFacade;
}

/**
 * Page Object for the embedded NotesSection component.
 *
 * Does NOT navigate — callers navigate to the parent entity detail page first.
 * Every public method resolves a locator or performs an interaction.
 * No assertions, no business logic.
 */
export class NotesPage {
  private readonly page: PageFacade;

  constructor(context: NotesPageContext) {
    this.page = context.page;
  }

  /** Returns the notes section container. */
  async sectionLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'notes-section' },
          { type: 'role', value: 'region', options: { name: /notes/i } },
        ],
        { intent: 'notes section container on entity detail page' },
      )
      .resolve();
  }

  /** Returns the Add Note button (only visible when composer is closed). */
  async addButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'notes-add-button' },
          { type: 'role', value: 'button', options: { name: /add note/i } },
        ],
        { intent: 'add note button to open composer' },
      )
      .resolve();
  }

  /** Clicks the Add Note button to open the composer. */
  async clickAddNote(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'notes-add-button' },
        { type: 'role', value: 'button', options: { name: /add note/i } },
      ],
      { intent: 'add note button to open composer' },
    );
  }

  /** Returns the composer container (only present when it is open). */
  async composerLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'notes-composer' },
          { type: 'css', value: '[data-testid="notes-composer"]' },
        ],
        { intent: 'note composer form container' },
      )
      .resolve()
      .catch(() => null);
  }

  /** Returns the title input inside the composer. */
  async composerTitleInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'notes-composer-title' },
          { type: 'css', value: 'input[placeholder="Title (optional)"]' },
        ],
        { intent: 'title input field inside the note composer' },
      )
      .resolve();
  }

  /** Fills the title input in the composer. */
  async fillTitle(title: string): Promise<void> {
    await this.page.fill(
      title,
      [
        { type: 'testId', value: 'notes-composer-title' },
        { type: 'css', value: 'input[placeholder="Title (optional)"]' },
      ],
      { intent: 'title input field inside the note composer' },
    );
  }

  /** Returns the composer body editor container. */
  async composerBodyLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'notes-composer-body' },
          { type: 'css', value: '[data-testid="notes-composer-body"]' },
        ],
        { intent: 'rich text editor body area in the note composer' },
      )
      .resolve();
  }

  /**
   * Types text into the ProseMirror editor body.
   * Uses the contenteditable descendant of the composer body wrapper.
   */
  async typeBody(text: string): Promise<void> {
    await this.page.fill(
      text,
      [
        { type: 'css', value: '[data-testid="notes-composer-body"] [contenteditable="true"]' },
        { type: 'css', value: '[data-testid="notes-composer"] [contenteditable="true"]' },
      ],
      { intent: 'contenteditable area inside the note composer body' },
    );
  }

  /** Returns the visibility select inside the composer. */
  async visibilitySelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'notes-visibility-select' },
          { type: 'css', value: 'select[data-testid="notes-visibility-select"]' },
        ],
        { intent: 'visibility selector dropdown inside the note composer' },
      )
      .resolve();
  }

  /** Selects a visibility option in the composer. */
  async selectVisibility(value: 'private' | 'team' | 'public'): Promise<void> {
    const select = await this.visibilitySelectLocator();
    await select.selectOption(value);
  }

  /** Adds a tag via the tag input (press Enter after each). */
  async addTag(tag: string): Promise<void> {
    await this.page.fill(
      tag,
      [
        { type: 'testId', value: 'notes-tag-input' },
        { type: 'css', value: '[data-testid="notes-tag-input"]' },
      ],
      { intent: 'tag input field in the note composer' },
    );
    const input = await this.page
      .locate(
        [
          { type: 'testId', value: 'notes-tag-input' },
          { type: 'css', value: '[data-testid="notes-tag-input"]' },
        ],
        { intent: 'tag input field in the note composer' },
      )
      .resolve();
    await input.press('Enter');
  }

  /** Clicks Save in the composer. */
  async clickSave(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'notes-composer-save' },
        { type: 'role', value: 'button', options: { name: /save note/i } },
      ],
      { intent: 'save note button to submit the composer' },
    );
  }

  /** Clicks Cancel in the composer. */
  async clickCancel(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'notes-composer-cancel' },
        { type: 'role', value: 'button', options: { name: /cancel/i } },
      ],
      { intent: 'cancel button to close the note composer' },
    );
  }

  /** Returns the empty state element. Null if not present. */
  async emptyStateLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'notes-empty' },
          { type: 'css', value: '[data-testid="notes-empty"]' },
        ],
        { intent: 'empty state message when no notes exist' },
      )
      .resolve()
      .catch(() => null);
  }

  /** Returns the notes list container. Null if not present. */
  async notesListLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'notes-list' },
          { type: 'css', value: '[data-testid="notes-list"]' },
        ],
        { intent: 'container holding the list of rendered note cards' },
      )
      .resolve()
      .catch(() => null);
  }

  /** Returns the card for a specific note by ID. */
  async noteCardLocator(noteId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `note-card-${noteId}` },
          { type: 'css', value: `[data-testid="note-card-${noteId}"]` },
        ],
        { intent: `note card for note ID ${noteId}` },
      )
      .resolve()
      .catch(() => null);
  }

  /** Returns the masked placeholder card for a private note from another user. */
  async maskedNoteCardLocator(noteId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `note-card-masked-${noteId}` },
          { type: 'css', value: `[data-testid="note-card-masked-${noteId}"]` },
        ],
        { intent: `masked placeholder card for private note ID ${noteId}` },
      )
      .resolve()
      .catch(() => null);
  }

  /** Returns the title element inside a note card. */
  async noteTitleLocator(noteId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `note-title-${noteId}` },
          { type: 'css', value: `[data-testid="note-title-${noteId}"]` },
        ],
        { intent: `title heading inside note card ${noteId}` },
      )
      .resolve()
      .catch(() => null);
  }

  /** Returns the body content element inside a note card. */
  async noteBodyLocator(noteId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `note-body-${noteId}` },
          { type: 'css', value: `[data-testid="note-body-${noteId}"]` },
        ],
        { intent: `rich text body content inside note card ${noteId}` },
      )
      .resolve()
      .catch(() => null);
  }

  /** Clicks the Edit button on a specific note card. */
  async clickEditNote(noteId: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `note-edit-${noteId}` },
        { type: 'css', value: `[data-testid="note-edit-${noteId}"]` },
      ],
      { intent: `edit button on note card ${noteId}` },
    );
  }

  /** Clicks the Delete button on a specific note card. */
  async clickDeleteNote(noteId: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `note-delete-${noteId}` },
        { type: 'css', value: `[data-testid="note-delete-${noteId}"]` },
      ],
      { intent: `delete button on note card ${noteId}` },
    );
  }

  /** Clicks the Confirm button in the delete confirmation modal. */
  async confirmDelete(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'confirm-delete-confirm' },
        { type: 'role', value: 'button', options: { name: /confirm|delete/i } },
      ],
      { intent: 'confirm button in the note delete confirmation modal' },
    );
  }

  /** Clicks the Cancel button in the delete confirmation modal. */
  async cancelDelete(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'confirm-delete-cancel' },
        { type: 'role', value: 'button', options: { name: /cancel/i } },
      ],
      { intent: 'cancel button in the note delete confirmation modal' },
    );
  }
}
