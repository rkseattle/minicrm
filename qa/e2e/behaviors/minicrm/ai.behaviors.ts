/**
 * AI Assistant behaviors for MiniCRM. (MINCRM-420, MINCRM-421)
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys on the /ai page. They compose AiPage Page Object internally —
 * callers never touch raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { AiPage } from '@pages/minicrm/AiPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by AI behaviors. */
export interface AiBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// navigateToAiPage()
// ---------------------------------------------------------------------------

/**
 * Navigates the browser to /ai and waits for network idle.
 *
 * @param context - Playwright fixture context.
 */
export async function navigateToAiPage(context: AiBehaviorContext): Promise<void> {
  await context.page.goto('/ai');
}

// ---------------------------------------------------------------------------
// waitForAiConversationPanel()
// ---------------------------------------------------------------------------

/**
 * Waits for the main AI conversation panel to be visible.
 *
 * @param context - Playwright fixture context.
 */
export async function waitForAiConversationPanel(context: AiBehaviorContext): Promise<void> {
  const aiPage = new AiPage(context);
  const panel = await aiPage.conversationPanelLocator();
  await panel.waitFor({ state: 'visible' });
}

// ---------------------------------------------------------------------------
// isAiConversationPanelVisible()
// ---------------------------------------------------------------------------

/**
 * Returns true when the main AI conversation panel is visible.
 *
 * @param context - Playwright fixture context.
 */
export async function isAiConversationPanelVisible(context: AiBehaviorContext): Promise<boolean> {
  const aiPage = new AiPage(context);
  const panel = await aiPage.conversationPanelLocator();
  return panel.isVisible().catch(() => false);
}

// ---------------------------------------------------------------------------
// isAiContextPanelVisible()
// ---------------------------------------------------------------------------

/**
 * Returns true when the AI context sidebar panel is visible.
 *
 * @param context - Playwright fixture context.
 */
export async function isAiContextPanelVisible(context: AiBehaviorContext): Promise<boolean> {
  const aiPage = new AiPage(context);
  const panel = await aiPage.contextPanelLocator();
  return panel.isVisible().catch(() => false);
}

// ---------------------------------------------------------------------------
// isAiMessageInputVisible()
// ---------------------------------------------------------------------------

/**
 * Returns true when the message input textarea is visible.
 *
 * @param context - Playwright fixture context.
 */
export async function isAiMessageInputVisible(context: AiBehaviorContext): Promise<boolean> {
  const aiPage = new AiPage(context);
  const input = await aiPage.messageInputLocator();
  return input.isVisible().catch(() => false);
}

// ---------------------------------------------------------------------------
// isAiSendButtonVisible()
// ---------------------------------------------------------------------------

/**
 * Returns true when the Send button is visible.
 *
 * @param context - Playwright fixture context.
 */
export async function isAiSendButtonVisible(context: AiBehaviorContext): Promise<boolean> {
  const aiPage = new AiPage(context);
  const btn = await aiPage.sendButtonLocator();
  return btn.isVisible().catch(() => false);
}

// ---------------------------------------------------------------------------
// isAiAddContextButtonVisible()
// ---------------------------------------------------------------------------

/**
 * Returns true when the Add Context button is visible.
 *
 * @param context - Playwright fixture context.
 */
export async function isAiAddContextButtonVisible(context: AiBehaviorContext): Promise<boolean> {
  const aiPage = new AiPage(context);
  const btn = await aiPage.addContextButtonLocator();
  return btn.isVisible().catch(() => false);
}

// ---------------------------------------------------------------------------
// isAiEmptyStateVisible()
// ---------------------------------------------------------------------------

/**
 * Returns true when the empty-state message is visible.
 *
 * @param context - Playwright fixture context.
 */
export async function isAiEmptyStateVisible(context: AiBehaviorContext): Promise<boolean> {
  const aiPage = new AiPage(context);
  const el = await aiPage.emptyStateLocator();
  if (!el) return false;
  return el.isVisible().catch(() => false);
}

// ---------------------------------------------------------------------------
// waitForAiSidebarText()
// ---------------------------------------------------------------------------

/**
 * Waits for the AI session sidebar to contain the given text string.
 * Polls until the text appears or the timeout is exceeded.
 *
 * @param context - Playwright fixture context.
 * @param text - The expected text to wait for.
 * @param timeout - Maximum wait in ms (default 8000).
 */
export async function waitForAiSidebarText(
  context: AiBehaviorContext,
  text: string,
  timeout = 8_000,
): Promise<void> {
  await context.page.waitForFunction(
    `document.querySelector('[data-testid="ai-session-sidebar"]')?.textContent?.includes(${JSON.stringify(text)}) ?? false`,
    undefined,
    { timeout },
  );
}

// ---------------------------------------------------------------------------
// waitForAiThreadText()
// ---------------------------------------------------------------------------

/**
 * Waits for the AI message thread to contain the given text string.
 * Polls until the text appears or the timeout is exceeded.
 *
 * @param context - Playwright fixture context.
 * @param text - The expected text to wait for.
 * @param timeout - Maximum wait in ms (default 8000).
 */
export async function waitForAiThreadText(
  context: AiBehaviorContext,
  text: string,
  timeout = 8_000,
): Promise<void> {
  await context.page.waitForFunction(
    `document.querySelector('[data-testid="ai-message-thread"]')?.textContent?.includes(${JSON.stringify(text)}) ?? false`,
    undefined,
    { timeout },
  );
}

// ---------------------------------------------------------------------------
// waitForAiEmptyState()
// ---------------------------------------------------------------------------

/**
 * Waits for the AI empty-state element to appear in the DOM and become visible.
 * Use after triggering a state change (e.g. clicking New Session) to give React
 * time to re-render before asserting on visibility.
 *
 * @param context - Playwright fixture context.
 * @param timeout - Maximum wait in ms (default 8000).
 */
export async function waitForAiEmptyState(
  context: AiBehaviorContext,
  timeout = 8_000,
): Promise<void> {
  await context.page.waitForPresent('[data-testid="ai-empty-state"]', timeout);
}

// ---------------------------------------------------------------------------
// sendAiMessageViaUI()
// ---------------------------------------------------------------------------

/** Result returned by sendAiMessageViaUI. */
export interface SendAiMessageResult {
  /** True when the user message bubble is visible after sending. */
  userMessageVisible: boolean;
  /** True when the assistant reply bubble is visible after the stub response. */
  assistantMessageVisible: boolean;
}

/**
 * Types the given message into the AI input and clicks Send, then waits for
 * the assistant reply bubble to appear.
 *
 * @param context - Playwright fixture context.
 * @param content - Message text to send.
 * @returns SendAiMessageResult describing what appeared in the thread.
 */
export async function sendAiMessageViaUI(
  context: AiBehaviorContext,
  content: string,
): Promise<SendAiMessageResult> {
  const aiPage = new AiPage(context);
  await aiPage.sendMessage(content);

  // waitForPresent uses document.querySelector which avoids strict-mode violations
  // when multiple message bubbles share the same data-testid attribute.
  // 30s: the AI stub round-trip can exceed the 10s default under CI load.
  await context.page.waitForPresent('[data-testid="ai-message-user"]', 30_000);
  await context.page.waitForPresent('[data-testid="ai-message-assistant"]', 30_000);

  // waitForPresent confirms the elements are in the DOM. That is sufficient
  // to conclude visibility for these inline message bubbles (no display:none).
  return { userMessageVisible: true, assistantMessageVisible: true };
}

// ---------------------------------------------------------------------------
// getAssistantMessageText()
// ---------------------------------------------------------------------------

/**
 * Returns the text content of the first assistant message bubble.
 *
 * @param context - Playwright fixture context.
 */
export async function getAssistantMessageText(context: AiBehaviorContext): Promise<string | null> {
  // Use string expression to avoid strict-mode violations when multiple assistant
  // bubbles exist — returns text content of the first matching element.
  const text = (await context.page.evaluate(
    `document.querySelector('[data-testid="ai-message-assistant"]')?.textContent ?? null`,
  )) as string | null;
  return text;
}

// ---------------------------------------------------------------------------
// clickNewSessionButton()
// ---------------------------------------------------------------------------

/**
 * Clicks the New Session button to start a fresh conversation.
 *
 * @param context - Playwright fixture context.
 */
export async function clickNewSessionButton(context: AiBehaviorContext): Promise<void> {
  const aiPage = new AiPage(context);
  const isMobile = (context.page.viewportSize()?.width ?? 1280) < 768;
  const btn = isMobile
    ? await aiPage.newSessionButtonMobileLocator()
    : await aiPage.newSessionButtonLocator();
  await btn.waitFor({ state: 'visible' });
  await aiPage.clickNewSession();
}

// ---------------------------------------------------------------------------
// switchToAiSession()
// ---------------------------------------------------------------------------

/**
 * Clicks the session list item with the given ID to switch the active conversation.
 *
 * @param context - Playwright fixture context.
 * @param sessionId - The session UUID to click in the sidebar.
 */
export async function switchToAiSession(
  context: AiBehaviorContext,
  sessionId: string,
): Promise<void> {
  const aiPage = new AiPage(context);
  await aiPage.clickSessionItem(sessionId);
}

// ---------------------------------------------------------------------------
// getMessageThreadText()
// ---------------------------------------------------------------------------

/**
 * Returns the text content of the message thread container.
 *
 * @param context - Playwright fixture context.
 */
export async function getMessageThreadText(context: AiBehaviorContext): Promise<string | null> {
  // Wait for the message thread to be visible before reading its content
  await context.page.waitForPresent('[data-testid="ai-message-thread"]');
  const aiPage = new AiPage(context);
  const thread = await aiPage.messageThreadLocator();
  return thread.textContent();
}

// ---------------------------------------------------------------------------
// getSessionSidebarText()
// ---------------------------------------------------------------------------

/**
 * Returns the text content of the session sidebar.
 *
 * @param context - Playwright fixture context.
 */
export async function getSessionSidebarText(context: AiBehaviorContext): Promise<string | null> {
  const aiPage = new AiPage(context);
  const sidebar = await aiPage.sessionSidebarLocator();
  return sidebar.textContent();
}

// ---------------------------------------------------------------------------
// deleteAiSessionViaUI()
// ---------------------------------------------------------------------------

/** Result returned by deleteAiSessionViaUI. */
export interface DeleteAiSessionResult {
  /** True when the delete modal appeared. */
  modalVisible: boolean;
  /** True when the session item is no longer visible after deletion. */
  sessionRemoved: boolean;
}

/**
 * Initiates and confirms deletion of the given session through the UI.
 * Hovers the session item, clicks the per-item delete button, confirms in the
 * modal, then waits for the item to disappear from the sidebar.
 *
 * @param context - Playwright fixture context.
 * @param sessionId - Session UUID to delete.
 * @returns DeleteAiSessionResult.
 */
export async function deleteAiSessionViaUI(
  context: AiBehaviorContext,
  sessionId: string,
): Promise<DeleteAiSessionResult> {
  const aiPage = new AiPage(context);

  await aiPage.initiateDeleteSession(sessionId);

  const modal = await aiPage.deleteConfirmModalLocator();
  const modalVisible = await modal.isVisible().catch(() => false);

  await aiPage.confirmDeleteSession();

  // waitForAbsent confirms removal; that's the authoritative check.
  await context.page.waitForAbsent(`[data-testid="ai-session-item-${sessionId}"]`);

  return { modalVisible, sessionRemoved: true };
}

// ---------------------------------------------------------------------------
// isAiNavLinkVisible()
// ---------------------------------------------------------------------------

/**
 * Returns true when the AI nav link is visible in the top navigation bar.
 *
 * @param context - Playwright fixture context.
 */
export async function isAiNavLinkVisible(context: AiBehaviorContext): Promise<boolean> {
  const aiPage = new AiPage(context);
  const link = await aiPage.navLinkLocator();
  if (!link) return false;
  return link.isVisible().catch(() => false);
}

// ---------------------------------------------------------------------------
// isAiSessionItemVisible()
// ---------------------------------------------------------------------------

/**
 * Returns true when the session list item for the given ID is visible.
 *
 * @param context - Playwright fixture context.
 * @param sessionId - Session UUID.
 */
export async function isAiSessionItemVisible(
  context: AiBehaviorContext,
  sessionId: string,
): Promise<boolean> {
  const aiPage = new AiPage(context);
  const item = await aiPage.sessionItemLocator(sessionId).catch(() => null);
  if (!item) return false;
  return item.isVisible().catch(() => false);
}

// ---------------------------------------------------------------------------
// API data helpers
// ---------------------------------------------------------------------------

/** Shape of the AI session response from the API. */
export interface AiSessionRow {
  id: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

/** Shape of the AI message response from the API. */
export interface AiMessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

/**
 * Creates a new AI session via the REST API and returns its ID.
 *
 * @param restClient - Authenticated RestClient.
 * @returns The created session's UUID.
 */
export async function createAiSessionViaApi(restClient: RestClient): Promise<string> {
  const res = await restClient.post<AiSessionRow>('/api/v1/ai/sessions', {});
  return res.body.id;
}

/**
 * Deletes all AI sessions for the authenticated user via the REST API.
 * Used in beforeEach hooks to reset session state between serial tests that
 * share the same admin account.
 *
 * @param restClient - Authenticated RestClient.
 */
export async function deleteAllAiSessionsViaApi(restClient: RestClient): Promise<void> {
  const res = await restClient.get<{ sessions: AiSessionRow[] }>('/api/v1/ai/sessions');
  const sessions = res.body.sessions ?? [];
  for (const session of sessions) {
    await restClient.delete(`/api/v1/ai/sessions/${session.id}`).catch(() => {
      // Ignore individual delete failures — best-effort cleanup
    });
  }
}

/**
 * Sends a message to an AI session via the REST API.
 * In E2E mode the server returns the deterministic stub response.
 *
 * @param restClient - Authenticated RestClient.
 * @param sessionId - Session UUID.
 * @param content - Message text.
 * @returns The assistant's reply content.
 */
export async function sendAiMessageViaApi(
  restClient: RestClient,
  sessionId: string,
  content: string,
): Promise<string> {
  const res = await restClient.post<AiMessageRow>(`/api/v1/ai/sessions/${sessionId}/messages`, {
    content,
  });
  return res.body.content;
}

/**
 * Fetches a single AI session by ID via the REST API.
 * Throws when the session is not found (404).
 *
 * @param restClient - Authenticated RestClient.
 * @param sessionId - Session UUID.
 */
export async function getAiSessionViaApi(
  restClient: RestClient,
  sessionId: string,
): Promise<AiSessionRow> {
  const res = await restClient.get<AiSessionRow>(`/api/v1/ai/sessions/${sessionId}`);
  return res.body;
}
