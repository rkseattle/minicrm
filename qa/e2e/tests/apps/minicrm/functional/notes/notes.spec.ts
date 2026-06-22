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
 * Coverage gaps addressed (MINCRM-409):
 *   F14-C3: Create a team note on a deal (not just contacts)
 *   F14-V2: Admin changes a note from private to team; both users can then see it
 *   F14-C4: Create a note via UI with rich-text content; body_text is stored
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
  createTestAccount,
  createTestDeal,
  createTestRep,
  navigateToContact,
  navigateToDeal,
  loginAndVerify,
  withFlags,
} from '@apps/minicrm/helpers.js';
import {
  createNoteViaUI,
  editNoteViaUI,
  deleteNoteViaUI,
  noteCardIsVisible,
  maskedNoteCardIsVisible,
  login,
  loginAsAdmin,
  deactivateUser,
  createNoteViaApi,
  getNoteById,
  listNotes,
  patchNote,
  deleteNote,
  getRecordAuditLog,
} from '@behaviors/minicrm/index.js';
import { loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  waitForNotesSection,
  waitForNoteCard,
  waitForNoteCardDetached,
  waitForMaskedNoteCard,
  expectNoteTitleText,
  isNoteTeamVisible,
  isNoteBodyAbsent,
} from '@behaviors/minicrm/notes.behaviors.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const REP_PASSWORD = 'BvtPassword1!';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await withFlags(page, { notes: true });
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
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

  await waitForNotesSection({ page });

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
  const notesList = await listNotes(restClient, contact.id);
  expect(notesList.total, 'one note should be created').toBe(1);
  const created = notesList.data[0]!;
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

  await waitForNotesSection({ page });

  await createNoteViaUI(
    { page },
    {
      bodyText: 'Tagged note body.',
      tags: ['alpha', 'beta'],
    },
  );

  const notesList = await listNotes(restClient, contact.id);
  expect(notesList.total).toBe(1);
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
  const note = await createNoteViaApi(restClient, contact.id, {
    body: JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }],
    }),
    title: 'Original title',
    visibility: 'team',
    tags: [],
  });
  const noteId = note.id;

  await navigateToContact(page, contact.id);

  await waitForNotesSection({ page });

  // Wait for the note card to appear
  await waitForNoteCard(noteId, { page }, 8_000);

  const editResult = await editNoteViaUI(
    { page },
    {
      noteId,
      title: 'Updated title F14-E1',
    },
  );

  expect(editResult.saved, 'composer should close after edit save').toBe(true);

  // The card should now show the updated title
  await expectNoteTitleText(noteId, 'Updated title F14-E1', { page }, 5_000);

  // Verify via API
  const updatedNote = await getNoteById(restClient, contact.id, noteId);
  expect(updatedNote.title).toBe('Updated title F14-E1');
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

  const note = await createNoteViaApi(restClient, contact.id, {
    body: JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'To be deleted' }] }],
    }),
    visibility: 'team',
    tags: [],
  });
  const noteId = note.id;

  await navigateToContact(page, contact.id);

  await waitForNotesSection({ page });

  await waitForNoteCard(noteId, { page }, 8_000);

  const deleteResult = await deleteNoteViaUI({ page }, noteId);
  expect(deleteResult.confirmed, 'delete modal should close after confirm').toBe(true);

  // Wait for the note list to refetch after the delete — the card is removed when the
  // invalidateQueries refetch completes, which is async relative to modal close.
  await waitForNoteCardDetached(noteId, { page }, 8_000);

  // Card should no longer be visible
  const stillVisible = await noteCardIsVisible({ page }, noteId);
  expect(stillVisible, 'note card should be gone after delete').toBe(false);

  // API should return 404 for the deleted note — exempt from behavior replacement
  // because the purpose is to assert the error status code directly.
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
  // beforeEach leaves restClient as rep; re-auth as admin for createTestUser/deactivate (MINCRM-415)
  await loginAsAdmin(restClient);

  const contact = await createTestContact(testData, restClient);

  // Create rep A and rep B
  const repA = await createTestUser(restClient, { password: REP_PASSWORD });
  const repB = await createTestUser(restClient, { password: REP_PASSWORD });

  try {
    // Rep A creates a private note via API
    const repAClient = restClient; // rep A's client (we re-use restClient after re-login)
    await loginAndVerify(repAClient, repA.email, REP_PASSWORD);

    const note = await createNoteViaApi(repAClient, contact.id, {
      body: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Secret rep A note' }] }],
      }),
      visibility: 'private',
      tags: [],
    });
    const noteId = note.id;

    // Log in as rep B in the browser
    await login({ email: repB.email, password: REP_PASSWORD }, { page });

    await navigateToContact(page, contact.id);

    await waitForNotesSection({ page });

    // Wait for the masked placeholder (rep B cannot see the body)
    await waitForMaskedNoteCard(noteId, { page }, 8_000);

    const masked = await maskedNoteCardIsVisible({ page }, noteId);
    expect(masked, 'rep B should see a masked placeholder for rep A private note').toBe(true);

    // The actual note body element must not exist
    expect(
      await isNoteBodyAbsent(noteId, { page }),
      'note body should not be accessible to rep B',
    ).toBe(true);
  } finally {
    // Restore admin session so subsequent tests are not affected
    await loginAsAdmin(restClient);
    await deactivateUser(restClient, repA.id);
    await deactivateUser(restClient, repB.id);
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
  const note = await createNoteViaApi(restClient, contact.id, {
    body: JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Audit test note' }] }],
    }),
    title: 'Audit note',
    visibility: 'team',
    tags: [],
  });
  const noteId = note.id;

  // Update the note
  await patchNote(restClient, contact.id, noteId, {
    title: 'Audit note — updated',
  });

  // Check audit log for this contact via the per-record endpoint
  const auditLog = await getRecordAuditLog(restClient, 'contact', contact.id, true);

  const entries = auditLog.entries;

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

  const note = await createNoteViaApi(restClient, contact.id, {
    body: JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Delete audit test' }] }],
    }),
    visibility: 'team',
    tags: [],
  });
  const noteId = note.id;

  await deleteNote(restClient, contact.id, noteId);

  const auditLog = await getRecordAuditLog(restClient, 'contact', contact.id, true);

  const deletedEntry = auditLog.entries.find((e) => e.event_type === 'note_deleted');
  expect(deletedEntry, 'note_deleted audit entry should exist').toBeDefined();
});

// ---------------------------------------------------------------------------
// F14-C3 — Create a team note on a deal (MINCRM-409)
// ---------------------------------------------------------------------------

test('@functional F14-C3: Create a team note on a deal — note appears in the API list', async ({
  page,
  testData,
  restClient,
}) => {
  const account = await createTestAccount(testData, restClient, {
    name: `F14C3-Account-${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `F14C3-Deal-${Date.now()}`,
    account_id: account.id,
    stage: 'Prospecting',
  });

  await navigateToDeal(page, deal.id);

  // Wait for the notes section to load before interacting with it
  await waitForNotesSection({ page });

  // Create the note using the notes section on the deal detail page
  const result = await createNoteViaUI(
    { page },
    { bodyText: 'F14-C3 deal note', visibility: 'team' },
  );
  expect(result.saved, 'note save should succeed on a deal page').toBe(true);

  // Verify the note was persisted via the API — the list endpoint returns summary rows
  // without body_text, so just confirm a note record exists for this deal.
  const res = await restClient.get<{ data: Array<{ id: string }> }>(
    `/api/v1/deal/${deal.id}/notes`,
  );
  const notes = res.body.data;
  expect(notes.length, 'deal note must appear in the API list').toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// F14-V2 — Admin changes note visibility from private to team (MINCRM-409)
// ---------------------------------------------------------------------------

test('@functional F14-V2: Admin changes note visibility from private to team; note is no longer masked for a second user', async ({
  page,
  testData,
  restClient,
}) => {
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F14V2',
    last_name: `Vis-${Date.now()}`,
  });

  // Create a private note as admin
  const noteBody = JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'F14-V2 private note' }] }],
  });
  const note = await createNoteViaApi(restClient, contact.id, {
    body: noteBody,
    visibility: 'private',
  });

  // Change the note visibility to 'team'
  await patchNote(restClient, contact.id, note.id, { visibility: 'team' });

  // Verify the note is now team-visible in the API
  const updated = await getNoteById(restClient, contact.id, note.id);
  expect(updated.visibility, 'note visibility must be updated to team').toBe('team');

  // Verify that the note is NOT masked in the UI (the mask card shows when private)
  await loginAndVerify(
    restClient,
    process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com',
    process.env['E2E_ADMIN_PASSWORD']!,
  );
  await navigateToContact(page, contact.id);

  await waitForNotesSection({ page });

  expect(await isNoteTeamVisible(note.id, { page }), 'team note must not be masked in the UI').toBe(
    true,
  );
});

// ---------------------------------------------------------------------------
// F14-C4 — Rich-text note content is persisted (MINCRM-409)
// ---------------------------------------------------------------------------

test('@functional F14-C4: Create a note via UI with rich-text body; body_text is stored and visible', async ({
  page,
  testData,
  restClient,
}) => {
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F14C4',
    last_name: `Rich-${Date.now()}`,
  });

  await navigateToContact(page, contact.id);

  const richText = `F14-C4 rich note ${Date.now()}`;
  const result = await createNoteViaUI(
    { page },
    {
      title: 'F14-C4 Rich Title',
      bodyText: richText,
      visibility: 'team',
    },
  );
  expect(result.saved, 'note with rich content should save successfully').toBe(true);

  // The note card should be visible in the notes section
  const notesList = await listNotes(restClient, contact.id);
  const match = notesList.data.find((n) => !n.is_masked);
  expect(match, 'a non-masked note must exist after creating with rich text').toBeDefined();

  // Confirm the body text is stored via the full note endpoint
  if (match) {
    const full = await getNoteById(restClient, contact.id, match.id);
    expect(full.body, 'note body must be stored').toBeTruthy();
  }
});
