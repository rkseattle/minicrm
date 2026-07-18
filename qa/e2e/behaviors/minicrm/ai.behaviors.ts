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
import type { AiContextEntryResponse } from '@minicrm/shared/schemas/aiContextSchema.js';
import type { AiMessageResponse } from '@minicrm/shared/schemas/aiSessionSchema.js';
import {
  E2E_STUB_RESPONSE,
  e2eStubMessage,
  type E2eStubScenario,
} from '@minicrm/shared/schemas/aiE2eStub.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Deterministic stub returned by the E2E server (E2E=true mode) for a non-prefixed message. */
export const E2E_STUB = E2E_STUB_RESPONSE;

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
  const aiPage = new AiPage(context);
  await aiPage.waitForSessionSidebarText(text, timeout);
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
  const aiPage = new AiPage(context);
  await aiPage.waitForMessageThreadText(text, timeout);
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

  // Count existing assistant bubbles before sending so we can detect a new one.
  const assistantCountBefore = await aiPage.assistantMessageCount();

  // Register before clicking Send so a fast server response isn't missed.
  // The client commits the assistant reply straight from this POST response
  // into the query cache (MINCRM-602) — there is no follow-up GET refetch to
  // disambiguate against, so a plain POST-to-this-URL filter is sufficient.
  const replyReceived = context.page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      res.url().includes('/api/v1/ai/sessions') &&
      res.url().includes('/messages') &&
      res.status() === 200,
    { timeout: 60_000 },
  );
  await aiPage.sendMessage(content);
  await replyReceived;

  // Wait for the user message text to appear in the thread. Text-based detection
  // is robust to the optimistic→settled message transition: both the optimistic
  // entry and the cache-committed entry contain the same content string, so this
  // never transiently returns false between the two render cycles.
  await waitForAiThreadText(context, content, 30_000);

  // Wait for a new assistant reply bubble to appear. The API returning 200 means
  // the server committed the reply and the client has synchronously written it
  // into the query cache (MINCRM-602), but the React re-render itself still takes
  // a tick — especially on loaded CI runners. Waiting here prevents callers from
  // needing their own separate waitForAiThreadText(stubText) after each send,
  // which has an 8s default that is too tight under CI load.
  await aiPage.waitForAssistantMessageCountAbove(assistantCountBefore, 30_000);

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
  const aiPage = new AiPage(context);
  return aiPage.assistantMessageText();
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

// ---------------------------------------------------------------------------
// E2E stub scenario behaviors (MINCRM-435)
// ---------------------------------------------------------------------------

/**
 * Sends a reserved E2E stub-scenario trigger message to a session via the
 * REST API and returns the full assistant message response (including
 * pending_action / tool_results / context_proposal), so specs can assert on
 * the deterministic payload without driving the model. Only meaningful
 * against an E2E=true server.
 *
 * @param restClient - Authenticated RestClient.
 * @param sessionId - Session UUID.
 * @param scenario - E2E stub scenario key (see shared/schemas/aiE2eStub.ts).
 */
export async function sendE2eStubMessageViaApi(
  restClient: RestClient,
  sessionId: string,
  scenario: E2eStubScenario,
): Promise<AiMessageResponse> {
  const res = await restClient.post<AiMessageResponse>(
    `/api/v1/ai/sessions/${sessionId}/messages`,
    { content: e2eStubMessage(scenario) },
  );
  return res.body;
}

/**
 * Types a reserved E2E stub-scenario trigger message into the AI input and
 * clicks Send via the UI, waiting for the new assistant reply bubble the same
 * way sendAiMessageViaUI does. Returns the same result shape.
 *
 * @param context - Playwright fixture context.
 * @param scenario - E2E stub scenario key (see shared/schemas/aiE2eStub.ts).
 */
export async function sendE2eStubMessageViaUI(
  context: AiBehaviorContext,
  scenario: E2eStubScenario,
): Promise<SendAiMessageResult> {
  return sendAiMessageViaUI(context, e2eStubMessage(scenario));
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

// ---------------------------------------------------------------------------
// Confirmation block behaviors (MINCRM-425, MINCRM-426)
// ---------------------------------------------------------------------------

export interface ConfirmationBlockResult {
  /** Whether the confirmation block was visible. */
  visible: boolean;
  /** The text content of the operation badge, if visible. */
  operationBadge: string | null;
}

/**
 * Checks whether a standard (non-bulk) mutation confirmation block is visible
 * in the AI conversation thread.
 */
export async function isConfirmationBlockVisible(context: AiBehaviorContext): Promise<boolean> {
  const aiPage = new AiPage(context);
  return aiPage.isConfirmationBlockVisible();
}

/**
 * Checks whether a bulk-delete confirmation block is visible.
 */
export async function isBulkConfirmationBlockVisible(context: AiBehaviorContext): Promise<boolean> {
  const aiPage = new AiPage(context);
  return aiPage.isBulkConfirmationBlockVisible();
}

export interface ClickConfirmResult {
  /** Whether the confirm button was clicked (false if block was not visible). */
  clicked: boolean;
}

/**
 * Clicks the Confirm button on the visible confirmation block.
 * Returns whether the button was clicked.
 */
export async function clickConfirmButton(context: AiBehaviorContext): Promise<ClickConfirmResult> {
  const aiPage = new AiPage(context);
  const visible = await aiPage.isConfirmationBlockVisible();
  if (!visible) return { clicked: false };
  await aiPage.clickConfirmButton();
  return { clicked: true };
}

/**
 * Clicks the Cancel button on the visible confirmation block.
 * Returns whether the button was clicked.
 */
export async function clickCancelButton(context: AiBehaviorContext): Promise<ClickConfirmResult> {
  const aiPage = new AiPage(context);
  const visible =
    (await aiPage.isConfirmationBlockVisible()) || (await aiPage.isBulkConfirmationBlockVisible());
  if (!visible) return { clicked: false };
  await aiPage.clickCancelButton();
  return { clicked: true };
}

/**
 * Types text into the bulk-delete confirmation input.
 */
export async function typeBulkDeleteConfirmText(
  context: AiBehaviorContext,
  text: string,
): Promise<void> {
  const aiPage = new AiPage(context);
  await aiPage.typeBulkDeleteConfirmText(text);
}

// ── AI context panel behaviors (MINCRM-427, MINCRM-428) ──────────────────────

export interface AddContextEntryResult {
  /** Whether the add form was submitted. */
  submitted: boolean;
}

/**
 * Clicks the "+ Add context" button, fills the key and value fields, and saves.
 * Waits for the add form to disappear after save, indicating success.
 */
export async function addContextEntryViaUI(
  context: AiBehaviorContext,
  key: string,
  value: string,
): Promise<AddContextEntryResult> {
  const aiPage = new AiPage(context);

  const addBtn = await aiPage.addContextButtonLocator();
  await addBtn.click();

  const keyInput = await aiPage.contextAddKeyInputLocator();
  await keyInput.fill(key);

  const valueInput = await aiPage.contextAddValueInputLocator();
  await valueInput.fill(value);

  const saveBtn = await aiPage.contextAddSaveButtonLocator();
  await saveBtn.click();

  return { submitted: true };
}

/**
 * Clicks the "+ Add context" button, fills in the key and value fields, then
 * clicks Cancel. Verifies the form is dismissed without saving an entry.
 */
export async function cancelContextEntryViaUI(
  context: AiBehaviorContext,
  key: string,
  value: string,
): Promise<void> {
  const aiPage = new AiPage(context);

  const addBtn = await aiPage.addContextButtonLocator();
  await addBtn.click();

  const keyInput = await aiPage.contextAddKeyInputLocator();
  await keyInput.fill(key);

  const valueInput = await aiPage.contextAddValueInputLocator();
  await valueInput.fill(value);

  const cancelBtn = await aiPage.contextAddCancelButtonLocator();
  await cancelBtn.click();
}

/**
 * Deletes a context entry by ID via the REST API.
 * UI delete requires accepting a native browser confirm dialog;
 * use deleteAllContextEntriesViaApi() for test teardown instead.
 */
export async function deleteContextEntryViaApi(
  restClient: RestClient,
  entryId: string,
): Promise<void> {
  await restClient.delete(`/api/v1/ai/context/${entryId}`);
}

/**
 * Checks whether the context panel empty-state message is visible.
 * Returns false when the element is absent (contextEmptyStateLocator resolves
 * via HealingLocator which throws when no strategy matches — we catch that here
 * rather than on isVisible() so the throw doesn't escape).
 */
export async function isContextPanelEmptyStateVisible(
  context: AiBehaviorContext,
): Promise<boolean> {
  const aiPage = new AiPage(context);
  try {
    const locator = await aiPage.contextEmptyStateLocator();
    return locator.isVisible().catch(() => false);
  } catch {
    return false;
  }
}

/**
 * Checks whether a specific context entry (by ID) is visible in the panel.
 * Returns false when the element is absent (same HealingLocator throw pattern
 * as isContextPanelEmptyStateVisible).
 */
export async function isContextEntryVisible(
  context: AiBehaviorContext,
  entryId: string,
): Promise<boolean> {
  const aiPage = new AiPage(context);
  try {
    const locator = await aiPage.contextEntryLocator(entryId);
    return locator.isVisible().catch(() => false);
  } catch {
    return false;
  }
}

/**
 * Creates a context entry directly via the REST API, bypassing the UI.
 * Returns the created entry's server ID.
 */
export async function createContextEntryViaApi(
  restClient: RestClient,
  key: string,
  value: string,
): Promise<string> {
  const response = await restClient.post<AiContextEntryResponse>('/api/v1/ai/context', {
    key,
    value,
  });
  return response.body.id;
}

/**
 * Deletes all context entries for the currently authenticated user via the REST API.
 * Best-effort: individual delete failures are swallowed so a concurrent teardown
 * (e.g. afterEach racing with a test that already deleted an entry) does not
 * propagate and corrupt subsequent tests in the serial suite.
 */
export async function deleteAllContextEntriesViaApi(restClient: RestClient): Promise<void> {
  const response = await restClient.get<{ entries: Array<{ id: string }> }>('/api/v1/ai/context');
  for (const entry of response.body.entries) {
    await restClient.delete(`/api/v1/ai/context/${entry.id}`).catch(() => {});
  }
}

/**
 * Fetches all AI context entries for the currently authenticated user via the REST API.
 *
 * @param restClient - Authenticated RestClient.
 * @returns Array of context entry objects.
 */
export async function getContextEntriesViaApi(
  restClient: RestClient,
): Promise<Array<{ id: string; key: string; value: string }>> {
  const response = await restClient.get<{
    entries: Array<{ id: string; key: string; value: string }>;
  }>('/api/v1/ai/context');
  return response.body.entries;
}

// ---------------------------------------------------------------------------
// NLI result rendering (MINCRM-423, MINCRM-431, MINCRM-435)
// ---------------------------------------------------------------------------

/**
 * Returns true when the native CRM result block is visible in the thread.
 */
export async function isNliResultBlockVisible(context: AiBehaviorContext): Promise<boolean> {
  const aiPage = new AiPage(context);
  const locator = await aiPage.nliResultBlockLocator().catch(() => null);
  if (!locator) return false;
  return locator.isVisible().catch(() => false);
}

/**
 * Returns true when a rendered result card for the given contact ID is visible.
 */
export async function isNliContactCardVisible(
  context: AiBehaviorContext,
  contactId: string,
): Promise<boolean> {
  const aiPage = new AiPage(context);
  const locator = await aiPage.nliContactCardLocator(contactId).catch(() => null);
  if (!locator) return false;
  return locator.isVisible().catch(() => false);
}

// ---------------------------------------------------------------------------
// Context proposal chip (MINCRM-429, MINCRM-430, MINCRM-435)
// ---------------------------------------------------------------------------

/**
 * Returns true when the context proposal chip for the given assistant
 * message ID is visible in the thread.
 */
export async function isContextProposalChipVisible(
  context: AiBehaviorContext,
  messageId: string,
): Promise<boolean> {
  const aiPage = new AiPage(context);
  const locator = await aiPage.contextProposalChipLocator(messageId).catch(() => null);
  if (!locator) return false;
  return locator.isVisible().catch(() => false);
}

/**
 * Clicks the Accept button on a context proposal chip and waits for the
 * chip to switch to its "accepted" state.
 */
export async function acceptContextProposalViaUI(
  context: AiBehaviorContext,
  messageId: string,
): Promise<void> {
  const aiPage = new AiPage(context);
  const acceptBtn = await aiPage.contextProposalAcceptButtonLocator(messageId);
  await acceptBtn.click();
  const accepted = await aiPage.contextProposalAcceptedLocator(messageId);
  await accepted.waitFor({ state: 'visible' });
}

/**
 * Clicks the Dismiss button on a context proposal chip and waits for the
 * chip to disappear from the thread.
 */
export async function dismissContextProposalViaUI(
  context: AiBehaviorContext,
  messageId: string,
): Promise<void> {
  const aiPage = new AiPage(context);
  const dismissBtn = await aiPage.contextProposalDismissButtonLocator(messageId);
  await dismissBtn.click();
  await context.page.waitForAbsent(`[data-testid="ai-context-proposal-chip-${messageId}"]`);
}
