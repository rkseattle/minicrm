/**
 * F-AI-CTX — AI context panel (MINCRM-427, MINCRM-428, MINCRM-429, MINCRM-430)
 *
 * Tests the "My Context" sidebar panel on the AI page, which lets users save
 * key/value preferences that are injected into every AI session's system prompt.
 *
 * E2E limitations:
 *   The E2E server uses the stub AI response ("[E2E stub response]") — real
 *   injection of saved context entries into a live model's system prompt
 *   cannot be exercised end-to-end (no real Anthropic call is ever made in
 *   E2E). The %%CONTEXT_PROPOSAL%% accept/dismiss protocol itself IS covered
 *   end-to-end via the __E2E_STUB__:CONTEXT_PROPOSAL trigger — see
 *   ai-context-proposal.spec.ts (MINCRM-435). This file covers CRUD on the
 *   context panel only. Additional coverage:
 *     - server/src/__tests__/aiContextService.test.ts (service logic)
 *     - server/src/__tests__/contextProposal.test.ts (proposal extraction)
 *     - qa/evals/nli-semantic.yaml (proposal protocol semantics)
 *     - client/src/components/ai/ContextPanel.test.tsx (UI, incl. delete-confirm/cancel)
 *     - client/src/components/ai/ContextProposalChip.test.tsx (chip UI)
 *
 * Test groups:
 *   F-AI-CTX-1 — Context panel is visible on the AI page (desktop)
 *   F-AI-CTX-2 — Context panel shows an empty state when no entries exist
 *   F-AI-CTX-3 — Adding a context entry via the UI saves and displays it
 *   F-AI-CTX-4 — A context entry created via API appears in the panel after reload
 *   F-AI-CTX-5 — Cancelling the add form discards the entry
 *   F-AI-CTX-6 — Editing a context entry via the panel updates it (MINCRM-435)
 *   F-AI-CTX-7 — Deleting a context entry via the panel removes it (MINCRM-435)
 *
 * (MINCRM-427, MINCRM-428, MINCRM-435)
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { setAiEnabled, restoreAiDefaultsAfterTest } from '@behaviors/minicrm/settings.behaviors.js';
import {
  navigateToAiPage,
  waitForAiConversationPanel,
  isAiContextPanelVisible,
  isAiAddContextButtonVisible,
  addContextEntryViaUI,
  cancelContextEntryViaUI,
  editContextEntryViaUI,
  deleteContextEntryViaUI,
  createContextEntryViaApi,
  deleteAllContextEntriesViaApi,
  getContextEntriesViaApi,
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
  // Restore AI defaults so the toggle does not outlive this file. See
  // restoreAiDefaultsAfterTest's docblock for why this is load-bearing.
  await restoreAiDefaultsAfterTest(restClient);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

test(
  'F-AI-CTX-1 — Context panel is visible on the AI page @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });
    // The context sidebar is hidden on narrow viewports (hidden lg:flex) — only
    // assert visibility on wide viewports where it is expected to render.
    const viewportWidth = page.viewportSize()?.width ?? 1280;
    if (viewportWidth >= 1024) {
      const panelVisible = await isAiContextPanelVisible({ page });
      expect(panelVisible).toBe(true);

      const addBtnVisible = await isAiAddContextButtonVisible({ page });
      expect(addBtnVisible).toBe(true);
    }
  },
);

test(
  'F-AI-CTX-2 — Context panel shows empty state when no entries exist @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    // Empty state lives inside the hidden lg:flex sidebar — only assertable on wide viewports.
    const viewportWidth = page.viewportSize()?.width ?? 1280;
    if (viewportWidth >= 1024) {
      const emptyVisible = await isContextPanelEmptyStateVisible({ page });
      expect(emptyVisible).toBe(true);
    }
  },
);

test(
  'F-AI-CTX-3 — Adding a context entry via the UI saves and displays it @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    // The add button and entry list live in the hidden lg:flex sidebar — only
    // exercisable on wide viewports.
    const viewportWidth = page.viewportSize()?.width ?? 1280;
    if (viewportWidth >= 1024) {
      await addContextEntryViaUI({ page }, 'a while', '30+ days without activity');

      // Fetch the entry by API to get its server-assigned ID, then assert it is
      // visible in the panel — this only passes once the save mutation succeeds
      // and the panel re-renders the new row.
      await expect(async () => {
        const entries = await getContextEntriesViaApi(restClient);
        expect(entries.length).toBeGreaterThan(0);
        const entryId = entries[0].id;
        const entryVisible = await isContextEntryVisible({ page }, entryId);
        expect(entryVisible).toBe(true);
      }).toPass({ timeout: 5000 });
    }
  },
);

test(
  'F-AI-CTX-4 — Context entry created via API appears in the panel @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    const entryId = await createContextEntryViaApi(restClient, 'high-value', 'deals over $50k'); // MINCRM-686-ok: cleared by deleteAllContextEntriesViaApi in beforeEach/afterEach

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    // Entry rows live in the hidden lg:flex sidebar — only visible on wide viewports.
    const viewportWidth = page.viewportSize()?.width ?? 1280;
    if (viewportWidth >= 1024) {
      const entryVisible = await isContextEntryVisible({ page }, entryId);
      expect(entryVisible).toBe(true);
    }
  },
);

test(
  'F-AI-CTX-5 — Cancelling the add form discards the entry @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    // The add button, cancel form, and empty state all live in the hidden lg:flex
    // sidebar — only exercisable on wide viewports.
    const viewportWidth = page.viewportSize()?.width ?? 1280;
    if (viewportWidth >= 1024) {
      const addBtnVisible = await isAiAddContextButtonVisible({ page });
      expect(addBtnVisible).toBe(true);

      await cancelContextEntryViaUI({ page }, 'should-not-save', 'cancel test value');

      // Empty state should still be visible (no entry was saved)
      await expect(async () => {
        const emptyVisible = await isContextPanelEmptyStateVisible({ page });
        expect(emptyVisible).toBe(true);
      }).toPass({ timeout: 3000 });
    }
  },
);

test(
  'F-AI-CTX-6 — Editing a context entry via the panel updates it @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    const entryId = await createContextEntryViaApi(restClient, 'original-key', 'original value'); // MINCRM-686-ok: cleared by deleteAllContextEntriesViaApi in beforeEach/afterEach

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    const viewportWidth = page.viewportSize()?.width ?? 1280;
    if (viewportWidth >= 1024) {
      const entryVisible = await isContextEntryVisible({ page }, entryId);
      expect(entryVisible).toBe(true);

      await editContextEntryViaUI({ page }, entryId, 'updated-key', 'updated value');

      await expect(async () => {
        const entries = await getContextEntriesViaApi(restClient);
        const updated = entries.find((e) => e.id === entryId);
        expect(updated).toBeDefined();
        expect(updated?.key).toBe('updated-key');
        expect(updated?.value).toBe('updated value');
      }).toPass({ timeout: 5000 });
    }
  },
);

test(
  'F-AI-CTX-7 — Deleting a context entry via the panel removes it @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    const entryId = await createContextEntryViaApi(restClient, 'to-delete', 'value to delete'); // MINCRM-686-ok: cleared by deleteAllContextEntriesViaApi in beforeEach/afterEach

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    const viewportWidth = page.viewportSize()?.width ?? 1280;
    if (viewportWidth >= 1024) {
      const entryVisible = await isContextEntryVisible({ page }, entryId);
      expect(entryVisible).toBe(true);

      await deleteContextEntryViaUI({ page }, entryId);

      await expect(async () => {
        const entries = await getContextEntriesViaApi(restClient);
        expect(entries.find((e) => e.id === entryId)).toBeUndefined();
      }).toPass({ timeout: 5000 });
    }
  },
);
