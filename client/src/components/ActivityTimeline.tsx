/**
 * ActivityTimeline component.
 * Displays a chronological list of activities for a contact, account, or deal.
 * Supports creating, editing, deleting, and marking tasks complete.
 * Reusable — pass exactly one of contactId, accountId, or dealId.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { resolveApiError } from '@/utils/apiError.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import ActivityForm, { TYPE_KEY_MAP } from '@/components/ActivityForm.js';
import FieldMergeModal from '@/components/FieldMergeModal.js';
import ObjectionInsights from '@/components/ObjectionInsights.js';
import EmailDraftPanel from '@/components/EmailDraftPanel.js';
import TaskSuggestionPanel from '@/components/TaskSuggestionPanel.js';
import {
  listActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  ACTIVITIES_QUERY_KEY,
} from '@/api/activities.js';
import { generateEmailDraft } from '@/api/emailDraft.js';
import { generateTaskSuggestions } from '@/api/taskSuggestions.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import { useAuth } from '@/hooks/useAuth.js';
import type {
  ActivityResponse,
  ActivityType,
  ActivityDirection,
} from '@shared/schemas/activitySchema.js';
import type { ActivityFormValues } from '@/components/ActivityForm.js';
import type { BadgeProps } from '@/components/ui/Badge.js';
import type { SuggestedTask } from '@shared/schemas/taskSuggestionSchema.js';

/** Activity types the task-suggestion feature supports (MINCRM-438) */
const TASK_SUGGESTABLE_TYPES: ReadonlySet<ActivityType> = new Set(['Call', 'Meeting', 'Email']);
import type { EmailDraftResponse } from '@shared/schemas/emailDraftSchema.js';

export interface ActivityTimelineProps {
  /** Filter activities to those linked to this contact */
  contactId?: string;
  /** Filter activities to those linked to this account */
  accountId?: string;
  /** Filter activities to those linked to this deal */
  dealId?: string;
}

/** Badge variant for each activity type */
const TYPE_BADGE_VARIANT: Record<ActivityType, BadgeProps['variant']> = {
  Note: 'neutral',
  Call: 'success',
  Email: 'warning',
  Meeting: 'warning',
  Task: 'error',
};

/**
 * Timeline of activities for a parent record.
 * Displays each activity as a card with type badge, subject, notes, and due date.
 * Shows edit/delete controls for the owner or admin users.
 * Shows a "Mark complete" button on open tasks.
 */
export default function ActivityTimeline({ contactId, accountId, dealId }: ActivityTimelineProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { enabled: emailDraftEnabled } = useFeatureFlag('ai_email_draft');

  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [emailDraftResult, setEmailDraftResult] = useState<EmailDraftResponse | null>(null);
  const [emailDraftError, setEmailDraftError] = useState<string | null>(null);
  const [draftingContactId, setDraftingContactId] = useState<string | null>(null);
  const { enabled: taskSuggestionsEnabled } = useFeatureFlag('ai_task_suggestions');
  const [taskSuggestions, setTaskSuggestions] = useState<SuggestedTask[] | null>(null);
  // Three-way merge conflict state — tracks which activity has a pending conflict (MINCRM-351)
  const [editConflict, setEditConflict] = useState<{
    activityId: string;
    pendingValues: ActivityFormValues;
    base: Record<string, unknown>;
    theirs: Record<string, unknown>;
  } | null>(null);

  /** Number of activities to show; expanded by ACTIVITY_PAGE_SIZE on each "Load more" click */
  const ACTIVITY_PAGE_SIZE = 10;
  const [visibleLimit, setVisibleLimit] = useState(ACTIVITY_PAGE_SIZE);

  const queryKey = [
    ...ACTIVITIES_QUERY_KEY,
    { contactId, accountId, dealId, limit: visibleLimit },
  ] as const;

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listActivities({ contactId, accountId, dealId, limit: visibleLimit }),
  });

  const createMutation = useMutation({
    mutationFn: (values: ActivityFormValues) =>
      createActivity({
        type: values.type,
        subject: values.subject,
        notes: values.notes || undefined,
        due_date: values.due_date || undefined,
        direction: (values.direction || undefined) as ActivityDirection | undefined,
        outcome: values.outcome || undefined,
        contact_id: contactId,
        account_id: accountId,
        deal_id: dealId,
      }),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey });
      setIsCreating(false);
      setCreateError(null);

      // Create AI-suggested follow-up tasks the user accepted while summarizing, now
      // that the parent activity itself has actually saved (MINCRM-436).
      variables.acceptedSuggestedTasks.forEach((task) => {
        createActivity({
          type: 'Task',
          subject: task.description,
          due_date: task.suggested_due_date,
          contact_id: contactId,
          account_id: accountId,
          deal_id: dealId,
        })
          .then(() => queryClient.invalidateQueries({ queryKey }))
          .catch(() => {
            // Best-effort — the parent activity itself already saved successfully.
          });
      });

      // Fetch AI follow-up task suggestions once, immediately after save (MINCRM-438).
      // Not regenerated on subsequent page loads — this call only happens right here.
      if (
        taskSuggestionsEnabled &&
        TASK_SUGGESTABLE_TYPES.has(result.activity.type as ActivityType)
      ) {
        generateTaskSuggestions(result.activity.id)
          .then((response) => setTaskSuggestions(response.suggestions))
          .catch(() => {
            // Best-effort — the activity itself already saved successfully.
          });
      }
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setCreateError(resolveApiError(error, t));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      values,
      version,
    }: {
      id: string;
      values: ActivityFormValues;
      version: number;
    }) =>
      updateActivity(id, {
        type: values.type,
        subject: values.subject,
        notes: values.notes || null,
        due_date: values.due_date || null,
        direction: (values.direction || null) as ActivityDirection | null,
        outcome: values.outcome || null,
        version,
      }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey });
      setEditingId(null);
      setEditError(null);
      setEditConflict(null);

      // Create AI-suggested follow-up tasks the user accepted while summarizing, now
      // that the parent activity's edits have actually saved (MINCRM-436).
      variables.values.acceptedSuggestedTasks.forEach((task) => {
        createActivity({
          type: 'Task',
          subject: task.description,
          due_date: task.suggested_due_date,
          contact_id: contactId,
          account_id: accountId,
          deal_id: dealId,
        })
          .then(() => queryClient.invalidateQueries({ queryKey }))
          .catch(() => {
            // Best-effort — the parent activity itself already saved successfully.
          });
      });
    },
    onError: (
      error: {
        response?: {
          data?: { error?: { code?: string; message?: string; current?: Record<string, unknown> } };
        };
      },
      variables,
    ) => {
      const code = error.response?.data?.error?.code;
      if (code === 'OPTIMISTIC_LOCK_CONFLICT') {
        // Capture base from current timeline data before invalidating (MINCRM-351)
        const activities: ActivityResponse[] = data?.data ?? [];
        const baseActivity = activities.find((a) => a.id === variables.id);
        setEditConflict({
          activityId: variables.id,
          pendingValues: variables.values,
          base: (baseActivity as unknown as Record<string, unknown>) ?? {},
          theirs: error.response?.data?.error?.current ?? {},
        });
        void queryClient.invalidateQueries({ queryKey });
        return;
      }
      setEditError(resolveApiError(error, t));
    },
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      updateActivity(id, { status: 'complete', version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setCompleteError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setCompleteError(resolveApiError(error, t));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteActivity(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setDeleteError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setDeleteError(resolveApiError(error, t));
    },
  });

  const emailDraftMutation = useMutation({
    mutationFn: (targetContactId: string) => generateEmailDraft(targetContactId, 'Professional'),
    onSuccess: (result) => {
      setEmailDraftResult(result);
      setEmailDraftError(null);
    },
    onError: (error: Parameters<typeof resolveApiError>[0]) => {
      setEmailDraftError(resolveApiError(error, t));
    },
  });

  const activities: ActivityResponse[] = data?.data ?? [];
  const hasMore = data !== undefined && activities.length < data.total;

  /**
   * Creates a linked Task activity for one accepted AI-suggested follow-up task (MINCRM-438).
   * Links to the opportunity (deal) when the suggestion says 'opportunity' and this timeline
   * has a dealId; otherwise links to whichever single parent record this timeline represents.
   * Fired only from the post-save TaskSuggestionPanel, so the parent activity is always
   * already persisted by the time this runs.
   */
  const handleAcceptTaskSuggestion = (task: SuggestedTask): void => {
    const linkToOpportunity = task.linked_entity === 'opportunity' && Boolean(dealId);
    createActivity({
      type: 'Task',
      subject: task.description,
      due_date: task.suggested_due_date,
      contact_id: linkToOpportunity ? undefined : contactId,
      account_id: linkToOpportunity ? undefined : accountId,
      deal_id: dealId,
    })
      .then(() => queryClient.invalidateQueries({ queryKey }))
      .catch(() => {
        // Best-effort — the activity itself already saved successfully.
      });
  };

  /**
   * Returns true if the current user may edit or delete the given activity.
   *
   * @param activity - The activity to check
   */
  function canModify(activity: ActivityResponse): boolean {
    if (!user) return false;
    return activity.owner_id === user.id || user.role === 'admin';
  }

  const handleDelete = (activity: ActivityResponse): void => {
    if (window.confirm(t('activities.confirmDelete'))) {
      deleteMutation.mutate(activity.id);
    }
  };

  return (
    <section className="mt-8" aria-labelledby="activity-timeline-heading">
      <div className="flex items-center justify-between mb-3">
        <h2
          id="activity-timeline-heading"
          className="text-sm font-semibold text-gray-900"
          data-testid="activity-timeline-heading"
        >
          {t('activities.timelineHeading')}
        </h2>
        {!isCreating && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="add-activity-button"
            onClick={() => setIsCreating(true)}
          >
            {t('activities.addActivity')}
          </Button>
        )}
      </div>

      {/* Inline create form */}
      {isCreating && (
        <div
          className="mb-4 bg-white border border-gray-200 rounded-lg p-4"
          data-testid="activity-create-form-container"
        >
          <ActivityForm
            onSubmit={(values) => createMutation.mutate(values)}
            onCancel={() => {
              setIsCreating(false);
              setCreateError(null);
            }}
            isSubmitting={createMutation.isPending}
            submitLabel={t('activities.save')}
            error={createError ?? undefined}
          />
        </div>
      )}

      {taskSuggestions && taskSuggestions.length > 0 && (
        <TaskSuggestionPanel
          suggestions={taskSuggestions}
          onAccept={(task) => handleAcceptTaskSuggestion(task)}
          onDismissAll={() => setTaskSuggestions(null)}
        />
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {isLoading && activities.length === 0 ? (
          <p className="px-6 py-4 text-sm text-gray-500" data-testid="activity-timeline-loading">
            {t('activities.loading')}
          </p>
        ) : activities.length === 0 ? (
          <p className="px-6 py-4 text-sm text-gray-500" data-testid="activity-timeline-empty">
            {t('activities.empty')}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-gray-100" data-testid="activity-timeline-list">
              {activities.map((activity) => (
                <li
                  key={activity.id}
                  className="px-6 py-4"
                  data-testid={`activity-item-${activity.id}`}
                >
                  {editingId === activity.id ? (
                    <>
                      <ActivityForm
                        initialValues={{
                          type: activity.type as ActivityType,
                          subject: activity.subject,
                          notes: activity.notes ?? '',
                          due_date: activity.due_date ?? '',
                          direction: (activity.direction ?? '') as ActivityDirection | '',
                          outcome: activity.outcome ?? '',
                        }}
                        onSubmit={(values) =>
                          updateMutation.mutate({
                            id: activity.id,
                            values,
                            version: activity.version,
                          })
                        }
                        onCancel={() => {
                          setEditingId(null);
                          setEditError(null);
                          setEditConflict(null);
                        }}
                        isSubmitting={updateMutation.isPending}
                        submitLabel={t('activities.saveChanges')}
                        error={editError ?? undefined}
                      />
                      <FieldMergeModal
                        isOpen={editConflict?.activityId === activity.id}
                        onClose={() => {
                          setEditConflict(null);
                          setEditingId(null);
                        }}
                        entityType="activity"
                        base={editConflict?.base ?? {}}
                        theirs={editConflict?.theirs ?? {}}
                        mine={
                          (editConflict?.pendingValues as unknown as Record<string, unknown>) ?? {}
                        }
                        fieldLabels={{
                          subject: t('activities.subjectLabel'),
                          notes: t('activities.notesLabel'),
                          type: t('activities.typeLabel'),
                          direction: t('activities.directionLabel'),
                          due_date: t('activities.dueDateLabel'),
                          outcome: t('activities.outcomeLabel'),
                        }}
                        onResolve={(resolved) => {
                          // Use version from theirs (the 409 body) — authoritative, no cache race (MINCRM-351)
                          updateMutation.mutate({
                            id: activity.id,
                            values: {
                              ...(editConflict?.pendingValues as ActivityFormValues),
                              ...(resolved as Partial<ActivityFormValues>),
                            },
                            version: (editConflict?.theirs.version as number) ?? activity.version,
                          });
                          setEditConflict(null);
                        }}
                      />
                    </>
                  ) : (
                    <div className="flex items-start gap-3">
                      {/* Type badge + direction + status */}
                      <div className="flex flex-col items-start gap-1 shrink-0 pt-0.5">
                        <Badge variant={TYPE_BADGE_VARIANT[activity.type as ActivityType]}>
                          {t(`activities.${TYPE_KEY_MAP[activity.type as ActivityType]}`)}
                        </Badge>
                        {activity.direction && (
                          <span
                            className="text-xs text-gray-500"
                            data-testid={`activity-direction-${activity.id}`}
                          >
                            {t(`activities.direction${activity.direction}`)}
                          </span>
                        )}
                        {activity.status === 'complete' && (
                          <span data-testid={`activity-complete-badge-${activity.id}`}>
                            <Badge variant="success">{t('activities.statusComplete')}</Badge>
                          </span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p
                          className={[
                            'text-sm font-medium text-gray-900',
                            activity.status === 'complete' ? 'line-through text-gray-500' : '',
                          ].join(' ')}
                          data-testid={`activity-subject-${activity.id}`}
                        >
                          {activity.subject}
                        </p>
                        {activity.notes && (
                          <p
                            className="mt-1 text-sm text-gray-500 whitespace-pre-wrap"
                            data-testid={`activity-notes-${activity.id}`}
                          >
                            {activity.notes}
                          </p>
                        )}
                        <ObjectionInsights
                          activityId={activity.id}
                          hasNotes={Boolean(activity.notes)}
                        />
                        {activity.outcome && (
                          <p
                            className="mt-1 text-sm text-gray-500 whitespace-pre-wrap"
                            data-testid={`activity-outcome-${activity.id}`}
                          >
                            {activity.outcome}
                          </p>
                        )}
                        {activity.due_date && (
                          <p
                            className="mt-1 text-xs text-gray-500 whitespace-nowrap"
                            data-testid={`activity-due-date-${activity.id}`}
                          >
                            {t('activities.dueDateLabel')}: {activity.due_date}
                          </p>
                        )}
                        <p
                          className="mt-1 text-xs text-gray-500"
                          data-testid={`activity-meta-${activity.id}`}
                        >
                          {t('activities.meta', {
                            author: activity.owner_name,
                            timestamp: new Date(activity.created_at).toLocaleString(i18n.language),
                          })}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Draft email — only for activities linked to a contact (MINCRM-437) */}
                        {emailDraftEnabled && activity.contact_id && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            data-testid={`draft-email-${activity.id}`}
                            onClick={() => {
                              setEmailDraftError(null);
                              setDraftingContactId(activity.contact_id);
                              emailDraftMutation.mutate(activity.contact_id!);
                            }}
                            disabled={
                              emailDraftMutation.isPending &&
                              draftingContactId === activity.contact_id
                            }
                          >
                            {emailDraftMutation.isPending &&
                            draftingContactId === activity.contact_id
                              ? t('emailDraft.generating')
                              : t('emailDraft.draftEmailButton')}
                          </Button>
                        )}
                        {/* Mark complete — only for open tasks */}
                        {activity.type === 'Task' && activity.status === 'open' && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            data-testid={`mark-complete-${activity.id}`}
                            onClick={() =>
                              completeMutation.mutate({
                                id: activity.id,
                                version: activity.version,
                              })
                            }
                            disabled={completeMutation.isPending}
                          >
                            {completeMutation.isPending &&
                            completeMutation.variables?.id === activity.id
                              ? t('activities.markingComplete')
                              : t('activities.markComplete')}
                          </Button>
                        )}

                        {canModify(activity) && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              data-testid={`edit-activity-${activity.id}`}
                              onClick={() => setEditingId(activity.id)}
                            >
                              {t('activities.edit')}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              data-testid={`delete-activity-${activity.id}`}
                              onClick={() => handleDelete(activity)}
                              disabled={deleteMutation.isPending}
                            >
                              {t('activities.delete')}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {hasMore && (
              <div className="px-6 py-3 border-t border-gray-100 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleLimit((prev) => prev + ACTIVITY_PAGE_SIZE)}
                  disabled={isLoading}
                  data-testid="activity-timeline-load-more"
                  className="text-sm text-primary-600 hover:text-primary-800 font-medium disabled:opacity-50"
                >
                  {isLoading ? t('activities.loading') : t('pagination.loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {completeError && (
        <p role="alert" className="mt-2 text-xs text-red-600" data-testid="complete-error">
          {completeError}
        </p>
      )}
      {deleteError && (
        <p role="alert" className="mt-2 text-xs text-red-600" data-testid="delete-error">
          {deleteError}
        </p>
      )}
      {emailDraftError && (
        <p
          role="alert"
          className="mt-2 text-xs text-red-600"
          data-testid="email-draft-generate-error"
        >
          {emailDraftError}
        </p>
      )}
      {emailDraftResult && draftingContactId && (
        <EmailDraftPanel
          contactId={draftingContactId}
          initialDraft={emailDraftResult}
          onDismiss={() => {
            setEmailDraftResult(null);
            setDraftingContactId(null);
          }}
        />
      )}
    </section>
  );
}
