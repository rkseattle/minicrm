/**
 * ActivitySummaryModal component. (MINCRM-436)
 * Lets the user paste a call transcript / meeting notes / raw text, calls the AI
 * summarizer, and previews the result (summary, action items, suggested follow-up
 * tasks) before applying it to the activity form. The user can edit the summary
 * and action items inline, and accept or dismiss each suggested task individually.
 * Accessible dialog with focus trap and Escape dismissal, following BulkReassignModal.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button.js';
import { resolveApiError } from '@/utils/apiError.js';
import { summarizeActivityText } from '@/api/activitySummary.js';
import type { SuggestedFollowUpTask } from '@shared/schemas/activitySummarySchema.js';

export interface ActivitySummaryApplyResult {
  /** Summary text to populate/prepend into the activity notes field */
  summary: string;
  /** Action items to append to the activity notes field */
  actionItems: string[];
  /** Follow-up tasks the user accepted, to be created as linked Task activities */
  acceptedTasks: SuggestedFollowUpTask[];
}

export interface ActivitySummaryModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Called with the (possibly edited) summary result when the user applies it */
  onApply: (result: ActivitySummaryApplyResult) => void;
  /** Called when the user cancels or dismisses the modal */
  onCancel: () => void;
}

/**
 * Modal for pasting freeform text and previewing an AI-generated summary,
 * action items, and suggested follow-up tasks before applying to the activity.
 */
export default function ActivitySummaryModal({
  isOpen,
  onApply,
  onCancel,
}: ActivitySummaryModalProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [rawText, setRawText] = useState('');
  const [summary, setSummary] = useState('');
  const [actionItems, setActionItems] = useState<string[]>([]);
  const [suggestedTasks, setSuggestedTasks] = useState<SuggestedFollowUpTask[]>([]);
  const [dismissedTaskIndexes, setDismissedTaskIndexes] = useState<Set<number>>(new Set());

  const summarizeMutation = useMutation({
    mutationFn: () => summarizeActivityText(rawText),
    onSuccess: (result) => {
      setSummary(result.summary);
      setActionItems(result.action_items);
      setSuggestedTasks(result.suggested_follow_up_tasks);
      setDismissedTaskIndexes(new Set());
    },
  });

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    } else {
      previousFocusRef.current?.focus();
      setRawText('');
      setSummary('');
      setActionItems([]);
      setSuggestedTasks([]);
      setDismissedTaskIndexes(new Set());
      summarizeMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset-on-close only needs isOpen
  }, [isOpen]);

  if (!isOpen) return null;

  const hasResult = summarizeMutation.isSuccess;

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape' && !summarizeMutation.isPending) {
      onCancel();
    }
  }

  function handleDismissTask(index: number): void {
    setDismissedTaskIndexes((prev) => new Set(prev).add(index));
  }

  function handleApply(): void {
    const acceptedTasks = suggestedTasks.filter((_, index) => !dismissedTaskIndexes.has(index));
    onApply({ summary, actionItems, acceptedTasks });
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="activity-summary-modal-overlay"
      onClick={summarizeMutation.isPending ? undefined : onCancel}
      onKeyDown={handleKeyDown}
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="activity-summary-title"
        data-testid="activity-summary-modal"
        className="relative w-full max-w-lg mx-4 p-0 max-h-[90vh] overflow-y-auto"
      >
        <div
          role="presentation"
          className="rounded-lg bg-white p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="activity-summary-title" className="text-base font-semibold text-gray-900 mb-2">
            {t('activities.summarize.title')}
          </h2>

          {!hasResult && (
            <>
              <label
                htmlFor="activity-summary-input"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('activities.summarize.inputLabel')}
              </label>
              <textarea
                id="activity-summary-input"
                ref={textareaRef}
                data-testid="activity-summary-input"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={8}
                disabled={summarizeMutation.isPending}
                placeholder={t('activities.summarize.inputPlaceholder')}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900
                           placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500
                           focus:border-primary-500 resize-none mb-4"
              />

              {summarizeMutation.isError && (
                <p
                  role="alert"
                  className="mb-4 text-xs text-red-600"
                  data-testid="activity-summary-error"
                >
                  {resolveApiError(summarizeMutation.error, t)}
                </p>
              )}

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="primary"
                  data-testid="activity-summary-submit"
                  onClick={() => summarizeMutation.mutate()}
                  disabled={summarizeMutation.isPending || !rawText.trim()}
                >
                  {summarizeMutation.isPending
                    ? t('activities.summarize.summarizing')
                    : t('activities.summarize.submit')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  data-testid="activity-summary-cancel"
                  onClick={onCancel}
                  disabled={summarizeMutation.isPending}
                >
                  {t('activities.cancel')}
                </Button>
              </div>
            </>
          )}

          {hasResult && (
            <>
              <label
                htmlFor="activity-summary-preview"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('activities.summarize.summaryLabel')}
              </label>
              <textarea
                id="activity-summary-preview"
                data-testid="activity-summary-preview"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900
                           focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500
                           resize-none mb-4"
              />

              {actionItems.length > 0 && (
                <>
                  <p className="block text-sm font-medium text-gray-700 mb-1">
                    {t('activities.summarize.actionItemsLabel')}
                  </p>
                  <ul
                    className="list-disc list-inside text-sm text-gray-700 mb-4 space-y-1"
                    data-testid="activity-summary-action-items"
                  >
                    {actionItems.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </>
              )}

              {suggestedTasks.length > 0 && (
                <>
                  <p className="block text-sm font-medium text-gray-700 mb-1">
                    {t('activities.summarize.suggestedTasksLabel')}
                  </p>
                  <ul className="mb-4 space-y-2" data-testid="activity-summary-suggested-tasks">
                    {suggestedTasks.map((task, index) => {
                      const isDismissed = dismissedTaskIndexes.has(index);
                      return (
                        <li
                          key={index}
                          className={[
                            'flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2',
                            isDismissed ? 'opacity-40' : '',
                          ].join(' ')}
                          data-testid={`activity-summary-task-${index}`}
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-gray-900">{task.description}</p>
                            <p className="text-xs text-gray-500">{task.suggested_due_date}</p>
                          </div>
                          {!isDismissed && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              data-testid={`activity-summary-task-dismiss-${index}`}
                              onClick={() => handleDismissTask(index)}
                            >
                              {t('activities.summarize.dismissTask')}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="primary"
                  data-testid="activity-summary-apply"
                  onClick={handleApply}
                >
                  {t('activities.summarize.apply')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  data-testid="activity-summary-discard"
                  onClick={onCancel}
                >
                  {t('activities.cancel')}
                </Button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
