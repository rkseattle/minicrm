/**
 * AiPage — Page Object for the MiniCRM AI Assistant page (/ai).
 *
 * Encapsulates all locator resolution for the two-panel AI conversation layout:
 * session sidebar, message thread, context panel, and input controls.
 *
 * MINCRM-420, MINCRM-421
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Context required by AiPage. */
export interface AiPageContext {
  page: PageFacade;
}

/**
 * Page Object for the /ai route.
 *
 * Does NOT navigate — callers navigate to /ai first.
 * Every public method resolves a locator or performs an interaction.
 * No assertions, no business logic.
 */
export class AiPage {
  private readonly page: PageFacade;

  constructor(context: AiPageContext) {
    this.page = context.page;
  }

  /** Returns the main conversation panel. */
  async conversationPanelLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-conversation-panel' },
          { type: 'css', value: '[data-testid="ai-conversation-panel"]' },
        ],
        { intent: 'main AI conversation thread panel' },
      )
      .resolve();
  }

  /** Returns the context sidebar panel. */
  async contextPanelLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-context-panel' },
          { type: 'css', value: '[data-testid="ai-context-panel"]' },
        ],
        { intent: 'AI context/suggestions sidebar panel' },
      )
      .resolve();
  }

  /** Returns the message input textarea. */
  async messageInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-message-input' },
          { type: 'role', value: 'textbox', options: { name: /message/i } },
        ],
        { intent: 'AI message composition textarea' },
      )
      .resolve();
  }

  /** Returns the Send button. */
  async sendButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-send-button' },
          { type: 'role', value: 'button', options: { name: /send/i } },
        ],
        { intent: 'AI send message button' },
      )
      .resolve();
  }

  /** Returns the Add Context button in the context sidebar. */
  async addContextButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-add-context-button' },
          { type: 'role', value: 'button', options: { name: /add context/i } },
        ],
        { intent: 'AI add context button in context sidebar' },
      )
      .resolve();
  }

  /** Returns the empty-state message element. Null if not present. */
  async emptyStateLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-empty-state' },
          { type: 'css', value: '[data-testid="ai-empty-state"]' },
        ],
        { intent: 'AI conversation empty-state message when no messages exist' },
      )
      .resolve()
      .catch(() => null);
  }

  /** Returns the New Session button. */
  async newSessionButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-new-session-button' },
          { type: 'role', value: 'button', options: { name: /new session/i } },
        ],
        { intent: 'AI new conversation session button' },
      )
      .resolve();
  }

  /** Returns the session sidebar container. */
  async sessionSidebarLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-session-sidebar' },
          { type: 'css', value: '[data-testid="ai-session-sidebar"]' },
        ],
        { intent: 'AI session list sidebar' },
      )
      .resolve();
  }

  /** Returns the message thread container. */
  async messageThreadLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-message-thread' },
          { type: 'css', value: '[data-testid="ai-message-thread"]' },
        ],
        { intent: 'AI message thread scrollable container' },
      )
      .resolve();
  }

  /** Returns the first visible user message bubble. */
  async userMessageLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-message-user' },
          { type: 'css', value: '[data-testid="ai-message-user"]' },
        ],
        { intent: 'AI user turn message bubble' },
      )
      .resolve();
  }

  /** Returns the first visible assistant message bubble. */
  async assistantMessageLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-message-assistant' },
          { type: 'css', value: '[data-testid="ai-message-assistant"]' },
        ],
        { intent: 'AI assistant reply message bubble' },
      )
      .resolve();
  }

  /** Returns the session list item for a specific session ID. */
  async sessionItemLocator(sessionId: string) {
    await this.page.waitForPresent(`[data-testid="ai-session-item-${sessionId}"]`);
    return this.page
      .locate(
        [
          { type: 'testId', value: `ai-session-item-${sessionId}` },
          { type: 'css', value: `[data-testid="ai-session-item-${sessionId}"]` },
        ],
        { intent: `AI session list item for session ${sessionId}` },
      )
      .resolve();
  }

  /** Returns the delete button for a specific session ID. */
  async sessionDeleteButtonLocator(sessionId: string) {
    await this.page.waitForPresent(`[data-testid="ai-session-delete-${sessionId}"]`);
    return this.page
      .locate(
        [
          { type: 'testId', value: `ai-session-delete-${sessionId}` },
          { type: 'css', value: `[data-testid="ai-session-delete-${sessionId}"]` },
        ],
        { intent: `AI session delete button for session ${sessionId}` },
      )
      .resolve();
  }

  /** Returns the delete confirmation modal. */
  async deleteConfirmModalLocator() {
    await this.page.waitForPresent('[data-testid="ai-delete-confirm-modal"]');
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-delete-confirm-modal' },
          { type: 'role', value: 'dialog' },
        ],
        { intent: 'AI session delete confirmation modal' },
      )
      .resolve();
  }

  /** Returns the confirm button inside the delete modal. */
  async deleteConfirmButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-delete-confirm-button' },
          { type: 'role', value: 'button', options: { name: /delete/i } },
        ],
        { intent: 'AI delete confirmation confirm button' },
      )
      .resolve();
  }

  /** Returns the nav link for the AI page. Null if not present (flag disabled or mobile layout). */
  async navLinkLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nav-top-ai' },
          { type: 'css', value: '[data-testid="nav-top-ai"]' },
        ],
        { intent: 'AI assistant navigation link in top nav' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Types the given message into the input and clicks Send.
   * Does NOT wait for the reply — callers assert on subsequent state.
   */
  async sendMessage(content: string): Promise<void> {
    const input = await this.messageInputLocator();
    await input.fill(content);
    const sendBtn = await this.sendButtonLocator();
    await sendBtn.click();
  }

  /** Clicks the New Session button. */
  async clickNewSession(): Promise<void> {
    const btn = await this.newSessionButtonLocator();
    await btn.click();
  }

  /**
   * Clicks a session item in the sidebar to switch to that session.
   * Waits for the item to be present before clicking.
   */
  async clickSessionItem(sessionId: string): Promise<void> {
    const item = await this.sessionItemLocator(sessionId);
    await item.click();
  }

  /**
   * Hovers a session item to reveal the delete button, then clicks it.
   * Waits for the item and delete button to be present.
   */
  async initiateDeleteSession(sessionId: string): Promise<void> {
    const item = await this.sessionItemLocator(sessionId);
    await item.hover();
    const deleteBtn = await this.sessionDeleteButtonLocator(sessionId);
    await deleteBtn.click();
  }

  /** Confirms the delete modal by clicking the confirm button. */
  async confirmDeleteSession(): Promise<void> {
    const confirmBtn = await this.deleteConfirmButtonLocator();
    await confirmBtn.click();
  }
}
