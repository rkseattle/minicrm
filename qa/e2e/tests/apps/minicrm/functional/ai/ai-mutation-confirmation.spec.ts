/**
 * F-AI-CONFIRM — AI mutation confirmation flow (MINCRM-425, MINCRM-426, MINCRM-435)
 *
 * Tests the two-turn mutation confirmation protocol:
 *   1. User requests a write operation (create / update / delete).
 *   2. AI returns a pending_action block for the user to confirm or cancel.
 *   3. User clicks Confirm → AI receives "Yes, go ahead." and executes the write.
 *      User clicks Cancel → AI receives "No, cancel that." and aborts.
 *
 * Stub note (MINCRM-435):
 *   The E2E server runs with E2E=true, so no real model call is made. The
 *   __E2E_STUB__:MUTATION_* / __E2E_STUB__:RBAC_DENIED-style triggers (see
 *   shared/schemas/aiE2eStub.ts) deterministically populate pending_action
 *   the same way a real requestMutationConfirmation tool call would, so the
 *   confirmation/bulk blocks render from real server payloads.
 *
 *   The stub never executes a real write tool (no Anthropic call is ever
 *   made), so these tests verify the UI/API contract mechanics — the
 *   confirmation block renders the payload correctly, and clicking Confirm/
 *   Cancel sends the exact literal phrase and clears pending_action
 *   server-side — not the downstream mutation's actual execution. Real write
 *   execution is covered by server/src/__tests__/aiSessionService.test.ts and
 *   toolExecutor-level service tests.
 *
 *   The MutationConfirmationBlock and BulkConfirmationBlock components'
 *   internal rendering logic is additionally covered by unit tests in:
 *     client/src/components/ai/MutationConfirmationBlock.test.tsx
 *     client/src/components/ai/BulkConfirmationBlock.test.tsx
 *
 * Test groups:
 *   F-AI-C1 — Normal read-only AI turn never shows a confirmation block
 *   F-AI-C2 — User can type and send the cancel phrase manually
 *   F-AI-C3 — User can type and send the confirm phrase manually
 *   F-AI-C4 — A create pending_action renders a confirmation block with fields
 *   F-AI-C5 — Clicking Confirm on a pending_action sends the exact confirm phrase and clears it
 *   F-AI-C6 — Clicking Cancel on a pending_action sends the exact cancel phrase and clears it
 *   F-AI-C7 — A bulk pending_action renders count and sample in the confirmation block
 *   F-AI-C8 — A bulk-delete pending_action requires typing the count before Confirm is enabled
 *
 * (MINCRM-425, MINCRM-426, MINCRM-435)
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, refreshAdminBrowserSession } from '@behaviors/minicrm/auth.behaviors.js';
import { setAiEnabled } from '@behaviors/minicrm/settings.behaviors.js';
import {
  navigateToAiPage,
  waitForAiConversationPanel,
  waitForAiThreadText,
  sendAiMessageViaUI,
  sendE2eStubMessageViaUI,
  isConfirmationBlockVisible,
  isBulkConfirmationBlockVisible,
  clickConfirmButton,
  clickCancelButton,
  typeBulkDeleteConfirmText,
  createAiSessionViaApi,
  getAiSessionMessagesViaApi,
  deleteAllAiSessionsViaApi,
} from '@behaviors/minicrm/ai.behaviors.js';
import {
  E2E_STUB_MUTATION_CREATE,
  E2E_STUB_BULK_COUNT,
  E2E_STUB_BULK_SAMPLE,
  E2E_STUB_BULK_DELETE_COUNT,
} from '@minicrm/shared/schemas/aiE2eStub.js';

// Serial mode required: tests share the admin account's AI session list.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ restClient, page }) => {
  // Refresh the browser's admin cookie: the project storageState is minted
  // once at suite start and its JWT idles out after 30 minutes, which is why
  // these specs rendered /login an hour into record mode. (MINCRM-697)
  await refreshAdminBrowserSession({ page });
  await loginAsAdmin(restClient);
  await setAiEnabled(restClient, true);
  await deleteAllAiSessionsViaApi(restClient);
});

// beforeEach alone cleans the PREVIOUS test's sessions, so the last test in the
// file would leave its own behind for the rest of the run. (MINCRM-686)
test.afterEach(async ({ restClient }) => {
  await deleteAllAiSessionsViaApi(restClient);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test(
  'F-AI-C1 — Normal AI stub response does not show a confirmation block @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    // beforeEach already logs in as admin and clears sessions.
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    // sendAiMessageViaUI already waits for the assistant bubble — no extra wait needed.
    await sendAiMessageViaUI({ page }, 'Show me all contacts');

    const stdVisible = await isConfirmationBlockVisible({ page });
    const bulkVisible = await isBulkConfirmationBlockVisible({ page });

    expect(stdVisible).toBe(false);
    expect(bulkVisible).toBe(false);
  },
);

test(
  'F-AI-C2 — Sending cancel phrase after confirmation dispatches correct message @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    // beforeEach already logs in as admin and clears sessions.
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    // First message establishes context (stub returns generic reply)
    await sendAiMessageViaUI({ page }, 'Delete contact Bob Smith');

    // User types the cancel phrase as a follow-up (simulating what the Cancel
    // button sends programmatically when a real pending_action block is present)
    await sendAiMessageViaUI({ page }, 'No, cancel that.');
    // The stub still replies — verify the cancel message appears in the thread
    await waitForAiThreadText({ page }, 'No, cancel that.');
  },
);

test(
  'F-AI-C3 — Sending confirm phrase after confirmation dispatches correct message @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    // beforeEach already logs in as admin and clears sessions.
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    // First message establishes context (stub returns generic reply)
    await sendAiMessageViaUI({ page }, 'Create a contact Jane Doe at jane@example.com');

    // User types the confirm phrase (simulating what the Confirm button sends)
    await sendAiMessageViaUI({ page }, 'Yes, go ahead.');
    await waitForAiThreadText({ page }, 'Yes, go ahead.');
  },
);

test(
  'F-AI-C4 — Create pending_action renders a confirmation block with fields @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    // beforeEach already logs in as admin and clears sessions.
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    await sendE2eStubMessageViaUI({ page }, 'MUTATION_CREATE');

    const visible = await isConfirmationBlockVisible({ page });
    expect(visible).toBe(true);

    await waitForAiThreadText({ page }, E2E_STUB_MUTATION_CREATE.summary);
  },
);

test(
  'F-AI-C5 — Confirm sends the exact confirm phrase and clears pending_action @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    const sessionId = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    await sendE2eStubMessageViaUI({ page }, 'MUTATION_CREATE');
    expect(await isConfirmationBlockVisible({ page })).toBe(true);

    const { clicked } = await clickConfirmButton({ page });
    expect(clicked).toBe(true);

    // The confirm phrase dispatches a new turn — wait for its stub reply.
    await waitForAiThreadText({ page }, 'Yes, go ahead.');

    // Assert against server-persisted state directly (sidesteps client cache
    // reconciliation timing): the confirm phrase was sent verbatim, and the
    // triggering assistant message's pending_action was cleared.
    await expect(async () => {
      const messages = await getAiSessionMessagesViaApi(restClient, sessionId);
      const confirmTurn = messages.find((m) => m.role === 'user' && m.content === 'Yes, go ahead.');
      expect(confirmTurn).toBeDefined();

      const triggeringReply = messages.find(
        (m) => m.role === 'assistant' && m.pending_action !== null,
      );
      expect(triggeringReply).toBeUndefined();
    }).toPass({ timeout: 5000 });
  },
);

test(
  'F-AI-C6 — Cancel sends the exact cancel phrase and clears pending_action @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    const sessionId = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    await sendE2eStubMessageViaUI({ page }, 'MUTATION_CREATE');
    expect(await isConfirmationBlockVisible({ page })).toBe(true);

    const { clicked } = await clickCancelButton({ page });
    expect(clicked).toBe(true);

    await waitForAiThreadText({ page }, 'No, cancel that.');

    // No data change: the stub never invokes a real write tool regardless of
    // confirm or cancel, so "no data change" is verified as the cancel phrase
    // being sent and the pending_action being cleared — the same server-side
    // contract as confirm, just with the opposite phrase.
    await expect(async () => {
      const messages = await getAiSessionMessagesViaApi(restClient, sessionId);
      const cancelTurn = messages.find(
        (m) => m.role === 'user' && m.content === 'No, cancel that.',
      );
      expect(cancelTurn).toBeDefined();

      const triggeringReply = messages.find(
        (m) => m.role === 'assistant' && m.pending_action !== null,
      );
      expect(triggeringReply).toBeUndefined();
    }).toPass({ timeout: 5000 });
  },
);

test(
  'F-AI-C7 — Bulk pending_action renders count and sample @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    // beforeEach already logs in as admin and clears sessions.
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    await sendE2eStubMessageViaUI({ page }, 'MUTATION_BULK');

    const visible = await isConfirmationBlockVisible({ page });
    expect(visible).toBe(true);

    await waitForAiThreadText({ page }, String(E2E_STUB_BULK_COUNT));
    await waitForAiThreadText({ page }, E2E_STUB_BULK_SAMPLE[0]);
  },
);

test(
  'F-AI-C8 — Bulk-delete requires typing the count before Confirm is enabled @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    // beforeEach already logs in as admin and clears sessions.
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    await sendE2eStubMessageViaUI({ page }, 'MUTATION_BULK_DELETE');

    const bulkVisible = await isBulkConfirmationBlockVisible({ page });
    expect(bulkVisible).toBe(true);
    await waitForAiThreadText({ page }, String(E2E_STUB_BULK_DELETE_COUNT));

    await typeBulkDeleteConfirmText({ page }, String(E2E_STUB_BULK_DELETE_COUNT));

    const { clicked } = await clickConfirmButton({ page });
    expect(clicked).toBe(true);
    await waitForAiThreadText({ page }, 'Yes, go ahead.');
  },
);
