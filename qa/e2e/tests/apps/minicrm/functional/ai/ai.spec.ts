/**
 * F-AI — AI Assistant
 *
 * Functional regression tests for the AI conversation page: layout, empty
 * state, multi-session management, send/receive messages (E2E stub), and
 * cross-user session isolation.
 *
 * Test groups:
 *   F-AI1  — /ai route is accessible from main navigation when flag is on
 *   F-AI2  — Two-panel layout renders: thread and context sidebar present
 *   F-AI3  — Empty state shown when no messages exist in a session
 *   F-AI4  — New Session button creates a fresh conversation
 *   F-AI5  — Sending a message appends user turn and receives stub reply
 *   F-AI6  — Session is auto-named from the first message
 *   F-AI7  — User can switch between sessions; thread updates accordingly
 *   F-AI8  — Deleting a session removes it from the session list
 *   F-AI9  — /ai route is hidden when ai_nli_page flag is intercepted as off
 *   F-AI10 — Sessions are scoped to the authenticated user (cross-user isolation)
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so sendMessage bypasses the Anthropic
 *   SDK and returns the deterministic stub "[E2E stub response]". No real tokens
 *   are consumed.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behaviours imported from @behaviors/* only — never @pages/*
 *   - Feature flag UI state controlled via withFlags() route interception only
 *   - Test data managed via restClient + TestDataManager
 *   - test.describe.configure({ mode: 'serial' }) required: tests share the admin
 *     user's AI session list; parallel runs cause cross-test session state bleed.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { navigateViaNavLink, navigateViaMobileNavLink } from '@behaviors/minicrm/nav.behaviors.js';
import { navigateToDashboardAndWait } from '@behaviors/minicrm/setup.behaviors.js';
import { createTestRep, registerAdminTeardown, withFlags } from '@apps/minicrm/helpers.js';
import {
  E2E_STUB,
  navigateToAiPage,
  waitForAiConversationPanel,
  waitForAiEmptyState,
  waitForAiSidebarText,
  waitForAiThreadText,
  isAiConversationPanelVisible,
  isAiContextPanelVisible,
  isAiMessageInputVisible,
  isAiSendButtonVisible,
  isAiAddContextButtonVisible,
  isAiEmptyStateVisible,
  isAiSessionItemVisible,
  sendAiMessageViaUI,
  getAssistantMessageText,
  clickNewSessionButton,
  switchToAiSession,
  getMessageThreadText,
  getSessionSidebarText,
  deleteAiSessionViaUI,
  isAiNavLinkVisible,
  createAiSessionViaApi,
  sendAiMessageViaApi,
  getAiSessionViaApi,
  deleteAllAiSessionsViaApi,
} from '@behaviors/minicrm/ai.behaviors.js';
import { setAiEnabled, restoreAiDefaultsAfterTest } from '@behaviors/minicrm/settings.behaviors.js';

// Serial mode required: all tests share the admin user's AI sessions. Parallel
// execution causes cross-test session state bleed (messages from one test appear
// in another test's session list, causing strict-mode locator violations).
test.describe.configure({ mode: 'serial' });

// ── Setup / teardown ──────────────────────────────────────────────────────────

test.beforeEach(async ({ restClient }) => {
  // Delete all admin sessions so each test starts with a clean slate.
  // Needed because serial tests share the admin account and sessions accumulate.
  await loginAsAdmin(restClient);
  // Ensure AI is enabled. This used to say aiSettings.spec.ts "runs just before
  // this file alphabetically" and leaves the toggle disabled — an ordering the
  // conflict-graph scheduler stopped providing (the two files are in different
  // groups). This file now owns both halves: enable here, restore in afterEach.
  await setAiEnabled(restClient, true);
  await deleteAllAiSessionsViaApi(restClient);
});

// beforeEach alone cleans the PREVIOUS test's sessions, so the last test in the
// file would leave its own behind for the rest of the run. Mirrors
// ai-context.spec.ts, which pairs both hooks.
test.afterEach(async ({ restClient }) => {
  // Re-authenticate first: F-AI10 switches restClient to an ephemeral rep and
  // only restores admin near the end, so an assertion failing in between would
  // leave this hook sweeping the REP's sessions while the admin session it was
  // meant to clear survives — and an unnamed surviving session sorts to the top
  // of `ORDER BY updated_at DESC`, becoming the one a later spec's page
  // auto-selects. deleteAllAiSessionsViaApi only ever sees the authenticated
  // user's own sessions.
  await loginAsAdmin(restClient);
  await deleteAllAiSessionsViaApi(restClient);
  // Restore AI defaults so the toggle does not outlive this file. See
  // restoreAiDefaultsAfterTest's docblock for why this is load-bearing.
  await restoreAiDefaultsAfterTest(restClient);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test(
  'F-AI1 — /ai route accessible from nav when flag is on @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    // Navigate to the dashboard (/) first so clicking the AI nav link changes the URL.
    // navigateToAiPage would pre-land on /ai; navigateViaNavLink checks pathname change
    // and never resolves when start and destination are the same route.
    await navigateToDashboardAndWait({ page });
    // On mobile viewports the default 'top' layout hides sidebar links and shows a
    // mobile drawer. Use navigateViaMobileNavLink which opens that drawer and clicks
    // nav-top-ai-mobile. On desktop the sidebar top nav link (nav-top-ai) is visible.
    const viewportWidth = page.viewportSize()?.width ?? 1280;
    const isMobile = viewportWidth < 1024;
    let linkClicked: boolean;
    let finalUrl: string;
    if (isMobile) {
      const mobileResult = await navigateViaMobileNavLink('ai', { page });
      linkClicked = mobileResult.linkClicked;
      finalUrl = mobileResult.finalUrl;
    } else {
      const desktopResult = await navigateViaNavLink('top', 'ai', { page });
      linkClicked = desktopResult.linkClicked;
      finalUrl = desktopResult.finalUrl;
    }
    expect(linkClicked).toBe(true);
    expect(finalUrl).toContain('/ai');
  },
);

test(
  'F-AI2 — Two-panel layout renders: thread panel and input controls @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    expect(await isAiConversationPanelVisible({ page })).toBe(true);
    expect(await isAiMessageInputVisible({ page })).toBe(true);
    expect(await isAiSendButtonVisible({ page })).toBe(true);
    // Context sidebar (hidden lg:flex) and Add Context button only visible on wide viewports
    const viewportWidth = page.viewportSize()?.width ?? 1280;
    if (viewportWidth >= 1024) {
      expect(await isAiContextPanelVisible({ page })).toBe(true);
      expect(await isAiAddContextButtonVisible({ page })).toBe(true);
    }
  },
);

test(
  'F-AI3 — Empty state shown when session has no messages @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    // Create a fresh session with no messages so the empty state is guaranteed
    await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });
    // Wait for the query to resolve and the empty state to mount
    await waitForAiEmptyState({ page });

    expect(await isAiEmptyStateVisible({ page })).toBe(true);
  },
);

test(
  'F-AI4 — New Session button creates a fresh conversation @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient, testData }) => {
    // Create a session that already has a message so the empty state is hidden
    const sessionId = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach
    await sendAiMessageViaApi(restClient, sessionId, 'Hello from test');

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });
    // Wait for the message query to settle before checking empty state — the panel
    // renders before sessions load, so asserting immediately races the initial fetch.
    await waitForAiThreadText({ page }, 'Hello from test');
    expect(await isAiEmptyStateVisible({ page })).toBe(false);

    // Register the UI-created session explicitly rather than relying on the
    // afterEach sweep: this row is created by the browser, so it is invisible to
    // check-e2e-cleanup.sh, and an unnamed empty session that survives sorts to
    // the top of `ORDER BY updated_at DESC` — where a later spec's page
    // auto-selects it and reads an empty thread.
    const newSessionId = await clickNewSessionButton({ page });
    // The afterEach sweep above runs BEFORE fixture teardown and already deletes
    // this session, so the registered DELETE 404s on every green run — which
    // counts as successful cleanup for either entry kind since a later change.
    // registerAdminTeardown is used because the session is admin-owned and this
    // spec re-authenticates restClient; registration earns its place by covering
    // the path where the sweep does not run.
    registerAdminTeardown(
      testData,
      restClient,
      'ai_session',
      newSessionId,
      `/api/v1/ai/sessions/${newSessionId}`,
    );
    // Wait for the empty state to appear after the new session is created
    await waitForAiEmptyState({ page });
    expect(await isAiEmptyStateVisible({ page })).toBe(true);
  },
);

test(
  'F-AI5 — Sending a message appends user turn and receives stub reply @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    // beforeEach already authenticates restClient as admin — no second login needed.
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    const result = await sendAiMessageViaUI({ page }, 'What is the total deal value?');
    expect(result.userMessageVisible).toBe(true);
    expect(result.assistantMessageVisible).toBe(true);

    const replyText = await getAssistantMessageText({ page });
    expect(replyText).toContain(E2E_STUB);
  },
);

test(
  'F-AI6 — Session is auto-named from the first message @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    const firstMessage = 'How many open deals do we have?';
    await sendAiMessageViaUI({ page }, firstMessage);

    // sendAiMessageViaUI already waits for the assistant bubble — confirm the
    // reply is non-empty before checking the sidebar name.
    const reply = await getAssistantMessageText({ page });
    expect(reply).toBeTruthy();

    // Wait for the sessions list to re-fetch and display the auto-generated name
    await waitForAiSidebarText({ page }, firstMessage);
    const sidebarText = await getSessionSidebarText({ page });
    expect(sidebarText).toContain(firstMessage);
  },
);

test(
  'F-AI7 — User can switch between sessions; thread updates @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    // Session sidebar is desktop-only (hidden md:flex); switching requires it.
    test.skip(
      (page.viewportSize()?.width ?? 1280) < 768,
      'F-AI7: session switching via sidebar is desktop-only',
    );

    // Create two sessions with distinct messages via API
    const sessionA = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach
    const sessionB = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach
    await sendAiMessageViaApi(restClient, sessionA, 'Session A message');
    await sendAiMessageViaApi(restClient, sessionB, 'Session B message');

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    // Switch to session B and wait for its message to appear in the thread
    await switchToAiSession({ page }, sessionB);
    await waitForAiThreadText({ page }, 'Session B message');
    const threadBText = await getMessageThreadText({ page });
    expect(threadBText).toContain('Session B message');

    // Switch to session A and wait for its message to appear in the thread
    await switchToAiSession({ page }, sessionA);
    await waitForAiThreadText({ page }, 'Session A message');
    const threadAText = await getMessageThreadText({ page });
    expect(threadAText).toContain('Session A message');
  },
);

test(
  'F-AI8 — Deleting a session removes it from the session list @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    // Delete button is in the session sidebar which is desktop-only (hidden md:flex).
    test.skip(
      (page.viewportSize()?.width ?? 1280) < 768,
      'F-AI8: session deletion via sidebar is desktop-only',
    );

    const sessionId = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach
    await sendAiMessageViaApi(restClient, sessionId, 'Message to delete');

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    const result = await deleteAiSessionViaUI({ page }, sessionId);
    expect(result.modalVisible).toBe(true);
    expect(result.sessionRemoved).toBe(true);
  },
);

test(
  'F-AI9 — /ai nav link hidden when ai_nli_page flag is off @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page }) => {
    await withFlags(page, { ai_nli_page: false });
    // Navigate to /ai — the page loads but the flag interception suppresses the nav link
    await navigateToAiPage({ page });
    expect(await isAiNavLinkVisible({ page })).toBe(false);
  },
);

test(
  'F-AI10 — Sessions scoped to authenticated user; other user cannot access @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient, testData }) => {
    // beforeEach authenticates as admin — create a session for the admin
    const adminSessionId = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach

    // Switch the REST client to a different user (a new rep)
    const rep = await createTestRep(testData, restClient);
    await restClient.post('/api/v1/auth/login', {
      email: rep.email,
      password: rep.password,
    });

    // The rep must receive a 404 when accessing the admin's session
    let caughtStatus: number | undefined;
    try {
      await getAiSessionViaApi(restClient, adminSessionId);
    } catch (err: unknown) {
      const e = err as { status?: number };
      caughtStatus = e.status;
    }
    expect(caughtStatus).toBe(404);

    // Re-auth as admin and verify the session still exists.
    // The session sidebar is desktop-only (hidden md:flex), so on mobile verify
    // via API; on desktop verify via the sidebar DOM item.
    await loginAsAdmin(restClient);
    const viewportWidth = page.viewportSize()?.width ?? 1280;
    if (viewportWidth < 768) {
      const session = await getAiSessionViaApi(restClient, adminSessionId);
      expect(session).toBeDefined();
    } else {
      const adminEmail = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
      const adminPassword = process.env['E2E_ADMIN_PASSWORD'] ?? '';
      await loginViaBrowser(adminEmail, adminPassword, { page });
      await navigateToAiPage({ page });
      await waitForAiConversationPanel({ page });
      const sessionVisible = await isAiSessionItemVisible({ page }, adminSessionId);
      expect(sessionVisible).toBe(true);
    }
  },
);
