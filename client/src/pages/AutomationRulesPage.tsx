/**
 * AutomationRulesPage component.
 * Admin-only page for creating, enabling/disabling, and monitoring automation rules.
 *
 * Features:
 * - List all automation rules with enable/disable toggle
 * - Create a new rule via inline form (trigger + action selection)
 * - View the 20 most recent execution logs per rule
 * - Delete a rule
 *
 * Implements MINCRM-27.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import {
  AUTOMATION_RULES_QUERY_KEY,
  listAutomationRules,
  createAutomationRule,
  updateAutomationRule,
  deleteAutomationRule,
  listRuleLogs,
} from '@/api/automation.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY } from '@/api/users.js';
import {
  AUTOMATION_TRIGGER_TYPES,
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_ASSIGNEE_TYPES,
  type AutomationTriggerType,
  type AutomationActionType,
  type AutomationRuleResponse,
  type AutomationRuleLogResponse,
} from '@shared/schemas/automationSchema.js';
import { PIPELINE_STAGES } from '@shared/schemas/dealSchema.js';
import { ACTIVITY_TYPES } from '@shared/schemas/activitySchema.js';

/**
 * Formats an ISO timestamp string for display using the active i18n locale.
 *
 * @param value - ISO timestamp string or Date object
 * @param locale - BCP 47 locale tag from i18next (e.g. "en", "de", "zh-Hans")
 * @returns Locale-formatted date/time string
 */
function formatTimestamp(value: string | Date, locale: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleString(locale);
}

/** Form state for creating a new automation rule */
interface RuleFormState {
  name: string;
  trigger_type: AutomationTriggerType;
  trigger_stage: string;
  action_type: AutomationActionType;
  task_subject: string;
  task_type: string;
  assignee_type: 'owner' | 'specific';
  assignee_id: string;
  due_date_offset_days: string;
  notification_message: string;
}

const EMPTY_FORM: RuleFormState = {
  name: '',
  trigger_type: 'deal_created',
  trigger_stage: PIPELINE_STAGES[0],
  action_type: 'create_task',
  task_subject: '',
  task_type: 'Task',
  assignee_type: 'owner',
  assignee_id: '',
  due_date_offset_days: '1',
  notification_message: '',
};

/**
 * Builds the trigger_config object from form state.
 *
 * @param form - Current form state
 * @returns trigger_config record
 */
function buildTriggerConfig(form: RuleFormState): Record<string, unknown> {
  if (form.trigger_type === 'deal_stage_changed') {
    return { stage: form.trigger_stage };
  }
  return {};
}

/**
 * Builds the action_config object from form state.
 *
 * @param form - Current form state
 * @returns action_config record
 */
function buildActionConfig(form: RuleFormState): Record<string, unknown> {
  if (form.action_type === 'create_task') {
    const config: Record<string, unknown> = {
      subject: form.task_subject,
      task_type: form.task_type,
      assignee_type: form.assignee_type,
      due_date_offset_days: parseInt(form.due_date_offset_days, 10) || 0,
    };
    if (form.assignee_type === 'specific') {
      config['assignee_id'] = form.assignee_id;
    }
    return config;
  }
  return { message: form.notification_message };
}

/**
 * Props for the RuleLogsDrawer component.
 */
interface RuleLogsDrawerProps {
  rule: AutomationRuleResponse;
  onClose: () => void;
  /** Ref to the "View logs" button that opened the drawer; focus returns here on close */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

/**
 * Displays the execution logs for a single automation rule.
 */
function RuleLogsDrawer({ rule, onClose, triggerRef }: RuleLogsDrawerProps) {
  const { t, i18n } = useTranslation();
  const headingId = `logs-drawer-title-${rule.id}`;
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: [...AUTOMATION_RULES_QUERY_KEY, rule.id, 'logs'],
    queryFn: () => listRuleLogs(rule.id),
  });

  /** Closes the drawer and returns focus to the trigger button. (MINCRM-109) */
  const handleClose = useCallback((): void => {
    triggerRef.current?.focus();
    onClose();
  }, [onClose, triggerRef]);

  // Move focus to the close button when the drawer mounts (WCAG 2.4.3)
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Close the drawer when Escape is pressed from any focused child (WCAG 2.1 SC 1.4.13)
  // MINCRM-109: dependency array added to prevent listener leak on every render
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  return (
    // Backdrop — clicking the overlay background (not the panel) dismisses the drawer
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 bg-black/30 z-20 flex justify-end"
      data-testid="logs-drawer-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-xl"
        data-testid="logs-drawer"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2
              id={headingId}
              className="text-base font-semibold text-gray-900"
              data-testid="logs-drawer-title"
            >
              {t('automation.logsDrawerTitle')}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5" data-testid="logs-drawer-rule-name">
              {rule.name}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            onClick={handleClose}
            aria-label={t('automation.logsDrawerClose')}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            data-testid="logs-drawer-close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4">
          {isLoading && (
            <p className="text-sm text-gray-400" data-testid="logs-loading">
              {t('automation.logsLoading')}
            </p>
          )}

          {isError && (
            <p className="text-sm text-red-600" data-testid="logs-error">
              {t('automation.logsError')}
            </p>
          )}

          {data && data.logs.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8" data-testid="logs-empty">
              {t('automation.logsEmpty')}
            </p>
          )}

          {data && data.logs.length > 0 && (
            <ul className="divide-y divide-gray-100" data-testid="logs-list">
              {data.logs.map((log: AutomationRuleLogResponse) => (
                <li key={log.id} className="py-3" data-testid={`log-row-${log.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        log.outcome === 'success'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                      data-testid={`log-outcome-${log.id}`}
                    >
                      {log.outcome === 'success'
                        ? t('automation.logOutcomeSuccess')
                        : t('automation.logOutcomeError')}
                    </span>
                    <span className="text-xs text-gray-400" data-testid={`log-timestamp-${log.id}`}>
                      {formatTimestamp(log.triggered_at, i18n.language)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1" data-testid={`log-record-${log.id}`}>
                    {t('automation.logTriggeringRecord', {
                      type: log.triggering_record_type,
                      id: log.triggering_record_id.slice(0, 8),
                    })}
                  </p>
                  {log.error_message && (
                    <p
                      className="text-xs text-red-500 mt-1"
                      data-testid={`log-error-message-${log.id}`}
                    >
                      {log.error_message}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Automation rules admin page.
 */
export default function AutomationRulesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useQuery({
    queryKey: AUTOMATION_RULES_QUERY_KEY,
    queryFn: listAutomationRules,
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
  });

  // ── UI state ───────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedLogsRule, setSelectedLogsRule] = useState<AutomationRuleResponse | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  /** Ref to the "View logs" button that last opened the drawer, for focus restoration on close */
  const logsButtonRef = useRef<HTMLButtonElement | null>(null);
  /** Stable callback passed to RuleLogsDrawer so handleClose useCallback dep doesn't churn (MINCRM-109) */
  const handleCloseLogsDrawer = useCallback(() => setSelectedLogsRule(null), []);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: createAutomationRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTOMATION_RULES_QUERY_KEY });
      setShowForm(false);
      setForm(EMPTY_FORM);
      setFormError(null);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : t('automation.createError');
      setFormError(message);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateAutomationRule(id, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTOMATION_RULES_QUERY_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAutomationRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTOMATION_RULES_QUERY_KEY });
      setDeleteConfirmId(null);
    },
  });

  // ── Form field helpers ─────────────────────────────────────────────────────
  /**
   * Updates a single field in the form state.
   *
   * @param field - The field key to update
   * @param value - The new value
   */
  function setField<K extends keyof RuleFormState>(field: K, value: RuleFormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
  }

  // ── Form submission ────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.name.trim()) {
      setFormError(t('automation.validationNameRequired'));
      return;
    }

    if (form.action_type === 'create_task' && !form.task_subject.trim()) {
      setFormError(t('automation.validationTaskSubjectRequired'));
      return;
    }

    if (
      form.action_type === 'create_task' &&
      form.assignee_type === 'specific' &&
      !form.assignee_id
    ) {
      setFormError(t('automation.validationAssigneeRequired'));
      return;
    }

    if (form.action_type === 'send_notification' && !form.notification_message.trim()) {
      setFormError(t('automation.validationMessageRequired'));
      return;
    }

    createMutation.mutate({
      name: form.name,
      enabled: true,
      trigger_type: form.trigger_type,
      trigger_config: buildTriggerConfig(form),
      action_type: form.action_type,
      action_config: buildActionConfig(form),
    });
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  /**
   * Renders a human-readable trigger description for a rule.
   *
   * @param rule - The automation rule
   * @returns Formatted trigger description string
   */
  function formatTrigger(rule: AutomationRuleResponse): string {
    if (rule.trigger_type === 'deal_stage_changed') {
      const stage = (rule.trigger_config as { stage?: string }).stage ?? '';
      return t('automation.triggerDealStageChanged', { stage });
    }
    if (rule.trigger_type === 'deal_created') return t('automation.triggerDealCreated');
    if (rule.trigger_type === 'contact_created') return t('automation.triggerContactCreated');
    return rule.trigger_type;
  }

  /**
   * Renders a human-readable action description for a rule.
   *
   * @param rule - The automation rule
   * @returns Formatted action description string
   */
  function formatAction(rule: AutomationRuleResponse): string {
    if (rule.action_type === 'create_task') {
      const config = rule.action_config as { subject?: string };
      return t('automation.actionCreateTask', { subject: config.subject ?? '' });
    }
    if (rule.action_type === 'send_notification') {
      return t('automation.actionSendNotification');
    }
    return rule.action_type;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Page header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900" data-testid="automation-rules-heading">
              {t('automation.pageTitle')}
            </h1>
            <p className="text-sm text-gray-500 mt-1">{t('automation.subtitle')}</p>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              data-testid="new-rule-button"
            >
              {t('automation.newRuleButton')}
            </button>
          )}
        </div>

        {/* Create rule form */}
        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-lg border border-gray-200 p-6 mb-6"
            data-testid="create-rule-form"
          >
            <h2 className="text-base font-semibold text-gray-900 mb-4">
              {t('automation.createFormTitle')}
            </h2>

            {/* Rule name */}
            <div className="mb-4">
              <label htmlFor="rule-name" className="block text-sm font-medium text-gray-700 mb-1">
                {t('automation.fieldName')}
              </label>
              <input
                id="rule-name"
                type="text"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder={t('automation.fieldNamePlaceholder')}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
                data-testid="rule-name-input"
              />
            </div>

            {/* Trigger type */}
            <div className="mb-4">
              <label
                htmlFor="trigger-type"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('automation.fieldTrigger')}
              </label>
              <select
                id="trigger-type"
                value={form.trigger_type}
                onChange={(e) => setField('trigger_type', e.target.value as AutomationTriggerType)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
                data-testid="trigger-type-select"
              >
                {AUTOMATION_TRIGGER_TYPES.map((tt) => (
                  <option key={tt} value={tt}>
                    {t(`automation.triggerOption_${tt}`)}
                  </option>
                ))}
              </select>
            </div>

            {/* Stage selector — only for deal_stage_changed */}
            {form.trigger_type === 'deal_stage_changed' && (
              <div className="mb-4 ms-4">
                <label
                  htmlFor="trigger-stage"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('automation.fieldTriggerStage')}
                </label>
                <select
                  id="trigger-stage"
                  value={form.trigger_stage}
                  onChange={(e) => setField('trigger_stage', e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
                  data-testid="trigger-stage-select"
                >
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Action type */}
            <div className="mb-4">
              <label htmlFor="action-type" className="block text-sm font-medium text-gray-700 mb-1">
                {t('automation.fieldAction')}
              </label>
              <select
                id="action-type"
                value={form.action_type}
                onChange={(e) => setField('action_type', e.target.value as AutomationActionType)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
                data-testid="action-type-select"
              >
                {AUTOMATION_ACTION_TYPES.map((at) => (
                  <option key={at} value={at}>
                    {t(`automation.actionOption_${at}`)}
                  </option>
                ))}
              </select>
            </div>

            {/* create_task action fields */}
            {form.action_type === 'create_task' && (
              <div className="ms-4 space-y-4 mb-4">
                {/* Task subject */}
                <div>
                  <label
                    htmlFor="task-subject"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    {t('automation.fieldTaskSubject')}
                  </label>
                  <input
                    id="task-subject"
                    type="text"
                    value={form.task_subject}
                    onChange={(e) => setField('task_subject', e.target.value)}
                    placeholder={t('automation.fieldTaskSubjectPlaceholder')}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
                    data-testid="task-subject-input"
                  />
                </div>

                {/* Task type */}
                <div>
                  <label
                    htmlFor="task-type"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    {t('automation.fieldTaskType')}
                  </label>
                  <select
                    id="task-type"
                    value={form.task_type}
                    onChange={(e) => setField('task_type', e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
                    data-testid="task-type-select"
                  >
                    {ACTIVITY_TYPES.map((at) => (
                      <option key={at} value={at}>
                        {at}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Assignee type */}
                <div>
                  <label
                    htmlFor="assignee-type"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    {t('automation.fieldAssigneeType')}
                  </label>
                  <select
                    id="assignee-type"
                    value={form.assignee_type}
                    onChange={(e) =>
                      setField('assignee_type', e.target.value as 'owner' | 'specific')
                    }
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
                    data-testid="assignee-type-select"
                  >
                    {AUTOMATION_ASSIGNEE_TYPES.map((a) => (
                      <option key={a} value={a}>
                        {t(`automation.assigneeOption_${a}`)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Specific assignee user picker */}
                {form.assignee_type === 'specific' && (
                  <div>
                    <label
                      htmlFor="assignee-user"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      {t('automation.fieldAssigneeUser')}
                    </label>
                    <select
                      id="assignee-user"
                      value={form.assignee_id}
                      onChange={(e) => setField('assignee_id', e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
                      data-testid="assignee-user-select"
                    >
                      <option value="">{t('automation.assigneeUserPlaceholder')}</option>
                      {activeUsersData?.users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Due date offset */}
                <div>
                  <label
                    htmlFor="due-date-offset"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    {t('automation.fieldDueDateOffset')}
                  </label>
                  <input
                    id="due-date-offset"
                    type="number"
                    min={0}
                    value={form.due_date_offset_days}
                    onChange={(e) => setField('due_date_offset_days', e.target.value)}
                    className="w-32 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
                    data-testid="due-date-offset-input"
                  />
                  <span className="ms-2 text-sm text-gray-500">
                    {t('automation.dueDateOffsetUnit')}
                  </span>
                </div>
              </div>
            )}

            {/* send_notification inline hint — MINCRM-54 */}
            {form.action_type === 'send_notification' && (
              <p
                className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2"
                data-testid="send-notification-hint"
              >
                {t('automation.sendNotificationHint')}
              </p>
            )}

            {/* send_notification action fields */}
            {form.action_type === 'send_notification' && (
              <div className="ms-4 mb-4">
                <label
                  htmlFor="notification-message"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('automation.fieldNotificationMessage')}
                </label>
                <textarea
                  id="notification-message"
                  rows={3}
                  value={form.notification_message}
                  onChange={(e) => setField('notification_message', e.target.value)}
                  placeholder={t('automation.fieldNotificationMessagePlaceholder')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
                  data-testid="notification-message-input"
                />
              </div>
            )}

            {/* Form error */}
            {formError && (
              <p role="alert" className="text-sm text-red-600 mb-4" data-testid="form-error">
                {formError}
              </p>
            )}

            {/* Form actions */}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                data-testid="create-rule-submit"
              >
                {createMutation.isPending
                  ? t('automation.createSubmitting')
                  : t('automation.createSubmit')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setForm(EMPTY_FORM);
                  setFormError(null);
                }}
                className="text-sm font-medium text-gray-600 hover:text-gray-900 px-4 py-2 rounded-md border border-gray-200 hover:bg-gray-50"
                data-testid="create-rule-cancel"
              >
                {t('automation.cancel')}
              </button>
            </div>
          </form>
        )}

        {/* Rules list */}
        {isLoading && (
          <p className="text-sm text-gray-400" data-testid="rules-loading">
            {t('automation.loading')}
          </p>
        )}

        {isError && (
          <p role="alert" className="text-sm text-red-600" data-testid="rules-error">
            {t('automation.errorLoad')}
          </p>
        )}

        {data && data.rules.length === 0 && !showForm && (
          <p className="text-sm text-gray-400 text-center py-12" data-testid="rules-empty">
            {t('automation.empty')}
          </p>
        )}

        {data && data.rules.length > 0 && (
          <div
            className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100"
            data-testid="rules-list"
          >
            {data.rules.map((rule: AutomationRuleResponse) => (
              <div
                key={rule.id}
                className="px-6 py-4 flex items-start gap-4"
                data-testid={`rule-row-${rule.id}`}
              >
                {/* Enable/disable toggle */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={rule.enabled}
                  aria-label={
                    rule.enabled
                      ? t('automation.disableRule', { name: rule.name })
                      : t('automation.enableRule', { name: rule.name })
                  }
                  onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled })}
                  disabled={toggleMutation.isPending}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 mt-0.5 ${
                    rule.enabled ? 'bg-indigo-600' : 'bg-gray-200'
                  }`}
                  data-testid={`rule-toggle-${rule.id}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                      rule.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>

                {/* Rule info */}
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium text-gray-900"
                    data-testid={`rule-name-${rule.id}`}
                  >
                    {rule.name}
                  </p>
                  <p
                    className="text-xs text-gray-500 mt-0.5"
                    data-testid={`rule-trigger-${rule.id}`}
                  >
                    {t('automation.when')} {formatTrigger(rule)}
                  </p>
                  <p className="text-xs text-gray-500" data-testid={`rule-action-${rule.id}`}>
                    {t('automation.then')} {formatAction(rule)}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      logsButtonRef.current = e.currentTarget;
                      setSelectedLogsRule(rule);
                    }}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium min-h-[44px] sm:min-h-0 flex items-center"
                    data-testid={`view-logs-${rule.id}`}
                  >
                    {t('automation.viewLogs')}
                  </button>

                  {deleteConfirmId === rule.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(rule.id)}
                        disabled={deleteMutation.isPending}
                        className="text-xs text-red-600 hover:text-red-800 font-medium min-h-[44px] sm:min-h-0 flex items-center"
                        data-testid={`confirm-delete-${rule.id}`}
                      >
                        {t('automation.confirmDelete')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(null)}
                        className="text-xs text-gray-500 hover:text-gray-700 min-h-[44px] sm:min-h-0 flex items-center"
                        data-testid={`cancel-delete-${rule.id}`}
                      >
                        {t('automation.cancel')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(rule.id)}
                      className="text-xs text-gray-400 hover:text-red-600 min-h-[44px] sm:min-h-0 flex items-center"
                      data-testid={`delete-rule-${rule.id}`}
                    >
                      {t('automation.delete')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Execution logs drawer */}
      {selectedLogsRule && (
        <RuleLogsDrawer
          rule={selectedLogsRule}
          onClose={handleCloseLogsDrawer}
          triggerRef={logsButtonRef}
        />
      )}
    </div>
  );
}
