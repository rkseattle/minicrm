/**
 * F-AI-PERM — AI NLI unauthorized operation error (MINCRM-434, MINCRM-435)
 *
 * Verifies that when the AI attempts a tool call an authenticated user is
 * not permitted to make, the resulting permission error is surfaced to the
 * user as plain language — not a raw HTTP status or stack trace.
 *
 * Stub note (MINCRM-435):
 *   The E2E server runs with E2E=true, so no real model call is made and no
 *   real tool is ever invoked in E2E mode — RBAC checks inside toolExecutor
 *   (ADMIN_ONLY_TOOL_NAMES, ownership checks) can never run through a normal
 *   E2E turn. The __E2E_STUB__:RBAC_DENIED trigger (see
 *   shared/schemas/aiE2eStub.ts) throws a statusCode:403 error shaped
 *   exactly like a real admin-only-tool denial from toolExecutor.ts, so this
 *   spec exercises the real HTTP error-mapping path end-to-end:
 *   aiSessionController's 403 handling (added in MINCRM-435 — previously a
 *   thrown 403 fell through to the global error handler as an uncaught 500)
 *   and AiPage's resolveApiError()-based error rendering (also added in
 *   MINCRM-435 — previously always rendered the same generic message
 *   regardless of status code).
 *
 * Test groups:
 *   F-AI-PERM1 — Unauthorized tool call surfaces a plain-language permission error
 *
 * (MINCRM-434, MINCRM-435)
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { setAiEnabled } from '@behaviors/minicrm/settings.behaviors.js';
import {
  navigateToAiPage,
  waitForAiConversationPanel,
  sendE2eStubMessageExpectingErrorViaUI,
  getAiSendErrorText,
  deleteAllAiSessionsViaApi,
} from '@behaviors/minicrm/ai.behaviors.js';
import { loginAndVerify } from '@apps/minicrm/helpers.js';

// Serial mode required: beforeEach flips the AI master toggle, a shared
// system_settings row, matching every other AI spec file's convention.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await setAiEnabled(restClient, true);
});

// The tests below drive /ai as an ephemeral REP in the browser, and AiPage
// creates a session for that user on load. Those rows are owned by the rep, not
// the admin, so no admin-side sweep can see them — and because the browser
// creates them, no create*ViaApi call site exists for check-e2e-cleanup.sh to
// flag. Clean up as the rep, then restore admin auth for the next test's
// beforeEach. (MINCRM-686)
test.afterEach(async ({ restClient, ephemeralRep }) => {
  await loginAndVerify(restClient, ephemeralRep.email, ephemeralRep.password);
  await deleteAllAiSessionsViaApi(restClient);
  await loginAsAdmin(restClient);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test(
  'F-AI-PERM1 — unauthorized tool call surfaces a plain-language permission error @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, ephemeralRep }) => {
    await loginViaBrowser(ephemeralRep.email, ephemeralRep.password, { page });

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    // The RBAC_DENIED scenario throws before any assistant message is
    // persisted, so sendE2eStubMessageViaUI's "wait for a 200 + new assistant
    // bubble" behavior would block for its full 60s timeout on this 403 —
    // sendE2eStubMessageExpectingErrorViaUI waits on the non-2xx response instead.
    await sendE2eStubMessageExpectingErrorViaUI({ page }, 'RBAC_DENIED');

    await expect(async () => {
      const text = await getAiSendErrorText({ page });
      expect(text).toContain("You don't have permission to perform this action.");
    }).toPass({ timeout: 10_000 });
  },
);
