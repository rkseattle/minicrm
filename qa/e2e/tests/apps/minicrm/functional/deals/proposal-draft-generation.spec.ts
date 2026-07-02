/**
 * F7-PD — AI proposal draft generation from a deal (MINCRM-473)
 *
 * Functional regression tests for the "Generate Proposal Draft" button on
 * the deal detail page and the resulting full-screen editor.
 *
 * Test groups:
 *   F7-PD1 — Generating a draft opens the full-screen editor
 *   F7-PD2 — The button is hidden when the flag is off
 *   F7-PD3 — Dismissing the editor closes it without side effects
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so generateProposalDraft returns a
 *   deterministic stub draft (not a real Anthropic call) — the full
 *   generate → editor → dismiss flow is exercised end-to-end. Rich-text
 *   editing, regeneration, and export (clipboard/markdown/DOCX) are covered
 *   by the client component test suite (ProposalDraftEditor.test.tsx),
 *   which mocks the HTTP response directly. (MINCRM-473)
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
  createTestAccount,
  createTestDeal,
  createTestRep,
  navigateToDeal,
  withFlags,
} from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  clickGenerateProposalDraft,
  waitForProposalDraftEditor,
  dismissProposalDraftEditor,
  waitForProposalDraftEditorClosed,
  isGenerateProposalDraftButtonVisible,
} from '@behaviors/minicrm/deals.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F7-PD1 — Generating a draft opens the full-screen editor
// ---------------------------------------------------------------------------

test(
  'F7-PD1: generating a proposal draft opens the full-screen editor',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `PD1-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `PD1-Deal ${Date.now()}`,
      account_id: account.id,
    });

    await navigateToDeal(page, deal.id);
    await clickGenerateProposalDraft({ page });
    await waitForProposalDraftEditor({ page });
  },
);

// ---------------------------------------------------------------------------
// F7-PD2 — Button hidden when the flag is off
// ---------------------------------------------------------------------------

test(
  'F7-PD2: the generate button stays hidden when ai_proposal_draft_generation is off',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `PD2-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `PD2-Deal ${Date.now()}`,
      account_id: account.id,
    });

    await withFlags(page, { ai_proposal_draft_generation: false });
    await navigateToDeal(page, deal.id);

    await expect(async () => {
      expect(await isGenerateProposalDraftButtonVisible({ page })).toBe(false);
    }).toPass({ timeout: 5_000 });
  },
);

// ---------------------------------------------------------------------------
// F7-PD3 — Dismissing the editor closes it
// ---------------------------------------------------------------------------

test(
  'F7-PD3: dismissing the editor closes it',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `PD3-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `PD3-Deal ${Date.now()}`,
      account_id: account.id,
    });

    await navigateToDeal(page, deal.id);
    await clickGenerateProposalDraft({ page });
    await waitForProposalDraftEditor({ page });

    await dismissProposalDraftEditor({ page });
    await waitForProposalDraftEditorClosed({ page });
  },
);
