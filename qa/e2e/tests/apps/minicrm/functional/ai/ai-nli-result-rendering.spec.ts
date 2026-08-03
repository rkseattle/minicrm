/**
 * F-AI-RESULT — AI NLI read-query result rendering (MINCRM-423, MINCRM-431, MINCRM-435)
 *
 * Verifies the read-query happy path: a prompt that resolves to a read tool
 * call renders the result as a native CRM-styled component in the thread,
 * rather than raw text or JSON.
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so no real model call is made. This
 *   spec uses the reserved __E2E_STUB__:READ_QUERY trigger (see
 *   shared/schemas/aiE2eStub.ts) to deterministically populate tool_results
 *   the same way a real searchContacts call would, so NliResultBlock and
 *   ContactResultCard render exactly as they would for a live query.
 *
 * Test groups:
 *   F-AI-RESULT1 — Read-query reply renders the native result block and a contact card
 *
 * Framework conventions: see docs/dev/e2e-authoring.md.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { setAiEnabled } from '@behaviors/minicrm/settings.behaviors.js';
import {
  navigateToAiPage,
  waitForAiConversationPanel,
  sendE2eStubMessageViaUI,
  isNliResultBlockVisible,
  isNliContactCardVisible,
  deleteAllAiSessionsViaApi,
} from '@behaviors/minicrm/ai.behaviors.js';
import { E2E_STUB_READ_QUERY_CONTACT } from '@minicrm/shared/schemas/aiE2eStub.js';

// Serial mode required: shares the admin account's AI session list, same as
// every other AI spec file.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ restClient }) => {
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
  'F-AI-RESULT1 — read-query reply renders a native CRM result card @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    // beforeEach already logs in as admin and clears sessions.
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    await sendE2eStubMessageViaUI({ page }, 'READ_QUERY');

    const resultBlockVisible = await isNliResultBlockVisible({ page });
    expect(resultBlockVisible).toBe(true);

    const contactCardVisible = await isNliContactCardVisible(
      { page },
      E2E_STUB_READ_QUERY_CONTACT.id,
    );
    expect(contactCardVisible).toBe(true);
  },
);
