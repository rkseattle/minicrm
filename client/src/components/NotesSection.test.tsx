/**
 * Tests for NotesSection component. (MINCRM-352)
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import { ADMIN_USER, REP_USER } from '@/test/msw/handlers.js';
import NotesSection from './NotesSection.js';
import type { NoteResponse } from '@shared/schemas/noteSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';

const CONTACT_ID = '00000000-0000-0000-0000-000000000101';
const NOTE_ID_1 = '00000000-0000-0000-0000-000000000b01';
const NOTE_ID_2 = '00000000-0000-0000-0000-000000000b02';
const NOTE_ID_PRIVATE = '00000000-0000-0000-0000-000000000b03';

const BODY_JSON = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
});

const NOTE_1: NoteResponse = {
  id: NOTE_ID_1,
  entity_type: 'contact',
  entity_id: CONTACT_ID,
  title: 'First note',
  body: BODY_JSON,
  body_text: 'Hello world',
  visibility: 'team',
  tags: ['important', 'followup'],
  created_by: ADMIN_USER.id,
  created_by_name: ADMIN_USER.name,
  updated_by: null,
  updated_by_name: null,
  created_at: new Date(Date.now() - 30 * 60_000).toISOString(), // 30 min ago
  updated_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  is_masked: false,
};

const NOTE_2: NoteResponse = {
  id: NOTE_ID_2,
  entity_type: 'contact',
  entity_id: CONTACT_ID,
  title: null,
  body: BODY_JSON,
  body_text: 'Hello world',
  visibility: 'public',
  tags: [],
  created_by: REP_USER.id,
  created_by_name: REP_USER.name,
  updated_by: null,
  updated_by_name: null,
  created_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(), // 2h ago
  updated_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  is_masked: false,
};

/** A private note from another user — body/title are null and is_masked is true */
const NOTE_PRIVATE: NoteResponse = {
  id: NOTE_ID_PRIVATE,
  entity_type: 'contact',
  entity_id: CONTACT_ID,
  title: null,
  body: null,
  body_text: null,
  visibility: 'private',
  tags: [],
  created_by: REP_USER.id,
  created_by_name: REP_USER.name,
  updated_by: null,
  updated_by_name: null,
  created_at: new Date(Date.now() - 60_000).toISOString(),
  updated_at: new Date(Date.now() - 60_000).toISOString(),
  is_masked: true,
};

function paginatedResponse(data: NoteResponse[], total?: number): PaginatedResponse<NoteResponse> {
  return { data, total: total ?? data.length, page: 1, limit: 10 };
}

/** Registers the list notes handler. Defaults to returning an empty list. */
function withNotes(notes: NoteResponse[] = []) {
  server.use(
    http.get(`/api/v1/contact/${CONTACT_ID}/notes`, () =>
      HttpResponse.json(paginatedResponse(notes)),
    ),
  );
}

/** Registers the list notes handler to return a server error. */
function withNotesError() {
  server.use(
    http.get(`/api/v1/contact/${CONTACT_ID}/notes`, () =>
      HttpResponse.json({ error: { code: 'SERVER_ERROR', message: 'Failed' } }, { status: 500 }),
    ),
  );
}

// ── Loading / async states ─────────────────────────────────────────────────────

describe('NotesSection — async states', () => {
  it('shows a loading skeleton while the request is in flight', () => {
    server.use(
      http.get(`/api/v1/contact/${CONTACT_ID}/notes`, async () => {
        // Never resolves during this test — we inspect the pending state
        await new Promise(() => {});
        return HttpResponse.json(paginatedResponse([]));
      }),
    );
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    expect(screen.getByTestId('notes-loading')).toBeInTheDocument();
  });

  it('shows the error state when the list request fails', async () => {
    withNotesError();
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('notes-load-error')).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no notes', async () => {
    withNotes([]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('notes-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('notes-list')).not.toBeInTheDocument();
  });
});

// ── Notes list rendering ───────────────────────────────────────────────────────

describe('NotesSection — notes list', () => {
  it('renders a card for each visible note', async () => {
    withNotes([NOTE_1, NOTE_2]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId(`note-card-${NOTE_ID_1}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`note-card-${NOTE_ID_2}`)).toBeInTheDocument();
  });

  it('renders a note title when present', async () => {
    withNotes([NOTE_1]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId(`note-title-${NOTE_ID_1}`)).toHaveTextContent('First note');
    });
  });

  it('renders tag chips on the note card', async () => {
    withNotes([NOTE_1]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('note-tag-display-important')).toBeInTheDocument();
    });
    expect(screen.getByTestId('note-tag-display-followup')).toBeInTheDocument();
  });

  it('renders the masked placeholder for a private note from another user', async () => {
    withNotes([NOTE_PRIVATE]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId(`note-card-masked-${NOTE_ID_PRIVATE}`)).toBeInTheDocument();
    });
    // Body element must not exist for a masked note
    expect(screen.queryByTestId(`note-body-${NOTE_ID_PRIVATE}`)).not.toBeInTheDocument();
  });

  it('shows edit/delete buttons for notes owned by the current user (admin)', async () => {
    // Default MSW auth handler returns ADMIN_USER; NOTE_1.created_by === ADMIN_USER.id
    withNotes([NOTE_1]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId(`note-edit-${NOTE_ID_1}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`note-delete-${NOTE_ID_1}`)).toBeInTheDocument();
  });

  it('hides edit/delete buttons for notes owned by another user (non-admin)', async () => {
    // Make the auth endpoint return the rep user
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })));
    // NOTE_1 is owned by ADMIN_USER — the rep cannot edit it
    withNotes([NOTE_1]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId(`note-card-${NOTE_ID_1}`)).toBeInTheDocument();
    });
    expect(screen.queryByTestId(`note-edit-${NOTE_ID_1}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`note-delete-${NOTE_ID_1}`)).not.toBeInTheDocument();
  });

  it('admin sees edit/delete buttons on notes they do not own', async () => {
    // ADMIN_USER is the default auth user; NOTE_2 is owned by REP_USER
    withNotes([NOTE_2]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId(`note-edit-${NOTE_ID_2}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`note-delete-${NOTE_ID_2}`)).toBeInTheDocument();
  });
});

// ── Add note composer ──────────────────────────────────────────────────────────

describe('NotesSection — composer open/close', () => {
  it('opens the inline composer when the Add Note button is clicked', async () => {
    withNotes([]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('notes-empty')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('notes-add-button'));
    expect(screen.getByTestId('notes-composer')).toBeInTheDocument();
    // Add button hides while composer is open
    expect(screen.queryByTestId('notes-add-button')).not.toBeInTheDocument();
  });

  it('closes the composer and restores the Add Note button on cancel', async () => {
    withNotes([]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => expect(screen.getByTestId('notes-add-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('notes-add-button'));
    expect(screen.getByTestId('notes-composer')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('notes-composer-cancel'));

    expect(screen.queryByTestId('notes-composer')).not.toBeInTheDocument();
    expect(screen.getByTestId('notes-add-button')).toBeInTheDocument();
  });
});

// ── Save note ──────────────────────────────────────────────────────────────────

describe('NotesSection — save note', () => {
  it('calls POST and refreshes the list after a successful save', async () => {
    withNotes([]);
    server.use(
      http.post(`/api/v1/contact/${CONTACT_ID}/notes`, () =>
        HttpResponse.json({ note: NOTE_1 }, { status: 201 }),
      ),
    );
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => expect(screen.getByTestId('notes-empty')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('notes-add-button'));

    // Set up the refetch to return the newly created note
    server.use(
      http.get(`/api/v1/contact/${CONTACT_ID}/notes`, () =>
        HttpResponse.json(paginatedResponse([NOTE_1])),
      ),
    );

    fireEvent.click(screen.getByTestId('notes-composer-save'));

    await waitFor(() => {
      expect(screen.getByTestId(`note-card-${NOTE_ID_1}`)).toBeInTheDocument();
    });
    // Composer closes after successful save
    expect(screen.queryByTestId('notes-composer')).not.toBeInTheDocument();
  });

  it('shows a save error when the POST fails', async () => {
    withNotes([]);
    server.use(
      http.post(`/api/v1/contact/${CONTACT_ID}/notes`, () =>
        HttpResponse.json({ error: { code: 'SERVER_ERROR', message: 'Failed' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => expect(screen.getByTestId('notes-empty')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('notes-add-button'));
    fireEvent.click(screen.getByTestId('notes-composer-save'));

    await waitFor(() => {
      expect(screen.getByTestId('notes-save-error')).toBeInTheDocument();
    });
  });
});

// ── Visibility selector ────────────────────────────────────────────────────────

describe('NotesSection — visibility selector', () => {
  it('renders the visibility selector with default value "team"', async () => {
    withNotes([]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => expect(screen.getByTestId('notes-empty')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('notes-add-button'));

    const select = screen.getByTestId('notes-visibility-select') as HTMLSelectElement;
    expect(select.value).toBe('team');
  });

  it('updates the visibility when the user changes the selector', async () => {
    withNotes([]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => expect(screen.getByTestId('notes-empty')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('notes-add-button'));

    const select = screen.getByTestId('notes-visibility-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'private' } });
    expect(select.value).toBe('private');
  });
});

// ── Tag input ──────────────────────────────────────────────────────────────────

describe('NotesSection — tag input', () => {
  it('adds a tag when Enter is pressed in the tag input', async () => {
    withNotes([]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => expect(screen.getByTestId('notes-empty')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('notes-add-button'));

    const tagInput = screen.getByTestId('notes-tag-input');
    fireEvent.change(tagInput, { target: { value: 'urgent' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    expect(screen.getByTestId('note-tag-urgent')).toBeInTheDocument();
    // Input clears after adding
    expect((tagInput as HTMLInputElement).value).toBe('');
  });

  it('adds a tag when a comma is typed', async () => {
    withNotes([]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => expect(screen.getByTestId('notes-empty')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('notes-add-button'));

    const tagInput = screen.getByTestId('notes-tag-input');
    fireEvent.change(tagInput, { target: { value: 'beta' } });
    fireEvent.keyDown(tagInput, { key: ',' });

    expect(screen.getByTestId('note-tag-beta')).toBeInTheDocument();
  });

  it('removes a tag when its × button is clicked', async () => {
    withNotes([]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => expect(screen.getByTestId('notes-empty')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('notes-add-button'));

    const tagInput = screen.getByTestId('notes-tag-input');
    fireEvent.change(tagInput, { target: { value: 'removeme' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    expect(screen.getByTestId('note-tag-removeme')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('note-tag-remove-removeme'));
    expect(screen.queryByTestId('note-tag-removeme')).not.toBeInTheDocument();
  });

  it('removes the last tag on Backspace when the input is empty', async () => {
    withNotes([]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => expect(screen.getByTestId('notes-empty')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('notes-add-button'));

    const tagInput = screen.getByTestId('notes-tag-input');
    fireEvent.change(tagInput, { target: { value: 'first' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    expect(screen.getByTestId('note-tag-first')).toBeInTheDocument();

    // Input is now empty — Backspace should remove the last tag
    fireEvent.keyDown(tagInput, { key: 'Backspace' });
    expect(screen.queryByTestId('note-tag-first')).not.toBeInTheDocument();
  });
});

// ── Edit note ──────────────────────────────────────────────────────────────────

describe('NotesSection — edit note', () => {
  it('opens the inline composer with existing note data when Edit is clicked', async () => {
    withNotes([NOTE_1]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId(`note-edit-${NOTE_ID_1}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`note-edit-${NOTE_ID_1}`));

    // Composer opens pre-filled with the note's title
    const titleInput = screen.getByTestId('notes-composer-title') as HTMLInputElement;
    expect(titleInput.value).toBe('First note');
  });

  it('calls PATCH and refreshes the list after a successful edit', async () => {
    withNotes([NOTE_1]);
    const updatedNote: NoteResponse = { ...NOTE_1, title: 'Updated title' };
    server.use(
      http.patch(`/api/v1/contact/${CONTACT_ID}/notes/${NOTE_ID_1}`, () =>
        HttpResponse.json({ note: updatedNote }),
      ),
    );
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId(`note-edit-${NOTE_ID_1}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`note-edit-${NOTE_ID_1}`));

    // Update the title input
    const titleInput = screen.getByTestId('notes-composer-title');
    fireEvent.change(titleInput, { target: { value: 'Updated title' } });

    // Set up refetch to return updated note
    server.use(
      http.get(`/api/v1/contact/${CONTACT_ID}/notes`, () =>
        HttpResponse.json(paginatedResponse([updatedNote])),
      ),
    );

    fireEvent.click(screen.getByTestId('notes-composer-save'));

    await waitFor(() => {
      expect(screen.getByTestId(`note-title-${NOTE_ID_1}`)).toHaveTextContent('Updated title');
    });
    expect(screen.queryByTestId('notes-composer')).not.toBeInTheDocument();
  });
});

// ── Delete note ────────────────────────────────────────────────────────────────

describe('NotesSection — delete note', () => {
  it('opens the confirmation modal when Delete is clicked', async () => {
    withNotes([NOTE_1]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId(`note-delete-${NOTE_ID_1}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`note-delete-${NOTE_ID_1}`));

    // ConfirmDeleteModal renders with its confirm/cancel buttons
    expect(screen.getByTestId('confirm-delete-modal')).toBeInTheDocument();
  });

  it('closes the modal on cancel', async () => {
    withNotes([NOTE_1]);
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      fireEvent.click(screen.getByTestId(`note-delete-${NOTE_ID_1}`));
    });

    fireEvent.click(screen.getByTestId('confirm-delete-cancel'));
    expect(screen.queryByTestId('confirm-delete-modal')).not.toBeInTheDocument();
  });

  it('calls DELETE and removes the note from the list on confirm', async () => {
    withNotes([NOTE_1]);
    server.use(
      http.delete(
        `/api/v1/contact/${CONTACT_ID}/notes/${NOTE_ID_1}`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      fireEvent.click(screen.getByTestId(`note-delete-${NOTE_ID_1}`));
    });

    // After delete, refetch returns empty list
    server.use(
      http.get(`/api/v1/contact/${CONTACT_ID}/notes`, () =>
        HttpResponse.json(paginatedResponse([])),
      ),
    );

    fireEvent.click(screen.getByTestId('confirm-delete-confirm'));

    await waitFor(() => {
      expect(screen.queryByTestId('confirm-delete-modal')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('notes-empty')).toBeInTheDocument();
    });
  });

  it('shows a delete error when the DELETE request fails', async () => {
    withNotes([NOTE_1]);
    server.use(
      http.delete(`/api/v1/contact/${CONTACT_ID}/notes/${NOTE_ID_1}`, () =>
        HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, { status: 403 }),
      ),
    );
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => {
      fireEvent.click(screen.getByTestId(`note-delete-${NOTE_ID_1}`));
    });

    fireEvent.click(screen.getByTestId('confirm-delete-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('notes-delete-error')).toBeInTheDocument();
    });
  });
});

// ── Image upload errors ────────────────────────────────────────────────────────

describe('NotesSection — image upload errors', () => {
  it('shows a generic error message when image upload fails', async () => {
    withNotes([]);
    server.use(
      http.post('/api/v1/attachments', () =>
        HttpResponse.json(
          { error: { code: 'STORAGE_ERROR', message: 'Storage unavailable' } },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => expect(screen.getByTestId('notes-add-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('notes-add-button'));

    const fileInput = screen.getByTestId('notes-image-input');
    const file = new File(['data'], 'photo.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('notes-image-upload-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('notes-image-upload-error').textContent).not.toMatch(/25 MB/);
  });

  it('shows a size-specific error message when the server returns 413', async () => {
    withNotes([]);
    server.use(http.post('/api/v1/attachments', () => new HttpResponse(null, { status: 413 })));
    renderWithProviders(<NotesSection entityType="contact" entityId={CONTACT_ID} />);

    await waitFor(() => expect(screen.getByTestId('notes-add-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('notes-add-button'));

    const fileInput = screen.getByTestId('notes-image-input');
    const file = new File(['data'], 'huge.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('notes-image-upload-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('notes-image-upload-error').textContent).toMatch(/25 MB/);
  });
});
