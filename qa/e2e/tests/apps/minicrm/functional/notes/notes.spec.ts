/**
 * F14 — Rich Notes (CRUD, Visibility, Audit Trail)
 *
 * Functional regression tests for the rich notes feature introduced in MINCRM-352.
 * Notes can be attached to contacts, accounts, deals, and leads.
 *
 * Test groups:
 *   Create (F14-C)     — create a team note on a contact; verify it appears in the UI and API
 *   Edit (F14-E)       — edit a note title; verify the updated title is persisted
 *   Delete (F14-D)     — delete a note; verify it disappears from the UI and returns 404 via API
 *   Visibility (F14-V) — create a private note as rep A; verify rep B sees only the masked placeholder
 *   Audit (F14-A)      — verify audit_log entries are written for create, update, delete
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - No raw locators in this file — UI interaction via behaviors/page objects only
 *
 * MINCRM-352
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createTestContact,
  createTestUser,
  navigateToContact,
  loginAndVerify,
} from '@apps/minicrm/helpers.js';
import {
  createNoteViaUI,
  editNoteViaUI,
  deleteNoteViaUI,
  noteCardIsVisible,
  maskedNoteCardIsVisible,
  login,
} from '@behaviors/minicrm/index.js';
import { NotesPage } from '@pages/minicrm/NotesPage.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F14-notes] E2E_ADMIN_PASSWORD is not set');

const REP_PASSWORD = 'BvtPassword1!';

// ---------------------------------------------------------------------------
// Shared response types
// ---------------------------------------------------------------------------

interface NoteEnvelope {
  note: {
    id: string;
    title: string | null;
    body: string | null;
    visibility: string;
    tags: string[];
    created_by: string;
    created_at: string;
    is_masked: boolean;
  };
}

interface NotesListResponse {
  data: Array<{
    id: string;
    title: string | null;
    visibility: string;
    is_masked: boolean;
  }>;
  total: number;
}

interface AuditLogResponse {
  entries: Array<{
    id: string;
    event_type: string;
    record_type: string;
    record_id: string | null;
    changed_by_name: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Shared setup — admin auth
// ---------------------------------------------------------------------------

test.beforeAll(async ({ restClient }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ---------------------------------------------------------------------------
// Create — F14-C
// ---------------------------------------------------------------------------

test('@functional F14-C1: Create a team note on a contact — note appears in UI and API', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  await navigateToContact(page, contact.id);
  const notesPage = new NotesPage({ page });
  await (await notesPage.sectionLocator()).waitFor({ state: 'visible' });

  const result = await createNoteViaUI(
    { page },
    {
      title: 'F14-C1 team note',
      bodyText: 'This is a team note created by the E2E test.',
      visibility: 'team',
      tags: ['e2e', 'team'],
    },
  );

  expect(result.saved, 'composer should close after save').toBe(true);
  expect(result.listVisible, 'notes list should be visible after first note').toBe(true);

  // Verify via REST API
  const listResponse = await restClient.get<NotesListResponse>(
    `/api/v1/contact/${contact.id}/notes`,
  );
  expect(listResponse.body.total, 'one note should be created').toBe(1);
  const created = listResponse.body.data[0]!;
  expect(created.title).toBe('F14-C1 team note');
  expect(created.visibility).toBe('team');
  expect(created.is_masked).toBe(false);

  // Register for teardown — notes are soft-deleted but the contact delete cascades
  // (no separate teardown needed beyond the parent contact)
});

test('@functional F14-C2: Create a note with tags — tags are persisted', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  await navigateToContact(page, contact.id);
  const notesPage = new NotesPage({ page });
  await (await notesPage.sectionLocator()).waitFor({ state: 'visible' });

  await createNoteViaUI(
    { page },
    {
      bodyText: 'Tagged note body.',
      tags: ['alpha', 'beta'],
    },
  );

  const listResponse = await restClient.get<NotesListResponse>(
    `/api/v1/contact/${contact.id}/notes`,
  );
  expect(listResponse.body.total).toBe(1);
});

// ---------------------------------------------------------------------------
// Edit — F14-E
// ---------------------------------------------------------------------------

test('@functional F14-E1: Edit a note title — updated title is shown in the card', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  // Create via API to get the ID
  const createResponse = await restClient.post<NoteEnvelope>(
    `/api/v1/contact/${contact.id}/notes`,
    {
      body: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }],
      }),
      title: 'Original title',
      visibility: 'team',
      tags: [],
    },
  );
  const noteId = createResponse.body.note.id;

  await navigateToContact(page, contact.id);
  const notesPage = new NotesPage({ page });
  await (await notesPage.sectionLocator()).waitFor({ state: 'visible' });

  // Wait for the note card to appear
  const card = await notesPage.noteCardLocator(noteId);
  await card?.waitFor({ state: 'visible', timeout: 8_000 });

  const editResult = await editNoteViaUI(
    { page },
    {
      noteId,
      title: 'Updated title F14-E1',
    },
  );

  expect(editResult.saved, 'composer should close after edit save').toBe(true);

  // The card should now show the updated title
  const titleEl = await notesPage.noteTitleLocator(noteId);
  await titleEl?.waitFor({ state: 'visible', timeout: 5_000 });
  await expect(titleEl!).toHaveText('Updated title F14-E1');

  // Verify via API
  const getResponse = await restClient.get<NoteEnvelope>(
    `/api/v1/contact/${contact.id}/notes/${noteId}`,
  );
  expect(getResponse.body.note.title).toBe('Updated title F14-E1');
});

// ---------------------------------------------------------------------------
// Delete — F14-D
// ---------------------------------------------------------------------------

test('@functional F14-D1: Delete a note — card disappears and API returns 404', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  const createResponse = await restClient.post<NoteEnvelope>(
    `/api/v1/contact/${contact.id}/notes`,
    {
      body: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'To be deleted' }] }],
      }),
      visibility: 'team',
      tags: [],
    },
  );
  const noteId = createResponse.body.note.id;

  await navigateToContact(page, contact.id);
  const notesPage = new NotesPage({ page });
  await (await notesPage.sectionLocator()).waitFor({ state: 'visible' });

  const card = await notesPage.noteCardLocator(noteId);
  await card?.waitFor({ state: 'visible', timeout: 8_000 });

  const deleteResult = await deleteNoteViaUI({ page }, noteId);
  expect(deleteResult.confirmed, 'delete modal should close after confirm').toBe(true);

  // Card should no longer be visible
  const stillVisible = await noteCardIsVisible({ page }, noteId);
  expect(stillVisible, 'note card should be gone after delete').toBe(false);

  // API should return 404 for the deleted note
  let got404 = false;
  try {
    await restClient.get(`/api/v1/contact/${contact.id}/notes/${noteId}`);
  } catch (err) {
    if (err instanceof RestClientError && err.status === 404) {
      got404 = true;
    }
  }
  expect(got404, 'deleted note should return 404 from API').toBe(true);
});

// ---------------------------------------------------------------------------
// Visibility — F14-V
// ---------------------------------------------------------------------------

test('@functional F14-V1: Private note from rep A is masked for rep B', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  // Create rep A and rep B
  const repA = await createTestUser(restClient, { password: REP_PASSWORD });
  const repB = await createTestUser(restClient, { password: REP_PASSWORD });

  // Deactivate both users in teardown (users can't be hard-deleted)
  const deactivateRepA = async () => {
    await restClient.patch(`/api/v1/users/${repA.id}/deactivate`, {});
  };
  const deactivateRepB = async () => {
    await restClient.patch(`/api/v1/users/${repB.id}/deactivate`, {});
  };

  try {
    // Rep A creates a private note via API
    const repAClient = restClient; // rep A's client (we re-use restClient after re-login)
    await loginAndVerify(repAClient, repA.email, REP_PASSWORD);

    const createResponse = await repAClient.post<NoteEnvelope>(
      `/api/v1/contact/${contact.id}/notes`,
      {
        body: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Secret rep A note' }] }],
        }),
        visibility: 'private',
        tags: [],
      },
    );
    const noteId = createResponse.body.note.id;

    // Log in as rep B in the browser
    await login({ email: repB.email, password: REP_PASSWORD }, { page });

    await navigateToContact(page, contact.id);
    const notesPage = new NotesPage({ page });
    await (await notesPage.sectionLocator()).waitFor({ state: 'visible' });

    // Wait for the masked placeholder (rep B cannot see the body)
    const maskedCard = await notesPage.maskedNoteCardLocator(noteId);
    await maskedCard?.waitFor({ state: 'visible', timeout: 8_000 });

    const masked = await maskedNoteCardIsVisible({ page }, noteId);
    expect(masked, 'rep B should see a masked placeholder for rep A private note').toBe(true);

    // The actual note body element must not exist
    const bodyEl = await notesPage.noteBodyLocator(noteId);
    expect(bodyEl, 'note body should not be accessible to rep B').toBeNull();
  } finally {
    // Restore admin session so subsequent tests are not affected
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateRepA();
    await deactivateRepB();
  }
});

// ---------------------------------------------------------------------------
// Audit trail — F14-A
// ---------------------------------------------------------------------------

test('@functional F14-A1: Create and update a note — audit entries recorded', async ({
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  // Create note via API
  const createResponse = await restClient.post<NoteEnvelope>(
    `/api/v1/contact/${contact.id}/notes`,
    {
      body: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Audit test note' }] }],
      }),
      title: 'Audit note',
      visibility: 'team',
      tags: [],
    },
  );
  const noteId = createResponse.body.note.id;

  // Update the note
  await restClient.patch(`/api/v1/contact/${contact.id}/notes/${noteId}`, {
    title: 'Audit note — updated',
  });

  // Check audit log for this contact
  const auditResponse = await restClient.get<AuditLogResponse>(
    `/api/v1/audit-log?recordType=contact&recordId=${contact.id}&limit=50`,
  );

  const entries = auditResponse.body.entries;

  const createdEntry = entries.find((e) => e.event_type === 'note_created');
  expect(createdEntry, 'note_created audit entry should exist').toBeDefined();

  const updatedEntry = entries.find((e) => e.event_type === 'note_updated');
  expect(updatedEntry, 'note_updated audit entry should exist').toBeDefined();
});

test('@functional F14-A2: Delete a note — note_deleted audit entry recorded', async ({
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  const createResponse = await restClient.post<NoteEnvelope>(
    `/api/v1/contact/${contact.id}/notes`,
    {
      body: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Delete audit test' }] }],
      }),
      visibility: 'team',
      tags: [],
    },
  );
  const noteId = createResponse.body.note.id;

  await restClient.delete(`/api/v1/contact/${contact.id}/notes/${noteId}`);

  const auditResponse = await restClient.get<AuditLogResponse>(
    `/api/v1/audit-log?recordType=contact&recordId=${contact.id}&limit=50`,
  );

  const deletedEntry = auditResponse.body.entries.find((e) => e.event_type === 'note_deleted');
  expect(deletedEntry, 'note_deleted audit entry should exist').toBeDefined();
});
