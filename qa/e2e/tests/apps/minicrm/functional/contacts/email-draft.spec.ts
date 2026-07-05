/**
 * F-ED — AI email draft generation from contact context (MINCRM-437)
 *
 * Functional regression tests for the on-demand "Draft Email" action on the
 * contact detail page.
 *
 * Test groups:
 *   F-ED1 — Drafting an email opens the panel with an editable subject and body
 *   F-ED2 — Changing the tone selector regenerates the draft
 *   F-ED3 — Copy to clipboard copies the subject and body
 *   F-ED4 — Dismissing the panel closes it without side effects
 *   F-ED5 — The Draft Email button is hidden when the ai_email_draft flag is off
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so generateEmailDraft bypasses the
 *   Anthropic SDK and returns a deterministic stub draft. No real tokens
 *   are consumed. (MINCRM-437)
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
  draftEmailFromContactDetail,
  isDraftEmailButtonVisible,
  getEmailDraftPanelValues,
  selectEmailDraftTone,
  copyEmailDraftToClipboard,
  readClipboardText,
  dismissEmailDraftPanel,
  isEmailDraftPanelVisible,
} from '@behaviors/minicrm/contacts.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F-ED1 — Drafting an email opens the panel with an editable subject and body
// ---------------------------------------------------------------------------

test(
  'F-ED1: drafting an email opens the panel with an editable subject and body',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'ED1',
      last_name: `Contact ${Date.now()}`,
    });

    await navigateToContact(page, contact.id);

    const result = await draftEmailFromContactDetail({ page });
    expect(result.status).toBe(200);

    expect(await isEmailDraftPanelVisible({ page })).toBe(true);
    const values = await getEmailDraftPanelValues({ page });
    expect(values.subject.length).toBeGreaterThan(0);
    expect(values.body.length).toBeGreaterThan(0);
  },
);

// ---------------------------------------------------------------------------
// F-ED2 — Changing the tone selector regenerates the draft
// ---------------------------------------------------------------------------

test(
  'F-ED2: changing the tone selector regenerates the draft',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'ED2',
      last_name: `Contact ${Date.now()}`,
    });

    await navigateToContact(page, contact.id);
    await draftEmailFromContactDetail({ page });

    const before = await getEmailDraftPanelValues({ page });
    await selectEmailDraftTone('Friendly', { page });

    await expect(async () => {
      const after = await getEmailDraftPanelValues({ page });
      expect(after.subject).not.toBe('');
      expect(after).not.toEqual(before);
    }).toPass({ timeout: 10_000 });
  },
);

// ---------------------------------------------------------------------------
// F-ED3 — Copy to clipboard copies the subject and body
// ---------------------------------------------------------------------------

test(
  'F-ED3: copy to clipboard copies the subject and body',
  { tag: ['@functional'] },
  async ({ testData, restClient, page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const contact = await createTestContact(testData, restClient, {
      first_name: 'ED3',
      last_name: `Contact ${Date.now()}`,
    });

    await navigateToContact(page, contact.id);
    await draftEmailFromContactDetail({ page });
    const values = await getEmailDraftPanelValues({ page });

    await copyEmailDraftToClipboard({ page });

    const clipboardText = await readClipboardText({ page });
    expect(clipboardText).toContain(values.subject);
    expect(clipboardText).toContain(values.body);
  },
);

// ---------------------------------------------------------------------------
// F-ED4 — Dismissing the panel closes it
// ---------------------------------------------------------------------------

test(
  'F-ED4: dismissing the panel closes it without side effects',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'ED4',
      last_name: `Contact ${Date.now()}`,
    });

    await navigateToContact(page, contact.id);
    await draftEmailFromContactDetail({ page });
    expect(await isEmailDraftPanelVisible({ page })).toBe(true);

    await dismissEmailDraftPanel({ page });

    expect(await isEmailDraftPanelVisible({ page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F-ED5 — Draft Email button hidden when the flag is off
// ---------------------------------------------------------------------------

test(
  'F-ED5: the Draft Email button is hidden when ai_email_draft is off',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'ED5',
      last_name: `Contact ${Date.now()}`,
    });

    await withFlags(page, { ai_email_draft: false });
    await navigateToContact(page, contact.id);

    expect(await isDraftEmailButtonVisible({ page })).toBe(false);
  },
);
