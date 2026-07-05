/**
 * TaskSuggestionPanel component. (MINCRM-438)
 *
 * Non-blocking panel shown once, immediately after an activity is saved,
 * with 1-3 AI-suggested follow-up tasks. Each suggestion can be accepted
 * (creates a linked Task activity) or dismissed (removed with no side effect).
 * Not regenerated on subsequent page loads — the parent only mounts this once
 * per save, driven by its own local state.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import type { SuggestedTask } from '@shared/schemas/taskSuggestionSchema.js';

export interface TaskSuggestionPanelProps {
  suggestions: SuggestedTask[];
  /** Called when the user accepts a suggestion at the given index. */
  onAccept: (task: SuggestedTask, index: number) => void;
  /** Called when the panel is dismissed entirely (close button). */
  onDismissAll: () => void;
}

/**
 * Panel listing AI-suggested follow-up tasks with per-item accept/dismiss.
 * Once every suggestion has been accepted or dismissed, calls onDismissAll.
 */
export default function TaskSuggestionPanel({
  suggestions,
  onAccept,
  onDismissAll,
}: TaskSuggestionPanelProps) {
  const { t } = useTranslation();
  const [resolvedIndexes, setResolvedIndexes] = useState<Set<number>>(new Set());
  const [acceptedIndexes, setAcceptedIndexes] = useState<Set<number>>(new Set());

  function handleAccept(task: SuggestedTask, index: number): void {
    onAccept(task, index);
    setResolvedIndexes((prev) => new Set(prev).add(index));
    setAcceptedIndexes((prev) => new Set(prev).add(index));
  }

  function handleDismiss(index: number): void {
    setResolvedIndexes((prev) => new Set(prev).add(index));
  }

  const allResolved = resolvedIndexes.size === suggestions.length;

  return (
    <section
      className="mt-4 bg-white border border-gray-200 rounded-lg p-4"
      aria-labelledby="task-suggestion-heading"
      data-testid="task-suggestion-panel"
    >
      <div className="flex items-center justify-between mb-3">
        <h3
          id="task-suggestion-heading"
          className="text-sm font-semibold text-gray-900"
          data-testid="task-suggestion-heading"
        >
          {t('taskSuggestions.heading')}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="task-suggestion-panel-dismiss"
          onClick={onDismissAll}
        >
          {t('taskSuggestions.dismissAll')}
        </Button>
      </div>

      {allResolved ? (
        <p className="text-sm text-gray-500" data-testid="task-suggestion-empty">
          {t('taskSuggestions.allResolved')}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="task-suggestion-list">
          {suggestions.map((task, index) => {
            if (resolvedIndexes.has(index)) return null;
            return (
              <li
                key={index}
                className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2"
                data-testid={`task-suggestion-${index}`}
              >
                <div className="min-w-0">
                  <p className="text-sm text-gray-900">{task.description}</p>
                  <p className="text-xs text-gray-500">{task.suggested_due_date}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid={`task-suggestion-accept-${index}`}
                    onClick={() => handleAccept(task, index)}
                  >
                    {t('taskSuggestions.addTask')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`task-suggestion-dismiss-${index}`}
                    onClick={() => handleDismiss(index)}
                  >
                    {t('taskSuggestions.dismiss')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {acceptedIndexes.size > 0 && (
        <p className="mt-2 text-xs text-gray-500" data-testid="task-suggestion-accepted-count">
          {t('taskSuggestions.acceptedCount', { count: acceptedIndexes.size })}
        </p>
      )}
    </section>
  );
}
