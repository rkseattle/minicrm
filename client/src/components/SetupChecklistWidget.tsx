/**
 * SetupChecklistWidget — floating setup checklist for first-run admins (MINCRM-379).
 *
 * Rendered at the app root; floats fixed in the bottom-right of the viewport.
 * Visible only to admin users when onboarding_completed is false.
 *
 * Expanded state is persisted to localStorage so the user's preference survives
 * page navigation.  The onboarding_completed flag lives in system_settings.
 */

import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth.js';
import {
  getOnboardingStatus,
  setOnboardingCompleted,
  ONBOARDING_STATUS_QUERY_KEY,
} from '@/api/onboarding.js';
import type { OnboardingTask } from '@/api/onboarding.js';

const LS_KEY = 'minicrm_setup_checklist_expanded';
const COMPLETION_FADE_DELAY_MS = 3000;

/** Read the collapsed/expanded preference from localStorage (defaults to expanded). */
function readExpandedPref(): boolean {
  try {
    const stored = localStorage.getItem(LS_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

function writeExpandedPref(expanded: boolean): void {
  try {
    localStorage.setItem(LS_KEY, String(expanded));
  } catch {
    // localStorage may be unavailable in some embedded contexts
  }
}

interface TaskRowProps {
  task: OnboardingTask;
  title: string;
  description: string;
  href: string;
}

function TaskRow({ task, title, description, href }: TaskRowProps) {
  const { t } = useTranslation();
  return (
    <li className="flex items-start gap-3 py-2">
      <span
        className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
          task.completed ? 'border-green-500 bg-green-500' : 'border-gray-300 bg-white'
        }`}
        aria-hidden="true"
      >
        {task.completed && (
          <svg
            className="w-3 h-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-sm font-medium ${task.completed ? 'text-gray-400 line-through' : 'text-gray-800'}`}
          >
            {title}
          </span>
          {!task.completed && (
            <Link
              to={href}
              className="flex-shrink-0 text-xs text-primary-600 hover:text-primary-800 underline underline-offset-2"
              aria-label={t('setupChecklist.goTo', { task: title })}
            >
              {t('setupChecklist.go')}
            </Link>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
    </li>
  );
}

/** Task definitions by task ID — supports both admin (5 tasks) and rep (4 tasks) */
const TASK_DEF_MAP: Record<string, { titleKey: string; descKey: string; href: string }> = {
  pipeline_stages_reviewed: {
    titleKey: 'setupChecklist.task.pipelineStages.title',
    descKey: 'setupChecklist.task.pipelineStages.description',
    href: '/admin/settings?tab=customisation',
  },
  team_member_invited: {
    titleKey: 'setupChecklist.task.inviteTeam.title',
    descKey: 'setupChecklist.task.inviteTeam.description',
    href: '/users',
  },
  first_contact_added: {
    titleKey: 'setupChecklist.task.addContact.title',
    descKey: 'setupChecklist.task.addContact.description',
    href: '/contacts',
  },
  first_account_created: {
    titleKey: 'setupChecklist.task.createAccount.title',
    descKey: 'setupChecklist.task.createAccount.description',
    href: '/accounts',
  },
  first_deal_created: {
    titleKey: 'setupChecklist.task.createDeal.title',
    descKey: 'setupChecklist.task.createDeal.description',
    href: '/deals',
  },
  smtp_configured: {
    titleKey: 'setupChecklist.task.smtp.title',
    descKey: 'setupChecklist.task.smtp.description',
    href: '/admin/settings?tab=notifications',
  },
  logged_first_activity: {
    titleKey: 'setupChecklist.task.logActivity.title',
    descKey: 'setupChecklist.task.logActivity.description',
    href: '/activities',
  },
};

export default function SetupChecklistWidget() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [expanded, setExpanded] = useState<boolean>(readExpandedPref);
  const [fadingOut, setFadingOut] = useState(false);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ONBOARDING_STATUS_QUERY_KEY,
    queryFn: getOnboardingStatus,
    // Visible to both admin and rep users (MINCRM-410)
    enabled: user?.role === 'admin' || user?.role === 'rep',
    staleTime: 0,
  });

  const dismissMutation = useMutation({
    mutationFn: () => setOnboardingCompleted(true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ONBOARDING_STATUS_QUERY_KEY });
    },
  });

  // Task count is driven by the server response — supports role-specific task lists (MINCRM-410)
  const taskCount = data?.tasks?.length ?? 0;
  const completedCount = data?.tasks?.filter((t) => t.completed).length ?? 0;
  const allDone = data !== undefined && taskCount > 0 && completedCount === taskCount;

  // When all tasks are done: auto-dismiss after COMPLETION_FADE_DELAY_MS
  useEffect(() => {
    if (!allDone) return;
    if (completionTimerRef.current) return;
    completionTimerRef.current = setTimeout(() => {
      setFadingOut(true);
      // Small delay so the fade transition is visible before the query invalidates
      setTimeout(() => {
        dismissMutation.mutate();
      }, 500);
    }, COMPLETION_FADE_DELAY_MS);
    return () => {
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  function handleToggleExpanded() {
    setExpanded((prev) => {
      const next = !prev;
      writeExpandedPref(next);
      return next;
    });
  }

  function handleDismiss() {
    dismissMutation.mutate();
  }

  // Not an authenticated user, still loading, or already completed/dismissed — render nothing
  if (user?.role !== 'admin' && user?.role !== 'rep') return null;
  if (isLoading || !data) return null;
  if (!data.is_first_run) return null;

  // Build ordered task defs from the server's task list (preserving server order)
  const taskDefs = (data.tasks ?? [])
    .map((task) => {
      const def = TASK_DEF_MAP[task.id];
      // Fall back gracefully if we receive an unknown task id
      return def ? { id: task.id, ...def } : null;
    })
    .filter((def): def is NonNullable<typeof def> => def !== null);

  const taskMap = Object.fromEntries((data.tasks ?? []).map((t) => [t.id, t]));

  // Collapsed pill
  if (!expanded) {
    return (
      <div
        className="fixed bottom-4 end-4 z-50"
        data-testid="setup-checklist-pill"
        aria-label={t('setupChecklist.pillLabel')}
      >
        <button
          type="button"
          onClick={handleToggleExpanded}
          data-testid="setup-checklist-expand-button"
          className="flex items-center gap-2 bg-white border border-gray-200 shadow-lg rounded-full px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
          aria-expanded={false}
          aria-label={t('setupChecklist.expand')}
        >
          {/* Brand mark — not a translatable string */}
          <span className="text-primary-600 font-bold text-xs" aria-hidden="true">
            {'M'}
          </span>
          <span className="text-gray-600 text-xs" aria-hidden="true">
            {t('setupChecklist.progress', { count: completedCount, total: taskCount })}
          </span>
          <svg
            className="w-3.5 h-3.5 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>
    );
  }

  // Progress bar width
  const progressPct = taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0;

  return (
    <div
      className={`fixed bottom-4 end-4 z-50 w-80 bg-white border border-gray-200 shadow-xl rounded-xl transition-opacity duration-500 ${fadingOut ? 'opacity-0' : 'opacity-100'}`}
      data-testid="setup-checklist-widget"
      role="region"
      aria-label={t('setupChecklist.widgetLabel')}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 gap-2">
        <h2 className="text-sm font-semibold text-gray-900">{t('setupChecklist.title')}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleToggleExpanded}
            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
            aria-expanded={true}
            aria-label={t('setupChecklist.collapse')}
            data-testid="setup-checklist-collapse-button"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={dismissMutation.isPending}
            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
            aria-label={t('setupChecklist.dismiss')}
            data-testid="setup-checklist-dismiss-button"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Completion celebration — shown when allDone */}
      {allDone ? (
        <div className="px-4 pb-4" data-testid="setup-checklist-complete">
          <p className="text-sm text-green-700 font-medium">{t('setupChecklist.allDone')}</p>
        </div>
      ) : (
        <>
          {/* Progress bar */}
          <div className="px-4 pb-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">
                {t('setupChecklist.progress', { count: completedCount, total: taskCount })}
              </span>
            </div>
            <div
              className="h-1.5 bg-gray-100 rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={completedCount}
              aria-valuemin={0}
              aria-valuemax={taskCount}
              aria-label={t('setupChecklist.progressBar')}
            >
              <div
                className="h-full bg-primary-500 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Task list */}
          <ul className="px-4 pb-4 divide-y divide-gray-50" data-testid="setup-checklist-task-list">
            {taskDefs.map((def) => {
              const task: OnboardingTask = taskMap[def.id] ?? { id: def.id, completed: false };
              return (
                <TaskRow
                  key={def.id}
                  task={task}
                  title={t(def.titleKey)}
                  description={t(def.descKey)}
                  href={def.href}
                />
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
