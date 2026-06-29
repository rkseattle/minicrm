/**
 * F-AI-CTX — AI context panel (MINCRM-427, MINCRM-428, MINCRM-429, MINCRM-430)
 *
 * Tests the "My Context" sidebar panel on the AI page, which lets users save
 * key/value preferences that are injected into every AI session's system prompt.
 *
 * E2E limitations:
 *   The E2E server uses the stub AI response ("[E2E stub response]") — real AI
 *   context injection and the %%CONTEXT_PROPOSAL%% protocol cannot be exercised
 *   end-to-end. Those behaviors are covered by:
 *     - server/src/__tests__/aiContextService.test.ts (service logic)
 *     - server/src/__tests__/contextProposal.test.ts (proposal extraction)
 *     - qa/evals/nli-semantic.yaml (proposal protocol semantics)
 *     - client/src/components/ai/ContextPanel.test.tsx (UI)
 *     - client/src/components/ai/ContextProposalChip.test.tsx (chip UI)
 *
 * Test groups:
 *   F-AI-CTX-1 — Context panel is visible on the AI page (desktop)
 *   F-AI-CTX-2 — Context panel shows an empty state when no entries exist
 *   F-AI-CTX-3 — Adding a context entry via the UI saves and displays it
 *   F-AI-CTX-4 — A context entry created via API appears in the panel after reload
 *   F-AI-CTX-5 — Cancelling the add form discards the entry
 *
 * (MINCRM-427, MINCRM-428)
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { setAiEnabled } from '@behaviors/minicrm/settings.behaviors.js';
import {
  navigateToAiPage,
  isAiContextPanelVisible,
  isAiAddContextButtonVisible,
  addContextEntryViaUI,
  cancelContextEntryViaUI,
  createContextEntryViaApi,
  deleteAllContextEntriesViaApi,
  isContextPanelEmptyStateVisible,
  isContextEntryVisible,
} from '@behaviors/minicrm/ai.behaviors.js';

// Serial mode: tests share the admin account's context entries.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await setAiEnabled(restClient, true);
  await deleteAllContextEntriesViaApi(restClient);
});

test.afterEach(async ({ restClient }) => {
  await deleteAllContextEntriesViaApi(restClient);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

test('F-AI-CTX-1 — Context panel is visible on the AI page @functional', async ({ page }) => {
  await navigateToAiPage({ page });
  const panelVisible = await isAiContextPanelVisible({ page });
  expect(panelVisible).toBe(true);

  const addBtnVisible = await isAiAddContextButtonVisible({ page });
  expect(addBtnVisible).toBe(true);
});

test('F-AI-CTX-2 — Context panel shows empty state when no entries exist @functional', async ({
  page,
}) => {
  await navigateToAiPage({ page });

  const emptyVisible = await isContextPanelEmptyStateVisible({ page });
  expect(emptyVisible).toBe(true);
});

test('F-AI-CTX-3 — Adding a context entry via the UI saves and displays it @functional', async ({
  page,
  restClient,
}) => {
  await navigateToAiPage({ page });

  await addContextEntryViaUI({ page }, 'a while', '30+ days without activity');

  // Fetch the entry by API to get its server-assigned ID, then assert it is
  // visible in the panel — this only passes once the save mutation succeeds
  // and the panel re-renders the new row.
  await expect(async () => {
    const response = await restClient.get<{ entries: Array<{ id: string }> }>('/api/v1/ai/context');
    expect(response.body.entries.length).toBeGreaterThan(0);
    const entryId = response.body.entries[0].id;
    const entryVisible = await isContextEntryVisible({ page }, entryId);
    expect(entryVisible).toBe(true);
  }).toPass({ timeout: 5000 });
});

test('F-AI-CTX-4 — Context entry created via API appears in the panel @functional', async ({
  page,
  restClient,
}) => {
  const entryId = await createContextEntryViaApi(restClient, 'high-value', 'deals over $50k');

  await navigateToAiPage({ page });

  const entryVisible = await isContextEntryVisible({ page }, entryId);
  expect(entryVisible).toBe(true);
});

test('F-AI-CTX-5 — Cancelling the add form discards the entry @functional', async ({ page }) => {
  await navigateToAiPage({ page });

  const addBtnVisible = await isAiAddContextButtonVisible({ page });
  expect(addBtnVisible).toBe(true);

  await cancelContextEntryViaUI({ page }, 'should-not-save', 'cancel test value');

  // Empty state should still be visible (no entry was saved)
  await expect(async () => {
    const emptyVisible = await isContextPanelEmptyStateVisible({ page });
    expect(emptyVisible).toBe(true);
  }).toPass({ timeout: 3000 });
});
