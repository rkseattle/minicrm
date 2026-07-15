/**
 * AI Assistant page — two-panel layout with multi-session conversation support.
 * Left panel: conversation thread + fixed input area.
 * Right sidebar: "My Context" panel with user-managed key/value preferences.
 * (MINCRM-420, MINCRM-421, MINCRM-425, MINCRM-426, MINCRM-427, MINCRM-428, MINCRM-429, MINCRM-430)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import NavBar from '@/components/NavBar.js';
import NliResultBlock from '@/components/ai/results/NliResultBlock.js';
import MutationConfirmationBlock from '@/components/ai/MutationConfirmationBlock.js';
import BulkConfirmationBlock from '@/components/ai/BulkConfirmationBlock.js';
import ContextPanel from '@/components/ai/ContextPanel.js';
import ContextProposalChip from '@/components/ai/ContextProposalChip.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import { useVisualViewportHeight } from '@/hooks/useVisualViewportHeight.js';
import {
  AI_SESSIONS_QUERY_KEY,
  aiMessagesQueryKey,
  listAiSessions,
  createAiSession,
  getAiSession,
  deleteAiSession,
  sendAiMessage,
} from '@/api/aiSessions.js';
import { getMyRetentionWindow, MY_RETENTION_WINDOW_QUERY_KEY } from '@/api/ai.js';
import type {
  AiSessionResponse,
  AiMessageResponse,
  AiSessionWithMessagesResponse,
} from '@shared/schemas/aiSessionSchema.js';

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
  /** Whether this message's context proposal has been dismissed for this session. */
  isProposalDismissed?: boolean;
  onProposalDismiss?: (messageId: string) => void;
}

function MessageBubble({
  message,
  isLoading = false,
  disabledPendingActionId,
  onConfirmAction,
  onCancelAction,
  bulkDeleteConfirmText = '',
  onBulkDeleteConfirmTextChange,
  isProposalDismissed = false,
  onProposalDismiss,
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
  const hasProposal = !isUser && message.context_proposal != null && !isProposalDismissed;

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
          {isUser ? (
            message.content
          ) : (
            <div className="ai-markdown">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  ul: ({ children }) => (
                    <ul className="list-disc ps-5 mb-2 last:mb-0 space-y-0.5">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal ps-5 mb-2 last:mb-0 space-y-0.5">{children}</ol>
                  ),
                  li: ({ children }) => <li>{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  a: ({ children, href }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 underline hover:text-primary-700"
                      data-testid={`ai-message-markdown-link-${message.id}`}
                    >
                      {children}
                    </a>
                  ),
                  code: ({ children }) => (
                    <code className="bg-gray-100 rounded px-1 py-0.5 text-xs">{children}</code>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
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
          {/* Context proposal chip (MINCRM-429, MINCRM-430) */}
          {hasProposal && (
            // Non-null assertion safe: hasProposal guard above confirms context_proposal is non-null
            <ContextProposalChip
              messageId={message.id}
              proposal={message.context_proposal!}
              onDismiss={onProposalDismiss ?? (() => undefined)}
            />
          )}
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
  const visualViewportHeight = useVisualViewportHeight();

  // Retention window notice (MINCRM-462) — only fetched once the feature is enabled,
  // since the endpoint is gated by the same flag.
  const { data: retentionWindow } = useQuery({
    queryKey: MY_RETENTION_WINDOW_QUERY_KEY,
    queryFn: getMyRetentionWindow,
    enabled: featureEnabled,
  });

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

  // ── Context proposal dismiss state (MINCRM-429, MINCRM-430) ─────────────────

  // Session-scoped set of message IDs whose context proposal chip has been dismissed.
  // A Set stored in a ref-stable updater pattern.
  const [dismissedProposalIds, setDismissedProposalIds] = useState<Set<string>>(new Set());

  const threadEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Session IDs created via the on-demand path (handleSend creating a session
  // because none existed yet) whose messages cache entry was seeded directly
  // by createMutation.onSuccess and must not be overwritten by the messages
  // query's own first-mount GET. See the messages useQuery's `enabled` below
  // for why: that GET is dispatched the moment this session's messages query
  // mounts (React Query always fetches once on a query key's first mount,
  // regardless of staleTime/refetchOnMount/existing seeded data), and it
  // races the send that immediately follows session creation. If the GET
  // resolves after the send's POST has written the real exchange into the
  // cache, it clobbers that write back to empty — silently, since a
  // successful fetch is indistinguishable from a valid update from React
  // Query's point of view. Every write path in this component (create/send/
  // delete) already keeps this cache correct directly, so a session id, once
  // added, is only ever removed on sendMutation failure — see
  // sendMutation.onError — never on success (removing it there would
  // re-enable the query on the very render its own cache write triggers,
  // which counts as that query's first "enable" and fires the exact GET this
  // exists to prevent). State, not a ref: `enabled` below reads it during
  // render, and only state changes are guaranteed to schedule the re-render
  // that a change here needs to take effect.
  const [skipInitialMessagesFetchIds, setSkipInitialMessagesFetchIds] = useState<Set<string>>(
    new Set(),
  );

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
    enabled:
      !!resolvedSessionId && featureEnabled && !skipInitialMessagesFetchIds.has(resolvedSessionId),
  });

  const persistedMessages = activeSession?.messages ?? [];

  // optimisticMessages is not cleared per-session — it's a single shared
  // array — so filter to the currently-displayed session here. Without this,
  // switching away from session A while A's send is still in flight (send
  // does not block session switching) would render A's stale optimistic
  // bubble on top of whatever session the user has since switched to.
  const displayedOptimisticMessages = resolvedSessionId
    ? optimisticMessages.filter((m) => m.session_id === resolvedSessionId)
    : [];

  // Merge persisted + optimistic (optimistic cleared when query refreshes)
  const allMessages = [...persistedMessages, ...displayedOptimisticMessages];

  // Auto-scroll to thread bottom when new messages arrive
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages.length]);

  // ── Create session mutation ──────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: createAiSession,
    onSuccess: (newSession) => {
      void queryClient.invalidateQueries({ queryKey: AI_SESSIONS_QUERY_KEY });
      // Seed the messages cache directly instead of waiting for the messages
      // query to fetch it — a brand-new session always has zero messages, so
      // this is never a guess. Also suppress that query's first-mount GET
      // outright (see skipInitialMessagesFetchIds above) rather than relying
      // on this seed to survive it: the GET races the send that immediately
      // follows session creation and, if left enabled, can resolve after the
      // send's cache write and silently clobber it back to empty.
      setSkipInitialMessagesFetchIds((prev) => new Set(prev).add(newSession.id));
      queryClient.setQueryData<AiSessionWithMessagesResponse>(aiMessagesQueryKey(newSession.id), {
        ...newSession,
        messages: [],
      });
      setActiveSessionId(newSession.id);
      // No optimisticMessages clear needed: a brand-new session has no
      // entries of its own, and displayedOptimisticMessages filters by
      // session id, so a prior session's in-flight bubble is already hidden.
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
        // Select a different session or clear. No optimisticMessages clear
        // needed here — see createMutation.onSuccess above.
        const remaining = sessions.filter((s) => s.id !== deletedId);
        setActiveSessionId(remaining[0]?.id ?? null);
      }
      setDeleteConfirmId(null);
    },
  });

  // ── Send message mutation ────────────────────────────────────────────────────

  const sendMutation = useMutation({
    mutationFn: async ({
      sessionId,
      content,
      isDisplayedSession: _isDisplayedSession,
    }: {
      sessionId: string;
      content: string;
      isDisplayedSession: boolean;
    }) => {
      return sendAiMessage(sessionId, content);
    },
    onSuccess: (assistantMessage, { sessionId, content, isDisplayedSession }) => {
      setDisabledPendingActionId(null);
      setSendError(null);
      void queryClient.invalidateQueries({ queryKey: AI_SESSIONS_QUERY_KEY });
      // Deliberately NOT un-suppressing the messages query's fetch for
      // sessionId here (see skipInitialMessagesFetchIds' declaration). Doing
      // so before the cache write below re-enables the query on the same
      // render that write triggers, which counts as that query's genuinely
      // first "enable" transition and fires the exact GET this whole
      // mechanism exists to prevent — the fetch would land after this write
      // and clobber it right back out. Every write path in this component
      // (create/send/delete) already keeps this cache correct directly, so
      // there is no correctness reason to ever let this query fetch this key
      // again for the lifetime of this component instance.

      // Single round-trip: the POST response already contains the persisted
      // assistant message, so commit it straight into the query cache instead
      // of awaiting a second GET refetch (MINCRM-602). This removes the
      // unguarded optimistic/refetch handshake that caused two prior
      // assistant-bubble timing bugs (4735d536, ca941cbc).
      //
      // The server does not return the user message it just persisted (only
      // the assistant reply), so a placeholder is fabricated here with an id
      // derived from the assistant message's real id — unique per send, so
      // a second send in the same session can never collide with the first
      // (the previous fixed literal id did). The placeholder is never treated
      // as ground truth: the un-awaited invalidateQueries below triggers a
      // background refetch that reconciles it with the server's real id/
      // created_at next time this query re-fetches, without blocking onSuccess
      // or reintroducing the awaited two-round-trip handshake this replaced.
      const optimisticUserMessage: AiMessageResponse = {
        id: `optimistic-user-${assistantMessage.id}`,
        session_id: sessionId,
        role: 'user',
        content,
        tool_results: null,
        pending_action: null,
        context_proposal: null,
        created_at: new Date().toISOString(),
      };
      try {
        queryClient.setQueryData<AiSessionWithMessagesResponse>(
          aiMessagesQueryKey(sessionId),
          (old) => {
            // No cache entry yet — nothing to append onto, so there is no
            // cache write to make here. createMutation.onSuccess seeds this
            // key for the new-session-on-demand path, so this should only be
            // reachable via cache eviction; the un-awaited invalidateQueries
            // below still fires as a fallback, but note it does NOT force a
            // fresh fetch if a GET for this key is already in flight — it
            // just awaits that existing request, which can race the POST
            // that got us here and leave this cache entry unpopulated. Do
            // not rely on this branch for correctness; the seed above is the
            // real fix.
            if (!old) return old;
            // Guard against the exchange already being present: if a session
            // refetch (the reconciliation invalidateQueries below, or the
            // initial session GET on the new-session-on-demand path) resolves
            // concurrently with this POST, `old` may already reflect the
            // real, server-persisted messages for this exact turn — either
            // fully (both messages present) or partially (only the user
            // message, since the server persists it slightly before the
            // assistant reply within the same request). Checking only
            // assistantMessage.id would miss the partial case and still
            // append a second, fabricated user bubble alongside the real one.
            // The assistant message's id is real and stable, so check that;
            // the user message has no stable id to check (it's fabricated
            // client-side), so match it by role + content instead.
            const assistantAlreadyPresent = old.messages.some((m) => m.id === assistantMessage.id);
            const userTurnAlreadyPresent = old.messages.some(
              (m) => m.role === 'user' && m.content === content,
            );
            if (assistantAlreadyPresent && userTurnAlreadyPresent) return old;
            const messagesToAppend = [
              ...(userTurnAlreadyPresent ? [] : [optimisticUserMessage]),
              ...(assistantAlreadyPresent ? [] : [assistantMessage]),
            ];
            return {
              ...old,
              messages: [...old.messages, ...messagesToAppend],
            };
          },
        );
      } catch {
        // setQueryData's updater is not expected to throw in practice, but if
        // it does, fail safe: surface an error rather than leaving the
        // mutation looking silently "stuck". Clearing is scoped to this
        // session's own optimistic entries (see below) so it can never
        // affect a different session's in-flight or already-cleared state.
        setOptimisticMessages((prev) => prev.filter((m) => m.session_id !== sessionId));
        if (isDisplayedSession) {
          setSendError(t('ai.errorSend'));
        }
        setDisabledPendingActionId(null);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: aiMessagesQueryKey(sessionId) });

      // Clear only this session's optimistic entries — never the whole shared
      // array. optimisticMessages is not partitioned by session by default
      // (every write handler in this component appends to one shared array),
      // so filtering by sessionId here is what actually protects a different
      // session's in-flight bubble from being wiped out by this settle. Using
      // isDisplayedSession alone would not do that: it only reflects whether
      // the user was viewing *this* session at send time, not which session's
      // entries are actually being cleared.
      setOptimisticMessages((prev) => prev.filter((m) => m.session_id !== sessionId));
    },
    onError: (_error, { sessionId, isDisplayedSession }) => {
      // Scoped to this session's own entries — see the onSuccess settle path
      // above for why a blanket clear would be unsafe.
      setOptimisticMessages((prev) => prev.filter((m) => m.session_id !== sessionId));
      if (isDisplayedSession) {
        setSendError(t('ai.errorSend'));
      }
      // Re-enable any disabled confirmation block so the user can retry.
      setDisabledPendingActionId(null);
      // The send that would have populated this session's messages cache
      // failed — the seeded (empty) entry is all there is. Un-suppress the
      // messages query's fetch so a retry, or simply re-opening this
      // session, can still pick up any state a partially-succeeded request
      // may have left server-side.
      setSkipInitialMessagesFetchIds((prev) => {
        if (!prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleNewSession = useCallback(() => {
    createMutation.mutate();
  }, [createMutation]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      // Compare against resolvedSessionId (not activeSessionId) to avoid
      // clearing state when clicking the already-active first session before
      // activeSessionId has been set from the sessions list.
      if (sessionId !== resolvedSessionId) {
        setActiveSessionId(sessionId);
        // Deliberately not clearing optimisticMessages here: it's filtered by
        // session id when rendered (displayedOptimisticMessages), so a prior
        // session's entries are already hidden once the user switches away.
        // Clearing them here would also wrongly discard that prior session's
        // still-in-flight optimistic bubble if the user switches back to it
        // before its send settles. Each session's entries are cleaned up by
        // sendMutation's own onSuccess/onError once that session's send
        // actually settles.
        setSendError(null);
        setDisabledPendingActionId(null);
        setBulkDeleteConfirmTexts({});
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
      setOptimisticMessages([
        {
          id: `optimistic-user-confirm-${messageId}`,
          session_id: resolvedSessionId, // non-null: guarded by the if(!resolvedSessionId) check above
          role: 'user' as const,
          content: 'Yes, go ahead.',
          tool_results: null,
          pending_action: null,
          context_proposal: null,
          created_at: new Date().toISOString(),
        },
      ]);
      sendMutation.mutate({
        sessionId: resolvedSessionId,
        content: 'Yes, go ahead.',
        isDisplayedSession: true,
      });
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
      setOptimisticMessages([
        {
          id: `optimistic-user-cancel-${messageId}`,
          session_id: resolvedSessionId, // non-null: guarded by the if(!resolvedSessionId) check above
          role: 'user' as const,
          content: 'No, cancel that.',
          tool_results: null,
          pending_action: null,
          context_proposal: null,
          created_at: new Date().toISOString(),
        },
      ]);
      sendMutation.mutate({
        sessionId: resolvedSessionId,
        content: 'No, cancel that.',
        isDisplayedSession: true,
      });
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

  /**
   * Marks a context proposal chip as dismissed for this session.
   * Updater form: no side effects, safe in StrictMode. (MINCRM-429, MINCRM-430)
   */
  const handleProposalDismiss = useCallback((messageId: string) => {
    setDismissedProposalIds((prev) => new Set([...prev, messageId]));
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
        setActiveSessionId(newSession.id);
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
      context_proposal: null,
      created_at: new Date().toISOString(),
    };
    setOptimisticMessages([optimisticUserMessage]);

    sendMutation.mutate({ sessionId: resolvedId, content, isDisplayedSession: true });
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
    <div
      className="h-dvh bg-gray-50 flex flex-col overflow-hidden"
      // `dvh` doesn't shrink when a mobile keyboard overlays the layout viewport
      // instead of resizing it (Greptile PR #348 follow-up) — pin the shell to
      // the VisualViewport height in that case so the composer stays reachable.
      style={visualViewportHeight !== undefined ? { height: visualViewportHeight } : undefined}
    >
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

          {/* Retention window notice (MINCRM-462) */}
          {retentionWindow && (
            <p
              className="px-4 py-1.5 text-xs text-gray-500 border-b border-gray-50 flex-shrink-0"
              data-testid="ai-retention-window-notice"
            >
              {t('ai.retentionWindowNotice', { days: retentionWindow.ai_session_retention_days })}
            </p>
          )}

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
                isProposalDismissed={dismissedProposalIds.has(msg.id)}
                onProposalDismiss={handleProposalDismiss}
              />
            ))}
            {/* Pending assistant indicator */}
            {sendMutation.isPending &&
              displayedOptimisticMessages.length === 1 &&
              displayedOptimisticMessages[0].role === 'user' && (
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

        {/* ── Context sidebar (MINCRM-427, MINCRM-428) ──────────────────── */}
        <ContextPanel />
      </div>
    </div>
  );
}
