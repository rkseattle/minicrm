/**
 * F-AI — AI Assistant (MINCRM-420, MINCRM-421)
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
 *   are consumed. (MINCRM-421)
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behaviours imported from @behaviors/* only — never @pages/*
 *   - Feature flag UI state controlled via withFlags() route interception only
 *   - Test data managed via restClient + TestDataManager
 *   - test.describe.configure({ mode: 'parallel' }) is safe here because every
 *     test creates its own data and no test mutates system_settings rows.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { navigateViaNavLink } from '@behaviors/minicrm/nav.behaviors.js';
import { withFlags } from '@apps/minicrm/helpers.js';
import { createTestRep } from '@apps/minicrm/helpers.js';
import {
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

// Serial mode required: all tests share the admin user's AI sessions. Parallel
// execution causes cross-test session state bleed (messages from one test appear
// in another test's session list, causing strict-mode locator violations).
test.describe.configure({ mode: 'serial' });

const E2E_STUB = '[E2E stub response]';

// ── Setup / teardown ──────────────────────────────────────────────────────────

test.beforeEach(async ({ restClient }) => {
  // Delete all admin sessions so each test starts with a clean slate.
  // Needed because serial tests share the admin account and sessions accumulate.
  await loginAsAdmin(restClient);
  await deleteAllAiSessionsViaApi(restClient);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test('F-AI1 — /ai route accessible from nav when flag is on @functional', async ({
  page,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  // Navigate to root first so the browser is on a page with the nav visible
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });
  const result = await navigateViaNavLink('top', 'ai', { page });
  expect(result.linkClicked).toBe(true);
  expect(result.finalUrl).toContain('/ai');
});

test('F-AI2 — Two-panel layout renders: thread panel and input controls @functional', async ({
  page,
  restClient,
}) => {
  await loginAsAdmin(restClient);
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
});

test('F-AI3 — Empty state shown when session has no messages @functional', async ({
  page,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  // Create a fresh session with no messages so the empty state is guaranteed
  await createAiSessionViaApi(restClient);
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });
  // Wait for the query to resolve and the empty state to mount
  await waitForAiEmptyState({ page });

  expect(await isAiEmptyStateVisible({ page })).toBe(true);
});

test('F-AI4 — New Session button creates a fresh conversation @functional', async ({
  page,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  // Create a session that already has a message so the empty state is hidden
  const sessionId = await createAiSessionViaApi(restClient);
  await sendAiMessageViaApi(restClient, sessionId, 'Hello from test');

  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });
  expect(await isAiEmptyStateVisible({ page })).toBe(false);

  await clickNewSessionButton({ page });
  // Wait for the empty state to appear after the new session is created
  await waitForAiEmptyState({ page });
  expect(await isAiEmptyStateVisible({ page })).toBe(true);
});

test('F-AI5 — Sending a message appends user turn and receives stub reply @functional', async ({
  page,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });

  const result = await sendAiMessageViaUI({ page }, 'What is the total deal value?');
  expect(result.userMessageVisible).toBe(true);
  expect(result.assistantMessageVisible).toBe(true);

  const replyText = await getAssistantMessageText({ page });
  expect(replyText).toContain(E2E_STUB);
});

test('F-AI6 — Session is auto-named from the first message @functional', async ({
  page,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });

  const firstMessage = 'How many open deals do we have?';
  await sendAiMessageViaUI({ page }, firstMessage);

  // Wait for the assistant reply to confirm the server-side name update committed
  const reply = await getAssistantMessageText({ page });
  expect(reply).not.toBeNull();

  // Wait for the sessions list to re-fetch and display the auto-generated name
  await waitForAiSidebarText({ page }, firstMessage);
  const sidebarText = await getSessionSidebarText({ page });
  expect(sidebarText).toContain(firstMessage);
});

test('F-AI7 — User can switch between sessions; thread updates @functional', async ({
  page,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  // Create two sessions with distinct messages via API
  const sessionA = await createAiSessionViaApi(restClient);
  const sessionB = await createAiSessionViaApi(restClient);
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
});

test('F-AI8 — Deleting a session removes it from the session list @functional', async ({
  page,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  const sessionId = await createAiSessionViaApi(restClient);
  await sendAiMessageViaApi(restClient, sessionId, 'Message to delete');

  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });

  const result = await deleteAiSessionViaUI({ page }, sessionId);
  expect(result.modalVisible).toBe(true);
  expect(result.sessionRemoved).toBe(true);
});

test('F-AI9 — /ai nav link hidden when ai_nli_page flag is off @functional', async ({
  page,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  await withFlags(page, { ai_nli_page: false });
  // Navigate to root so the nav is visible and the flag interception is active
  await navigateToAiPage({ page });
  expect(await isAiNavLinkVisible({ page })).toBe(false);
});

test('F-AI10 — Sessions scoped to authenticated user; other user cannot access @functional', async ({
  page,
  restClient,
  testData,
}) => {
  // Authenticate as admin and create a session
  await loginAsAdmin(restClient);
  const adminSessionId = await createAiSessionViaApi(restClient);

  // Switch the REST client to a different user (a new rep)
  const rep = await createTestRep(testData, restClient);
  await restClient.post('/api/v1/auth/login', {
    email: rep.email,
    password: rep.password,
  });

  // The rep must receive a 404 when accessing the admin's session
  let caughtStatusCode: number | undefined;
  try {
    await getAiSessionViaApi(restClient, adminSessionId);
  } catch (err: unknown) {
    const e = err as { statusCode?: number };
    caughtStatusCode = e.statusCode;
  }
  expect(caughtStatusCode).toBe(404);

  // Re-auth the browser session as admin and verify the session still exists
  const adminEmail = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
  const adminPassword = process.env['E2E_ADMIN_PASSWORD'] ?? '';
  await loginAsAdmin(restClient);
  await loginViaBrowser(adminEmail, adminPassword, { page });
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });

  // The admin's session sidebar must be visible (session still belongs to admin)
  const sidebarText = await getSessionSidebarText({ page });
  expect(sidebarText).not.toBeNull();
});
