/**
 * F-AI-PERSIST — AI session persistence across reload
 *
 * Verifies that a session's message history survives a full page reload —
 * i.e. it is genuinely persisted server-side, not just held in client-side
 * React state. New-session creation, session switching, and auto-naming are
 * already covered by ai.spec.ts (F-AI4, F-AI6, F-AI7); this file covers the
 * remaining "history retained" gap specifically: a reload/revisit.
 *
 * Test groups:
 *   F-AI-PERSIST1 — Message history is retained after a full page reload
 *   F-AI-PERSIST2 — The active session is retained after a full page reload
 *
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { setAiEnabled, restoreAiDefaultsAfterTest } from '@behaviors/minicrm/settings.behaviors.js';
import { reloadCurrentPage } from '@behaviors/minicrm/nav.behaviors.js';
import {
  navigateToAiPage,
  waitForAiConversationPanel,
  waitForAiThreadText,
  createAiSessionViaApi,
  sendAiMessageViaApi,
  switchToAiSession,
  getMessageThreadText,
  deleteAllAiSessionsViaApi,
} from '@behaviors/minicrm/ai.behaviors.js';

// Serial mode required: tests share the admin account's AI session list.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await setAiEnabled(restClient, true);
  await deleteAllAiSessionsViaApi(restClient);
});

// beforeEach alone cleans the PREVIOUS test's sessions, so the last test in the
// file would leave its own behind for the rest of the run.
test.afterEach(async ({ restClient }) => {
  await deleteAllAiSessionsViaApi(restClient);
  // Restore AI defaults so the toggle does not outlive this file. See
  // restoreAiDefaultsAfterTest's docblock for why this is load-bearing.
  await restoreAiDefaultsAfterTest(restClient);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test(
  'F-AI-PERSIST1 — message history is retained after a full page reload @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    // beforeEach already cleared all sessions, so this single session created
    // here is automatically selected as the active session on navigate — no
    // explicit switch is needed (and switchToAiSession requires the
    // desktop-only sidebar, which would hang on mobile viewports where it's
    // hidden — this test must pass on both).
    const sessionId = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach
    await sendAiMessageViaApi(restClient, sessionId, 'What deals are closing this month?');

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });
    await waitForAiThreadText({ page }, 'What deals are closing this month?');

    await reloadCurrentPage({ page });
    await waitForAiConversationPanel({ page });

    await waitForAiThreadText({ page }, 'What deals are closing this month?');
    const threadText = await getMessageThreadText({ page });
    expect(threadText).toContain('What deals are closing this month?');
  },
);

test(
  'F-AI-PERSIST2 — the active session is retained after a full page reload @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    // Session sidebar / switching is desktop-only (hidden md:flex).
    test.skip(
      (page.viewportSize()?.width ?? 1280) < 768,
      'F-AI-PERSIST2: session switching via sidebar is desktop-only',
    );

    const sessionA = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach
    const sessionB = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach
    await sendAiMessageViaApi(restClient, sessionA, 'Session A persisted message');
    await sendAiMessageViaApi(restClient, sessionB, 'Session B persisted message');

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    await switchToAiSession({ page }, sessionB);
    await waitForAiThreadText({ page }, 'Session B persisted message');

    await reloadCurrentPage({ page });
    await waitForAiConversationPanel({ page });

    // The most-recently-updated session (B, since it was messaged last) is
    // auto-selected on load — its thread should still show after reload.
    await waitForAiThreadText({ page }, 'Session B persisted message');
    const threadText = await getMessageThreadText({ page });
    expect(threadText).toContain('Session B persisted message');
    expect(threadText).not.toContain('Session A persisted message');
  },
);
