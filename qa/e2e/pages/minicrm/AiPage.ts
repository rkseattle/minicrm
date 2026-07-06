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

  /** Returns the New Session button (desktop sidebar). */
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

  /** Returns the mobile New Session button (shown in the conversation header on narrow viewports). */
  async newSessionButtonMobileLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-new-session-button-mobile' },
          { type: 'role', value: 'button', options: { name: /new session/i } },
        ],
        { intent: 'AI new conversation session button (mobile header)' },
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

  /** Waits until the session sidebar contains the given text. */
  async waitForSessionSidebarText(text: string, timeout = 8_000): Promise<void> {
    await this.page.waitForTextContent('[data-testid="ai-session-sidebar"]', text, timeout);
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

  /** Waits until the message thread contains the given text. */
  async waitForMessageThreadText(text: string, timeout = 8_000): Promise<void> {
    await this.page.waitForTextContent('[data-testid="ai-message-thread"]', text, timeout);
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

  /** Returns the number of assistant message bubbles currently in the thread. */
  async assistantMessageCount(): Promise<number> {
    return this.page.count(
      [
        { type: 'testId', value: 'ai-message-assistant' },
        { type: 'css', value: '[data-testid="ai-message-assistant"]' },
      ],
      { intent: 'AI assistant reply message bubbles' },
    );
  }

  /**
   * Waits until the number of assistant message bubbles exceeds `countBefore`.
   * Use after sending a message to detect the new reply bubble committing to the DOM.
   */
  async waitForAssistantMessageCountAbove(countBefore: number, timeout = 30_000): Promise<void> {
    await this.page.waitForCountAbove('[data-testid="ai-message-assistant"]', countBefore, timeout);
  }

  /** Returns the text content of the first assistant message bubble, or null if none exists. */
  async assistantMessageText(): Promise<string | null> {
    const locator = await this.assistantMessageLocator().catch(() => null);
    if (!locator) return null;
    return locator.textContent();
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

  /** Clicks the New Session button, choosing mobile or desktop variant by viewport width. */
  async clickNewSession(): Promise<void> {
    const isMobile = (this.page.viewportSize()?.width ?? 1280) < 768;
    const btn = isMobile
      ? await this.newSessionButtonMobileLocator()
      : await this.newSessionButtonLocator();
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

  // ── Mutation confirmation block locators (MINCRM-425, MINCRM-426) ─────────

  /** Locates the standard mutation confirmation block. */
  async confirmationBlockLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nli-confirmation-block' },
          { type: 'css', value: '[data-testid="nli-confirmation-block"]' },
        ],
        { intent: 'AI mutation confirmation block for pending write action' },
      )
      .resolve();
  }

  /** Locates the bulk-delete confirmation block. */
  async bulkConfirmationBlockLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nli-bulk-confirmation-block' },
          { type: 'css', value: '[data-testid="nli-bulk-confirmation-block"]' },
        ],
        { intent: 'AI bulk delete confirmation block with double-confirm gate' },
      )
      .resolve();
  }

  /** Locates the Confirm button inside either confirmation block. */
  async confirmButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nli-confirm-button' },
          { type: 'role', value: 'button', options: { name: /confirm/i } },
        ],
        { intent: 'Confirm button in AI mutation confirmation block' },
      )
      .resolve();
  }

  /** Locates the Cancel button inside either confirmation block. */
  async cancelButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nli-cancel-button' },
          { type: 'role', value: 'button', options: { name: /cancel/i } },
        ],
        { intent: 'Cancel button in AI mutation confirmation block' },
      )
      .resolve();
  }

  /** Locates the bulk-delete text input. */
  async bulkDeleteConfirmInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nli-bulk-delete-confirm-input' },
          { type: 'role', value: 'textbox' },
        ],
        { intent: 'Bulk delete double-confirm text input in AI confirmation block' },
      )
      .resolve();
  }

  /**
   * Polls count() (bypasses the healing locator's AI-healer fallback — a
   * count is legitimately allowed to be zero, resolve() is not) for up to
   * `timeoutMs`, short-circuiting the moment it sees a nonzero count. Used
   * as a cheap presence probe before paying for full resolve()+isVisible():
   * a genuinely-absent element still returns fast (no healer round-trip),
   * while an element that renders a beat after the probe starts still has a
   * chance to be caught, unlike a single instant count() snapshot.
   */
  private async pollForNonZeroCount(
    strategies: Parameters<PageFacade['count']>[0],
    options: Parameters<PageFacade['count']>[1],
    timeoutMs = 3_000,
  ): Promise<boolean> {
    const pollIntervalMs = 100;
    const deadline = Date.now() + timeoutMs;
    do {
      if ((await this.page.count(strategies, options)) > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } while (Date.now() < deadline);
    return false;
  }

  /**
   * Returns true when a standard confirmation block is visible in the thread.
   *
   * In E2E-stub mode this block never renders (the stub reply never sets
   * pending_action), so this is checked on every "normal" AI turn as a
   * negative assertion — pollForNonZeroCount() keeps that common case fast
   * (no AI-healer round-trip) while still giving a real positive case a
   * short window to render before falling through to full resolve()+isVisible().
   */
  async isConfirmationBlockVisible(): Promise<boolean> {
    const strategies = [
      { type: 'testId' as const, value: 'nli-confirmation-block' },
      { type: 'css' as const, value: '[data-testid="nli-confirmation-block"]' },
    ];
    const options = { intent: 'AI mutation confirmation block for pending write action' };
    if (!(await this.pollForNonZeroCount(strategies, options))) return false;
    const locator = await this.page
      .locate(strategies, { intent: 'AI mutation confirmation block for pending write action' })
      .resolve()
      .catch(() => null);
    if (!locator) return false;
    return locator.isVisible().catch(() => false);
  }

  /**
   * Returns true when a bulk-delete confirmation block is visible in the thread.
   * See isConfirmationBlockVisible() for why count() is polled before resolve().
   */
  async isBulkConfirmationBlockVisible(): Promise<boolean> {
    const strategies = [
      { type: 'testId' as const, value: 'nli-bulk-confirmation-block' },
      { type: 'css' as const, value: '[data-testid="nli-bulk-confirmation-block"]' },
    ];
    const options = { intent: 'AI bulk delete confirmation block with double-confirm gate' };
    if (!(await this.pollForNonZeroCount(strategies, options))) return false;
    const locator = await this.page
      .locate(strategies, {
        intent: 'AI bulk delete confirmation block with double-confirm gate',
      })
      .resolve()
      .catch(() => null);
    if (!locator) return false;
    return locator.isVisible().catch(() => false);
  }

  /** Clicks the Confirm button in the confirmation block. */
  async clickConfirmButton(): Promise<void> {
    const btn = await this.confirmButtonLocator();
    await btn.click();
  }

  /** Clicks the Cancel button in the confirmation block. */
  async clickCancelButton(): Promise<void> {
    const btn = await this.cancelButtonLocator();
    await btn.click();
  }

  /** Types into the bulk-delete confirmation input. */
  async typeBulkDeleteConfirmText(text: string): Promise<void> {
    const input = await this.bulkDeleteConfirmInputLocator();
    await input.fill(text);
  }

  // ── Context panel interactions (MINCRM-427, MINCRM-428) ───────────────────

  /** Returns the context panel empty-state message. */
  async contextEmptyStateLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-context-empty' },
          { type: 'css', value: '[data-testid="ai-context-empty"]' },
        ],
        { intent: 'context panel empty state message' },
      )
      .resolve();
  }

  /** Returns the context entry list container. */
  async contextListLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-context-list' },
          { type: 'css', value: '[data-testid="ai-context-list"]' },
        ],
        { intent: 'context panel list of entries' },
      )
      .resolve();
  }

  /** Returns a specific context entry row by its server-assigned ID. */
  async contextEntryLocator(entryId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `ai-context-entry-${entryId}` },
          { type: 'css', value: `[data-testid="ai-context-entry-${entryId}"]` },
        ],
        { intent: `context entry row for id ${entryId}` },
      )
      .resolve();
  }

  /** Returns the add form key input. */
  async contextAddKeyInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-context-add-key' },
          { type: 'role', value: 'textbox', options: { name: /label/i } },
        ],
        { intent: 'context add form key input' },
      )
      .resolve();
  }

  /** Returns the add form value input. */
  async contextAddValueInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-context-add-value' },
          { type: 'role', value: 'textbox', options: { name: /meaning/i } },
        ],
        { intent: 'context add form value input' },
      )
      .resolve();
  }

  /** Returns the add form save button. */
  async contextAddSaveButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-context-add-save' },
          { type: 'role', value: 'button', options: { name: /save/i } },
        ],
        { intent: 'context add form save button' },
      )
      .resolve();
  }

  /** Returns the add form cancel button. */
  async contextAddCancelButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'ai-context-add-cancel' },
          { type: 'role', value: 'button', options: { name: /cancel/i } },
        ],
        { intent: 'context add form cancel button' },
      )
      .resolve();
  }

  /** Returns the edit button for a specific context entry. */
  async contextEditButtonLocator(entryId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `ai-context-edit-button-${entryId}` },
          { type: 'css', value: `[data-testid="ai-context-edit-button-${entryId}"]` },
        ],
        { intent: `edit button for context entry ${entryId}` },
      )
      .resolve();
  }

  /** Returns the delete button for a specific context entry. */
  async contextDeleteButtonLocator(entryId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `ai-context-delete-button-${entryId}` },
          { type: 'css', value: `[data-testid="ai-context-delete-button-${entryId}"]` },
        ],
        { intent: `delete button for context entry ${entryId}` },
      )
      .resolve();
  }
}
