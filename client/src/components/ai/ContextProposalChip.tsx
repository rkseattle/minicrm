/**
 * Context proposal chip — shown inline within an AI message bubble when the AI
 * has proposed saving a context entry. The user can accept (saves via API) or
 * dismiss (session-scoped, never stored).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AI_CONTEXT_QUERY_KEY, createAiContextEntry } from '@/api/aiContext.js';
import type { AiContextProposal } from '@shared/schemas/aiContextSchema.js';

interface ContextProposalChipProps {
  messageId: string;
  proposal: AiContextProposal;
  /** Called when the user accepts or dismisses — removes the chip from the UI. */
  onDismiss: (messageId: string) => void;
}

export default function ContextProposalChip({
  messageId,
  proposal,
  onDismiss,
}: ContextProposalChipProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(false);

  const createMutation = useMutation({
    mutationFn: () => createAiContextEntry(proposal.key, proposal.value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_CONTEXT_QUERY_KEY });
      setAccepted(true);
      // Brief delay so the user sees the accepted confirmation before it disappears.
      setTimeout(() => onDismiss(messageId), 1200);
    },
  });

  const handleAccept = () => {
    if (createMutation.isPending || accepted) return;
    createMutation.mutate();
  };

  const handleDismiss = () => {
    onDismiss(messageId);
  };

  return (
    <div
      className="mt-3 flex items-start gap-2 rounded-lg border border-primary-100 bg-primary-50 px-3 py-2"
      data-testid={`ai-context-proposal-chip-${messageId}`}
      role="group"
      aria-label={`${t('ai.context.proposalAccept')}: ${proposal.key}`}
    >
      {/* Lightbulb icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-primary-800 font-medium leading-snug break-words">
          <span className="font-semibold">{proposal.key}</span>
          {/* Decorative separator — not translated */}
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <span className="font-normal text-primary-600 mx-1" aria-hidden="true">
            →
          </span>
          <span>{proposal.value}</span>
        </p>
        {proposal.reason && (
          <p className="mt-0.5 text-xs text-primary-600 leading-snug break-words">
            {proposal.reason}
          </p>
        )}

        <div className="mt-2 flex items-center gap-2">
          {accepted ? (
            <span
              className="text-xs text-green-700 font-medium"
              data-testid={`ai-context-proposal-accepted-${messageId}`}
            >
              {t('ai.context.proposalAccepted')}
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={handleAccept}
                disabled={createMutation.isPending}
                data-testid={`ai-context-proposal-accept-button-${messageId}`}
                className="text-xs font-medium text-white bg-primary-600 rounded-md px-2 py-0.5 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createMutation.isPending ? '…' : t('ai.context.proposalAccept')}
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                disabled={createMutation.isPending}
                data-testid={`ai-context-proposal-dismiss-button-${messageId}`}
                className="text-xs text-primary-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('ai.context.proposalDismiss')}
              </button>
            </>
          )}
          {createMutation.isError && (
            <span className="text-xs text-red-600" role="alert">
              {(() => {
                const code = (
                  createMutation.error as { response?: { data?: { error?: { code?: string } } } }
                )?.response?.data?.error?.code;
                if (code === 'CONTEXT_ENTRY_LIMIT_REACHED') return t('ai.context.limitReached');
                if (code === 'CONTEXT_KEY_DUPLICATE') return t('ai.context.keyDuplicate');
                return (createMutation.error as Error).message;
              })()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
