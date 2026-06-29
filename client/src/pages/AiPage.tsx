/**
 * AI Assistant page — two-panel layout with multi-session conversation support.
 * Left panel: conversation thread + fixed input area.
 * Right sidebar: "My Context" panel (placeholder for future context features).
 * (MINCRM-420, MINCRM-421, MINCRM-425, MINCRM-426)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import NavBar from '@/components/NavBar.js';
import NliResultBlock from '@/components/ai/results/NliResultBlock.js';
import MutationConfirmationBlock from '@/components/ai/MutationConfirmationBlock.js';
import BulkConfirmationBlock from '@/components/ai/BulkConfirmationBlock.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import {
  AI_SESSIONS_QUERY_KEY,
  aiMessagesQueryKey,
  listAiSessions,
  createAiSession,
  getAiSession,
  deleteAiSession,
  sendAiMessage,
} from '@/api/aiSessions.js';
import type { AiSessionResponse, AiMessageResponse } from '@shared/schemas/aiSessionSchema.js';

// ── Message bubble ────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: AiMessageResponse;
  isLoading?: boolean;
  /** ID of the message whose confirmation block has already been acted on (disables it). */
  disabledPendingActionId?: string | null;
  onConfirmAction?: (messageId: string) => void;
  onCancelAction?: (messageId: string) => void;
  /** Typed text for the bulk-delete double-confirm input, keyed by message ID. */
  bulkDeleteConfirmText?: string;
  onBulkDeleteConfirmTextChange?: (messageId: string, value: string) => void;
}

function MessageBubble({
  message,
  isLoading = false,
  disabledPendingActionId,
  onConfirmAction,
  onCancelAction,
  bulkDeleteConfirmText = '',
  onBulkDeleteConfirmTextChange,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const hasToolResults =
    !isUser &&
    message.tool_results !== null &&
    message.tool_results !== undefined &&
    message.tool_results.length > 0;

  const hasPendingAction = !isUser && message.pending_action != null;
  const isActionDisabled = disabledPendingActionId === message.id;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isUser ? '' : 'w-full'}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed break-words ${
            isUser
              ? 'bg-primary-600 text-white rounded-ee-sm'
              : 'bg-white border border-gray-200 text-gray-800 rounded-es-sm shadow-sm'
          }`}
          role="article"
          aria-label={isUser ? t('ai.userRole') : t('ai.assistantRole')}
          data-testid={`ai-message-${message.role}`}
        >
          {message.content}
          {hasToolResults && (
            <NliResultBlock toolResults={message.tool_results!} isLoading={isLoading} />
          )}
          {/* Confirmation block for pending mutation actions (MINCRM-425, MINCRM-426) */}
          {hasPendingAction &&
            // Non-null assertion safe: hasPendingAction guard above confirms this is non-null
            (message.pending_action!.isBulkDelete ? (
              <BulkConfirmationBlock
                pendingAction={message.pending_action!}
                onConfirm={() => onConfirmAction?.(message.id)}
                onCancel={() => onCancelAction?.(message.id)}
                isDisabled={isActionDisabled}
                confirmText={bulkDeleteConfirmText}
                onConfirmTextChange={(value) => onBulkDeleteConfirmTextChange?.(message.id, value)}
              />
            ) : (
              <MutationConfirmationBlock
                pendingAction={message.pending_action!}
                onConfirm={() => onConfirmAction?.(message.id)}
                onCancel={() => onCancelAction?.(message.id)}
                isDisabled={isActionDisabled}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

// ── Session list item ─────────────────────────────────────────────────────────

interface SessionItemProps {
  session: AiSessionResponse;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

function SessionItem({ session, isActive, onSelect, onDelete, isDeleting }: SessionItemProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`group flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
        isActive
          ? 'bg-primary-50 text-primary-700'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      }`}
      onClick={() => onSelect(session.id)}
      data-testid={`ai-session-item-${session.id}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(session.id);
      }}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className="flex-1 min-w-0 truncate">{session.name ?? t('ai.newSessionLabel')}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(session.id);
        }}
        disabled={isDeleting}
        aria-label={t('ai.deleteSession')}
        data-testid={`ai-session-delete-${session.id}`}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex-shrink-0 p-1 rounded text-gray-400 hover:text-red-500 transition-opacity disabled:opacity-40"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a1 1 0 011-1h4a1 1 0 011 1m-6 0h6"
          />
        </svg>
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AiPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { enabled: featureEnabled, isLoading: featureFlagLoading } = useFeatureFlag('ai_nli_page');

  // Explicit user-chosen session. When null, falls back to the first available session
  // from the sessions list (purely derived — no effect or ref needed).
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<AiMessageResponse[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ── Confirmation block state (MINCRM-425, MINCRM-426) ───────────────────────

  // The ID of the message whose confirmation block was last acted on (confirm/cancel).
  // That block becomes disabled/greyed-out while the follow-up AI turn is in flight.
  const [disabledPendingActionId, setDisabledPendingActionId] = useState<string | null>(null);

  // Typed text for bulk-delete double-confirm, keyed by message ID.
  // Stored as a map so that if multiple messages in the thread had pending bulk deletes,
  // each has independent input state (though in practice only one is active at a time).
  const [bulkDeleteConfirmTexts, setBulkDeleteConfirmTexts] = useState<Record<string, string>>({});

  const threadEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Sessions list ────────────────────────────────────────────────────────────

  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    error: sessionsError,
  } = useQuery({
    queryKey: AI_SESSIONS_QUERY_KEY,
    queryFn: listAiSessions,
    enabled: featureEnabled,
  });

  // Pure derivation — no side effects. When the user has not explicitly chosen a
  // session, fall back to the first session returned by the query. The user's
  // explicit choice (setActiveSessionId) always takes priority and is retained
  // across re-renders without any synchronisation needed.
  const resolvedSessionId: string | null = activeSessionId ?? sessions[0]?.id ?? null;

  // ── Active session messages ──────────────────────────────────────────────────

  const {
    data: activeSession,
    isLoading: sessionLoading,
    error: sessionError,
  } = useQuery({
    queryKey: resolvedSessionId ? aiMessagesQueryKey(resolvedSessionId) : ['ai_session_none'],
    queryFn: () => (resolvedSessionId ? getAiSession(resolvedSessionId) : null),
    enabled: !!resolvedSessionId && featureEnabled,
  });

  const persistedMessages = activeSession?.messages ?? [];

  // Merge persisted + optimistic (optimistic cleared when query refreshes)
  const allMessages = [...persistedMessages, ...optimisticMessages];

  // Auto-scroll to thread bottom when new messages arrive
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages.length]);

  // ── Create session mutation ──────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: createAiSession,
    onSuccess: (newSession) => {
      void queryClient.invalidateQueries({ queryKey: AI_SESSIONS_QUERY_KEY });
      setActiveSessionId(newSession.id);
      setOptimisticMessages([]);
      setSendError(null);
      textareaRef.current?.focus();
    },
  });

  // ── Delete session mutation ──────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteAiSession(sessionId),
    onSuccess: (_, deletedId) => {
      void queryClient.invalidateQueries({ queryKey: AI_SESSIONS_QUERY_KEY });
      if (resolvedSessionId === deletedId) {
        // Select a different session or clear
        const remaining = sessions.filter((s) => s.id !== deletedId);
        setActiveSessionId(remaining[0]?.id ?? null);
        setOptimisticMessages([]);
      }
      setDeleteConfirmId(null);
    },
  });

  // ── Send message mutation ────────────────────────────────────────────────────

  const sendMutation = useMutation({
    mutationFn: async ({ sessionId, content }: { sessionId: string; content: string }) => {
      return sendAiMessage(sessionId, content);
    },
    onSuccess: async (assistantMessage, { sessionId, content }) => {
      setSendError(null);
      void queryClient.invalidateQueries({ queryKey: AI_SESSIONS_QUERY_KEY });
      // Use sessionId from mutation variables (not resolvedSessionId from the closure)
      // so the correct session is refetched even if the user switched sessions during
      // the 3-10 s Anthropic round-trip.
      //
      // Only show optimistic messages if the user is still viewing the session that
      // sent the message — if they've switched away, just update the cache silently.
      if (resolvedSessionId === sessionId) {
        const optimisticUserMessage: AiMessageResponse = {
          id: `optimistic-user-settled`,
          session_id: sessionId,
          role: 'user',
          content,
          tool_results: null,
          pending_action: null,
          created_at: new Date().toISOString(),
        };
        setOptimisticMessages([optimisticUserMessage, assistantMessage]);
      }
      await queryClient.refetchQueries({ queryKey: aiMessagesQueryKey(sessionId) });
      // Guard: only clear optimistic state for the session that settled.
      // Without this, session A's onSuccess would clear session B's in-flight bubble
      // if the user switched sessions during the Anthropic round-trip.
      if (resolvedSessionId === sessionId) {
        setOptimisticMessages([]);
      }
    },
    onError: () => {
      setOptimisticMessages([]);
      setSendError(t('ai.errorSend'));
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleNewSession = useCallback(() => {
    createMutation.mutate();
  }, [createMutation]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      // Compare against resolvedSessionId (not activeSessionId) to avoid
      // clearing optimistic state when clicking the already-active first session
      // before activeSessionId has been set from the sessions list.
      if (sessionId !== resolvedSessionId) {
        setActiveSessionId(sessionId);
        setOptimisticMessages([]);
        setSendError(null);
      }
    },
    [resolvedSessionId],
  );

  const handleDeleteSession = useCallback((sessionId: string) => {
    setDeleteConfirmId(sessionId);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (deleteConfirmId) {
      deleteMutation.mutate(deleteConfirmId);
    }
  }, [deleteConfirmId, deleteMutation]);

  // ── Mutation confirmation handlers (MINCRM-425, MINCRM-426) ─────────────────

  /**
   * Called when the user clicks "Confirm" on a pending-action block.
   * Marks the block as disabled, then sends "Yes, go ahead." as the next user
   * message so the AI proceeds with the write tool.
   */
  const handleConfirmAction = useCallback(
    (messageId: string) => {
      if (!resolvedSessionId || sendMutation.isPending) return;
      setDisabledPendingActionId(messageId);
      // Clear the bulk-delete text for this message (updater form — safe in StrictMode)
      setBulkDeleteConfirmTexts((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      sendMutation.mutate({ sessionId: resolvedSessionId, content: 'Yes, go ahead.' });
    },
    [resolvedSessionId, sendMutation],
  );

  /**
   * Called when the user clicks "Cancel" on a pending-action block.
   * Marks the block as disabled, then sends "No, cancel that." so the AI aborts.
   */
  const handleCancelAction = useCallback(
    (messageId: string) => {
      if (!resolvedSessionId || sendMutation.isPending) return;
      setDisabledPendingActionId(messageId);
      sendMutation.mutate({ sessionId: resolvedSessionId, content: 'No, cancel that.' });
    },
    [resolvedSessionId, sendMutation],
  );

  /**
   * Tracks the typed text in the bulk-delete double-confirm input.
   * Updater form avoids stale-closure issues (safe in StrictMode — no side effects).
   */
  const handleBulkDeleteConfirmTextChange = useCallback((messageId: string, value: string) => {
    setBulkDeleteConfirmTexts((prev) => ({ ...prev, [messageId]: value }));
  }, []);

  const handleSend = useCallback(async () => {
    const content = inputValue.trim();
    if (!content || sendMutation.isPending) return;

    let sessionId = resolvedSessionId;

    // Create a session on-demand if none exists yet
    if (!sessionId) {
      try {
        const newSession = await createMutation.mutateAsync();
        sessionId = newSession.id;
      } catch {
        setSendError(t('ai.errorCreateSession'));
        return;
      }
    }

    setInputValue('');
    setSendError(null);

    // Add optimistic user message immediately.
    // sessionId is guaranteed non-null here: either it was non-null at the top of the function,
    // or we just assigned it from createMutation (and returned early if that failed).
    const resolvedId = sessionId!; // non-null safe: see comment above

    const optimisticUserMessage: AiMessageResponse = {
      id: `optimistic-user-${Date.now()}`,
      session_id: resolvedId,
      role: 'user',
      content,
      tool_results: null,
      pending_action: null,
      created_at: new Date().toISOString(),
    };
    setOptimisticMessages([optimisticUserMessage]);

    sendMutation.mutate({ sessionId: resolvedId, content });
  }, [inputValue, resolvedSessionId, sendMutation, createMutation, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  // ── Feature flag guard ───────────────────────────────────────────────────────

  if (featureFlagLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400 text-sm">{t('common.loading')}</div>
        </div>
      </div>
    );
  }

  if (!featureEnabled) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500 text-sm">{t('ai.notAvailable')}</p>
        </div>
      </div>
    );
  }

  // ── Delete confirm modal ─────────────────────────────────────────────────────

  const activeSessionName = sessions.find((s) => s.id === deleteConfirmId)?.name;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <NavBar />

      {/* Delete confirmation modal */}
      {deleteConfirmId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
          data-testid="ai-delete-confirm-modal"
        >
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h2 id="delete-confirm-title" className="text-base font-semibold text-gray-900 mb-2">
              {t('ai.confirmDeleteTitle')}
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              {activeSessionName ? `"${activeSessionName}" — ` : ''}
              {t('ai.confirmDeleteBody')}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                disabled={deleteMutation.isPending}
                data-testid="ai-delete-cancel-button"
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
                data-testid="ai-delete-confirm-button"
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? t('common.deleting') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 gap-6">
        {/* ── Session sidebar ────────────────────────────────────────────── */}
        <aside
          className="hidden md:flex flex-col w-56 flex-shrink-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
          aria-label={t('ai.sessionListLabel')}
          data-testid="ai-session-sidebar"
        >
          <div className="px-3 py-3 border-b border-gray-100">
            <button
              type="button"
              onClick={handleNewSession}
              disabled={createMutation.isPending}
              data-testid="ai-new-session-button"
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {t('ai.newSession')}
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
            {sessionsLoading && (
              <div className="space-y-1 p-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-8 bg-gray-100 rounded animate-pulse"
                    aria-hidden="true"
                  />
                ))}
              </div>
            )}
            {sessionsError && (
              <p className="px-3 py-2 text-xs text-red-600">{t('ai.errorLoadSessions')}</p>
            )}
            {!sessionsLoading && sessions.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">{t('ai.newSessionLabel')}</p>
            )}
            {sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === resolvedSessionId}
                onSelect={handleSelectSession}
                onDelete={handleDeleteSession}
                isDeleting={deleteMutation.isPending && deleteConfirmId === session.id}
              />
            ))}
          </nav>
        </aside>

        {/* ── Main conversation panel ────────────────────────────────────── */}
        <main
          className="flex flex-col flex-1 min-w-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
          data-testid="ai-conversation-panel"
        >
          {/* Thread header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
            <h1 className="text-sm font-semibold text-gray-900 truncate min-w-0">
              {activeSession?.name ??
                sessions.find((s) => s.id === activeSessionId)?.name ??
                t('ai.pageTitle')}
            </h1>
            {/* Mobile: new session button */}
            <button
              type="button"
              onClick={handleNewSession}
              disabled={createMutation.isPending}
              data-testid="ai-new-session-button-mobile"
              className="md:hidden flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-700 border border-primary-300 rounded-lg hover:bg-primary-50 transition-colors disabled:opacity-50"
            >
              {t('ai.newSession')}
            </button>
          </div>

          {/* Message thread — scrollable */}
          <div
            className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
            aria-live="polite"
            aria-label={t('ai.pageTitle')}
            data-testid="ai-message-thread"
          >
            {sessionLoading && (
              <div className="flex items-center justify-center h-16">
                <div className="text-gray-400 text-sm">{t('common.loading')}</div>
              </div>
            )}
            {sessionError && (
              <div className="flex items-center justify-center h-16">
                <p className="text-red-600 text-sm">{t('ai.errorLoad')}</p>
              </div>
            )}
            {!sessionLoading && !sessionError && allMessages.length === 0 && (
              <div
                className="flex flex-col items-center justify-center h-full py-16 text-center"
                data-testid="ai-empty-state"
              >
                <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mb-3">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6 text-primary-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                    />
                  </svg>
                </div>
                <h2 className="text-sm font-medium text-gray-900 mb-1">
                  {t('ai.emptyStateTitle')}
                </h2>
                <p className="text-xs text-gray-500 max-w-xs">{t('ai.emptyStateBody')}</p>
              </div>
            )}
            {allMessages.map((msg, idx) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isLoading={
                  sendMutation.isPending &&
                  idx === allMessages.length - 1 &&
                  msg.role === 'assistant'
                }
                disabledPendingActionId={disabledPendingActionId}
                onConfirmAction={handleConfirmAction}
                onCancelAction={handleCancelAction}
                bulkDeleteConfirmText={bulkDeleteConfirmTexts[msg.id] ?? ''}
                onBulkDeleteConfirmTextChange={handleBulkDeleteConfirmTextChange}
              />
            ))}
            {/* Pending assistant indicator */}
            {sendMutation.isPending &&
              optimisticMessages.length === 1 &&
              optimisticMessages[0].role === 'user' && (
                <div
                  className="flex justify-start"
                  aria-label={t('ai.sending')}
                  data-testid="ai-thinking-indicator"
                >
                  <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                    <span className="flex gap-1 items-center">
                      {[0, 150, 300].map((delay) => (
                        <span
                          key={delay}
                          className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                          style={{ animationDelay: `${delay}ms` }}
                          aria-hidden="true"
                        />
                      ))}
                    </span>
                  </div>
                </div>
              )}
            <div ref={threadEndRef} />
          </div>

          {/* Error banner */}
          {sendError && (
            <div
              className="px-4 py-2 text-xs text-red-700 bg-red-50 border-t border-red-100"
              role="alert"
              data-testid="ai-send-error"
            >
              {sendError}
            </div>
          )}

          {/* Input area — fixed at thread bottom */}
          <div className="px-4 py-3 border-t border-gray-100 flex-shrink-0 bg-white">
            <div className="flex gap-2 items-end">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('ai.messagePlaceholder')}
                disabled={sendMutation.isPending || createMutation.isPending}
                rows={1}
                data-testid="ai-message-input"
                aria-label={t('ai.messagePlaceholder')}
                className="flex-1 min-w-0 resize-none rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 max-h-40 overflow-y-auto"
                style={{
                  // fieldSizing is a draft CSS property not yet in TS CSSProperties lib
                  fieldSizing: 'content' as React.CSSProperties['fieldSizing'],
                  minHeight: '2.5rem',
                }}
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!inputValue.trim() || sendMutation.isPending || createMutation.isPending}
                data-testid="ai-send-button"
                aria-label={t('ai.sendButton')}
                className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sendMutation.isPending ? (
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 22 6.477 22 12h-4z"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                )}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-gray-400 text-end">{t('ai.sendShortcutHint')}</p>
          </div>
        </main>

        {/* ── Context sidebar ────────────────────────────────────────────── */}
        <aside
          className="hidden lg:flex flex-col w-64 flex-shrink-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
          aria-label={t('ai.myContext')}
          data-testid="ai-context-panel"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">{t('ai.myContext')}</h2>
            <button
              type="button"
              data-testid="ai-add-context-button"
              aria-label={t('ai.addContext')}
              className="text-xs text-primary-600 font-medium hover:text-primary-700"
            >
              {t('ai.addContext')}
            </button>
          </div>
          <div className="flex-1 px-4 py-4">
            <p className="text-xs text-gray-400 text-center mt-8">{t('ai.emptyStateBody')}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
