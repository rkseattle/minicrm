/**
 * SequenceDetailPage component.
 * Admin-only page for managing the steps of a single sales sequence.
 * Implements MINCRM-403.
 */

import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import NavBar from '@/components/NavBar.js';
import { Button } from '@/components/ui/Button.js';
import {
  SEQUENCES_QUERY_KEY,
  sequenceQueryKey,
  sequenceStepsQueryKey,
  getSequence,
  updateSequence,
  listSequenceSteps,
  createSequenceStep,
  updateSequenceStep,
  deleteSequenceStep,
} from '@/api/sequences.js';
import type { SequenceStepResponse } from '@shared/schemas/sequenceSchema.js';
import { SEQUENCE_STEP_ACTION_TYPES } from '@shared/schemas/sequenceSchema.js';
import { getApiErrorMessage } from '@/utils/apiError.js';

/** Blank step form state */
interface StepFormState {
  sort_order: string;
  action_type: string;
  delay_days: string;
  subject: string;
  body: string;
  notes: string;
}

const BLANK_STEP: StepFormState = {
  sort_order: '',
  action_type: 'send_email',
  delay_days: '0',
  subject: '',
  body: '',
  notes: '',
};

function buildActionConfig(form: StepFormState): Record<string, unknown> {
  if (form.action_type === 'send_email') {
    return { subject: form.subject, body: form.body };
  }
  if (form.action_type === 'log_call_reminder') {
    return { subject: form.subject, notes: form.notes || undefined };
  }
  return { subject: form.subject, notes: form.notes || undefined };
}

function stepFormFromRow(step: SequenceStepResponse): StepFormState {
  const cfg = step.action_config;
  return {
    sort_order: String(step.sort_order),
    action_type: step.action_type,
    delay_days: String(step.delay_days),
    subject: String(cfg['subject'] ?? ''),
    body: String(cfg['body'] ?? ''),
    notes: String(cfg['notes'] ?? ''),
  };
}

export default function SequenceDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isAddingStep, setIsAddingStep] = useState(false);
  const [addStepForm, setAddStepForm] = useState<StepFormState>(BLANK_STEP);
  const [addStepError, setAddStepError] = useState<string | null>(null);

  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editStepForm, setEditStepForm] = useState<StepFormState>(BLANK_STEP);
  const [editStepError, setEditStepError] = useState<string | null>(null);

  const sequenceSingleKey = sequenceQueryKey(id!);
  const stepsSingleKey = sequenceStepsQueryKey(id!);

  const {
    data: seqData,
    isLoading: seqLoading,
    isError: seqError,
  } = useQuery({
    queryKey: sequenceSingleKey,
    queryFn: () => getSequence(id!),
    enabled: Boolean(id),
  });

  const { data: stepsData, isLoading: stepsLoading } = useQuery({
    queryKey: stepsSingleKey,
    queryFn: () => listSequenceSteps(id!),
    enabled: Boolean(id),
  });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => updateSequence(id!, { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sequenceSingleKey });
      void queryClient.invalidateQueries({ queryKey: SEQUENCES_QUERY_KEY });
    },
  });

  const addStepMutation = useMutation({
    mutationFn: (form: StepFormState) =>
      createSequenceStep(id!, {
        sort_order: parseInt(form.sort_order, 10),
        action_type: form.action_type as (typeof SEQUENCE_STEP_ACTION_TYPES)[number],
        action_config: buildActionConfig(form),
        delay_days: parseInt(form.delay_days, 10),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stepsSingleKey });
      void queryClient.invalidateQueries({ queryKey: sequenceSingleKey });
      void queryClient.invalidateQueries({ queryKey: SEQUENCES_QUERY_KEY });
      setIsAddingStep(false);
      setAddStepForm(BLANK_STEP);
      setAddStepError(null);
    },
    onError: (err) => {
      setAddStepError(getApiErrorMessage(err, t('sequences.createError')));
    },
  });

  const editStepMutation = useMutation({
    mutationFn: ({ stepId, form }: { stepId: string; form: StepFormState }) =>
      updateSequenceStep(id!, stepId, {
        sort_order: parseInt(form.sort_order, 10),
        action_type: form.action_type as (typeof SEQUENCE_STEP_ACTION_TYPES)[number],
        action_config: buildActionConfig(form),
        delay_days: parseInt(form.delay_days, 10),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stepsSingleKey });
      setEditingStepId(null);
      setEditStepError(null);
    },
    onError: (err) => {
      setEditStepError(getApiErrorMessage(err, t('sequences.createError')));
    },
  });

  const deleteStepMutation = useMutation({
    mutationFn: (stepId: string) => deleteSequenceStep(id!, stepId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: stepsSingleKey });
      void queryClient.invalidateQueries({ queryKey: sequenceSingleKey });
      void queryClient.invalidateQueries({ queryKey: SEQUENCES_QUERY_KEY });
    },
  });

  const sequence = seqData?.sequence ?? null;
  const steps = stepsData?.steps ?? [];

  if (seqLoading) {
    return (
      <div>
        <NavBar />
        <main className="mx-auto max-w-3xl px-4 py-8">
          <p className="text-sm text-gray-500" data-testid="sequence-detail-loading">
            {t('sequences.loading')}
          </p>
        </main>
      </div>
    );
  }

  if (seqError || !sequence) {
    return (
      <div>
        <NavBar />
        <main className="mx-auto max-w-3xl px-4 py-8">
          <p className="text-sm text-red-600" role="alert" data-testid="sequence-detail-error">
            {t('sequences.errorLoad')}
          </p>
          <button
            data-testid="sequence-detail-back-button"
            onClick={() => navigate('/admin/sequences')}
            className="mt-4 text-sm text-blue-600 hover:underline"
          >
            ← {t('sequences.pageTitle')}
          </button>
        </main>
      </div>
    );
  }

  function handleAddStep(e: React.FormEvent) {
    e.preventDefault();
    addStepMutation.mutate(addStepForm);
  }

  function handleEditStep(e: React.FormEvent) {
    e.preventDefault();
    if (!editingStepId) return;
    editStepMutation.mutate({ stepId: editingStepId, form: editStepForm });
  }

  function handleDeleteStep(step: SequenceStepResponse) {
    if (!window.confirm(t('sequences.confirmDeleteBody'))) return;
    deleteStepMutation.mutate(step.id);
  }

  function startEditStep(step: SequenceStepResponse) {
    setEditingStepId(step.id);
    setEditStepForm(stepFormFromRow(step));
    setEditStepError(null);
  }

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-2 text-sm text-gray-500">
          <Link to="/admin/sequences" className="hover:underline">
            {t('sequences.pageTitle')}
          </Link>
          {' / '}
          <span>{sequence.name}</span>
        </div>

        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900" data-testid="sequence-detail-title">
              {t('sequences.detailTitle', { name: sequence.name })}
            </h1>
            {sequence.description && (
              <p className="mt-1 text-sm text-gray-500">{sequence.description}</p>
            )}
          </div>
          <div className="ms-4 flex items-center gap-3">
            <button
              data-testid="sequence-detail-toggle"
              aria-label={
                sequence.enabled
                  ? t('sequences.disableSequence', { name: sequence.name })
                  : t('sequences.enableSequence', { name: sequence.name })
              }
              onClick={() => toggleMutation.mutate(!sequence.enabled)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                sequence.enabled ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  sequence.enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Steps section */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{t('sequences.stepsSection')}</h2>
          <Button
            data-testid="add-step-button"
            onClick={() => {
              setIsAddingStep(true);
              setAddStepError(null);
            }}
          >
            {t('sequences.addStep')}
          </Button>
        </div>

        {stepsLoading && <p className="text-sm text-gray-500">{t('sequences.loading')}</p>}

        {!stepsLoading && steps.length === 0 && !isAddingStep && (
          <p className="text-sm text-gray-500" data-testid="steps-empty">
            {t('sequences.noSteps')}
          </p>
        )}

        {steps.map((step) => (
          <div
            key={step.id}
            data-testid={`step-row-${step.id}`}
            className="mb-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
          >
            {editingStepId === step.id ? (
              <form onSubmit={handleEditStep}>
                {editStepError && (
                  <p className="mb-2 text-sm text-red-600" role="alert">
                    {editStepError}
                  </p>
                )}
                <StepFormFields form={editStepForm} onChange={setEditStepForm} t={t} />
                <div className="mt-3 flex gap-2">
                  <Button
                    type="submit"
                    data-testid={`step-edit-submit-${step.id}`}
                    disabled={editStepMutation.isPending}
                  >
                    {t('sequences.saveSubmit')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    data-testid={`step-edit-cancel-${step.id}`}
                    onClick={() => setEditingStepId(null)}
                  >
                    {t('sequences.cancel')}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-semibold uppercase text-gray-400">
                    {t('sequences.stepSortOrder')}
                    {step.sort_order}
                  </span>
                  <p className="text-sm font-medium text-gray-900">
                    {String(t(`sequences.actionType_${step.action_type}`))}
                    {step.action_config['subject'] ? (
                      <span className="ms-1 font-normal text-gray-600">
                        — {String(step.action_config['subject'])}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-gray-500">
                    {t('sequences.stepDelayDays')}: {step.delay_days}
                  </p>
                </div>
                <div className="ms-4 flex gap-2">
                  <button
                    data-testid={`step-edit-${step.id}`}
                    onClick={() => startEditStep(step)}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    {t('sequences.editStep')}
                  </button>
                  <button
                    data-testid={`step-delete-${step.id}`}
                    onClick={() => handleDeleteStep(step)}
                    className="text-sm text-red-600 hover:underline"
                  >
                    {t('sequences.deleteStep')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {isAddingStep && (
          <form
            data-testid="add-step-form"
            onSubmit={handleAddStep}
            className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-4"
          >
            <h3 className="mb-3 text-sm font-semibold text-gray-900">{t('sequences.addStep')}</h3>
            {addStepError && (
              <p className="mb-2 text-sm text-red-600" role="alert">
                {addStepError}
              </p>
            )}
            <StepFormFields form={addStepForm} onChange={setAddStepForm} t={t} />
            <div className="mt-3 flex gap-2">
              <Button
                type="submit"
                data-testid="add-step-submit"
                disabled={addStepMutation.isPending}
              >
                {t('sequences.addStep')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                data-testid="add-step-cancel"
                onClick={() => {
                  setIsAddingStep(false);
                  setAddStepForm(BLANK_STEP);
                  setAddStepError(null);
                }}
              >
                {t('sequences.cancel')}
              </Button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

/** Reusable form fields for creating or editing a step */
function StepFormFields({
  form,
  onChange,
  t,
}: {
  form: StepFormState;
  onChange: (f: StepFormState) => void;
  t: TFunction;
}) {
  const set =
    (field: keyof StepFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...form, [field]: e.target.value });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            {t('sequences.stepSortOrder')}
          </label>
          <input
            data-testid="step-sort-order-input"
            type="number"
            min={1}
            value={form.sort_order}
            onChange={set('sort_order')}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            {t('sequences.stepActionType')}
          </label>
          <select
            data-testid="step-action-type-select"
            value={form.action_type}
            onChange={set('action_type')}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          >
            {SEQUENCE_STEP_ACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {String(t(`sequences.actionType_${type}`))}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            {t('sequences.stepDelayDays')}
          </label>
          <input
            data-testid="step-delay-days-input"
            type="number"
            min={0}
            value={form.delay_days}
            onChange={set('delay_days')}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            required
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">
          {form.action_type === 'send_email'
            ? t('sequences.emailSubject')
            : form.action_type === 'log_call_reminder'
              ? t('sequences.callSubject')
              : t('sequences.taskSubject')}
        </label>
        <input
          data-testid="step-subject-input"
          type="text"
          value={form.subject}
          onChange={set('subject')}
          placeholder={
            form.action_type === 'send_email'
              ? t('sequences.emailSubjectPlaceholder')
              : form.action_type === 'log_call_reminder'
                ? t('sequences.callSubjectPlaceholder')
                : t('sequences.taskSubjectPlaceholder')
          }
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          required
        />
      </div>

      {form.action_type === 'send_email' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            {t('sequences.emailBody')}
          </label>
          <textarea
            data-testid="step-body-input"
            value={form.body}
            onChange={set('body')}
            placeholder={t('sequences.emailBodyPlaceholder')}
            rows={3}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            required
          />
        </div>
      )}

      {(form.action_type === 'log_call_reminder' || form.action_type === 'create_task') && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            {t('sequences.taskNotes')}
          </label>
          <textarea
            data-testid="step-notes-input"
            value={form.notes}
            onChange={set('notes')}
            rows={2}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}
