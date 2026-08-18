/**
 * F-AS — AI call/note summarizer on the Activity form
 *
 * Functional regression tests for the "Summarize" action on the activity
 * create form, embedded via ActivityTimeline on the contact detail page.
 *
 * Test groups:
 *   F-AS1 — Summarizing pasted text populates notes and appends action items on Apply
 *   F-AS2 — Dismissed suggested tasks are not created after Apply + Save
 *   F-AS3 — Accepted suggested tasks are created as linked Task activities after Save
 *   F-AS4 — The Summarize action is hidden when the ai_activity_summarizer flag is off
 *   F-AS5 — The Summarize action is hidden for Email activity type
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so summarizeActivityText bypasses the
 *   Anthropic SDK and returns a deterministic stub summary. No real tokens
 *   are consumed.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behaviours imported from @behaviors/* only — never @pages/*
 *   - Feature flag UI state controlled via withFlags() route interception only
 *   - Test data managed via restClient + TestDataManager (auto teardown)
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createTestContact,
  createTestRep,
  navigateToContact,
  withFlags,
} from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  summarizeActivityNotes,
  dismissSuggestedTask,
  applyActivitySummary,
  saveActivityForm,
  fillActivitySubject,
  expectActivityNotesToContain,
  isSummarizeButtonVisible,
  openActivityFormWithType,
  getActivities,
} from '@behaviors/minicrm/activities.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F-AS1 — Summarizing pasted text populates notes and appends action items
// ---------------------------------------------------------------------------

test(
  'F-AS1: summarizing pasted text populates notes with the summary and action items on Apply',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'AS1',
      last_name: `Contact ${Date.now()}`,
    });

    await navigateToContact(page, contact.id);

    const result = await summarizeActivityNotes('Call transcript: discussed renewal pricing.', {
      page,
    });
    expect(result.status).toBe(200);

    await applyActivitySummary({ page });
    await expectActivityNotesToContain('E2E stub', { page });
  },
);

// ---------------------------------------------------------------------------
// F-AS2 — Dismissed suggested tasks are not created after Apply + Save
// ---------------------------------------------------------------------------

test(
  'F-AS2: a dismissed suggested task is not created after Apply and Save',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'AS2',
      last_name: `Contact ${Date.now()}`,
    });

    await navigateToContact(page, contact.id);

    await summarizeActivityNotes('Call transcript: discussed renewal pricing.', { page });
    await dismissSuggestedTask(0, { page });
    await applyActivitySummary({ page });
    await fillActivitySubject('Renewal call', { page });
    await saveActivityForm({ page });

    const activities = await getActivities(restClient, { contact: contact.id });
    const tasks = activities.filter((a) => a.type === 'Task');
    expect(tasks).toHaveLength(0);
  },
);

// ---------------------------------------------------------------------------
// F-AS3 — Accepted suggested tasks are created as linked Task activities
// ---------------------------------------------------------------------------

test(
  'F-AS3: an accepted suggested task is created as a linked Task activity after Save',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'AS3',
      last_name: `Contact ${Date.now()}`,
    });

    await navigateToContact(page, contact.id);

    await summarizeActivityNotes('Call transcript: discussed renewal pricing.', { page });
    await applyActivitySummary({ page });
    await fillActivitySubject('Renewal call', { page });
    await saveActivityForm({ page });

    await expect(async () => {
      const activities = await getActivities(restClient, { contact: contact.id });
      const tasks = activities.filter((a) => a.type === 'Task');
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks[0]?.contact_id).toBe(contact.id);
    }).toPass({ timeout: 10_000 });
  },
);

// ---------------------------------------------------------------------------
// F-AS4 — Summarize action hidden when the flag is off
// ---------------------------------------------------------------------------

test(
  'F-AS4: the Summarize action is hidden when ai_activity_summarizer is off',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'AS4',
      last_name: `Contact ${Date.now()}`,
    });

    await withFlags(page, { ai_activity_summarizer: false });
    await navigateToContact(page, contact.id);

    expect(await isSummarizeButtonVisible({ page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F-AS5 — Summarize action hidden for Email activity type
// ---------------------------------------------------------------------------

test(
  'F-AS5: the Summarize action is hidden when the activity type is Email',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'AS5',
      last_name: `Contact ${Date.now()}`,
    });

    await navigateToContact(page, contact.id);
    await openActivityFormWithType('Email', { page });

    expect(await isSummarizeButtonVisible({ page })).toBe(false);
  },
);
