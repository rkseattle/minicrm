/**
 * F-AI-CONFIRM — AI mutation confirmation flow (MINCRM-425, MINCRM-426)
 *
 * Tests the two-turn mutation confirmation protocol:
 *   1. User requests a write operation (create / update / delete).
 *   2. AI returns a pending_action block for the user to confirm or cancel.
 *   3. User clicks Confirm → AI receives "Yes, go ahead." and executes the write.
 *      User clicks Cancel → AI receives "No, cancel that." and aborts.
 *
 * E2E limitations:
 *   The E2E server runs with E2E=true, which returns the deterministic stub
 *   "[E2E stub response]" without calling Anthropic or any tools. This means
 *   the AI will never set pending_action in E2E mode. These tests therefore
 *   verify the confirmation-response message flow (what gets sent to the AI
 *   after the user acts on a hypothetical confirmation block) and that normal
 *   AI turns do NOT show a spurious confirmation block.
 *
 *   The MutationConfirmationBlock and BulkConfirmationBlock components are
 *   covered by unit tests in:
 *     client/src/components/ai/MutationConfirmationBlock.test.tsx
 *     client/src/components/ai/BulkConfirmationBlock.test.tsx
 *
 * Test groups:
 *   F-AI-C1 — Normal read-only AI turn never shows a confirmation block
 *   F-AI-C2 — User can type and send the cancel phrase manually
 *   F-AI-C3 — User can type and send the confirm phrase manually
 *
 * (MINCRM-425, MINCRM-426)
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { setAiEnabled } from '@behaviors/minicrm/settings.behaviors.js';
import {
  navigateToAiPage,
  waitForAiConversationPanel,
  waitForAiThreadText,
  sendAiMessageViaUI,
  isConfirmationBlockVisible,
  isBulkConfirmationBlockVisible,
  deleteAllAiSessionsViaApi,
} from '@behaviors/minicrm/ai.behaviors.js';

// Serial mode required: tests share the admin account's AI session list.
test.describe.configure({ mode: 'serial' });

const E2E_STUB = '[E2E stub response]';

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await setAiEnabled(restClient, true);
  await deleteAllAiSessionsViaApi(restClient);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test('F-AI-C1 — Normal AI stub response does not show a confirmation block @functional', async ({
  page,
}) => {
  // beforeEach already logs in as admin and clears sessions.
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });

  await sendAiMessageViaUI({ page }, 'Show me all contacts');
  await waitForAiThreadText({ page }, E2E_STUB);

  const stdVisible = await isConfirmationBlockVisible({ page });
  const bulkVisible = await isBulkConfirmationBlockVisible({ page });

  expect(stdVisible).toBe(false);
  expect(bulkVisible).toBe(false);
});

test('F-AI-C2 — Sending cancel phrase after confirmation dispatches correct message @functional', async ({
  page,
}) => {
  // beforeEach already logs in as admin and clears sessions.
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });

  // First message establishes context (stub returns generic reply)
  await sendAiMessageViaUI({ page }, 'Delete contact Bob Smith');
  await waitForAiThreadText({ page }, E2E_STUB);

  // User types the cancel phrase as a follow-up (simulating what the Cancel
  // button sends programmatically when a real pending_action block is present)
  await sendAiMessageViaUI({ page }, 'No, cancel that.');
  // The stub still replies — verify the cancel message appears in the thread
  await waitForAiThreadText({ page }, 'No, cancel that.');
});

test('F-AI-C3 — Sending confirm phrase after confirmation dispatches correct message @functional', async ({
  page,
}) => {
  // beforeEach already logs in as admin and clears sessions.
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });

  // First message establishes context (stub returns generic reply)
  await sendAiMessageViaUI({ page }, 'Create a contact Jane Doe at jane@example.com');
  await waitForAiThreadText({ page }, E2E_STUB);

  // User types the confirm phrase (simulating what the Confirm button sends)
  await sendAiMessageViaUI({ page }, 'Yes, go ahead.');
  await waitForAiThreadText({ page }, 'Yes, go ahead.');
});
