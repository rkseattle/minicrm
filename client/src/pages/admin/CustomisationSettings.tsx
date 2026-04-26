/**
 * CustomisationSettings — Pipeline stage configuration.
 * Extracted from AdminSettingsPage.tsx (MINCRM-259).
 */

import { useState, useEffect, useRef, useId } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listPipelineStages,
  createPipelineStage,
  updatePipelineStage,
  deletePipelineStage,
  PIPELINE_STAGES_QUERY_KEY,
} from '@/api/pipelineStages.js';
import type { PipelineStageResponse } from '@shared/schemas/pipelineStageSchema.js';
import { Button } from '@/components/ui/Button.js';

export default function CustomisationSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const {
    data: stagesData,
    isLoading: stagesLoading,
    isError: stagesError,
  } = useQuery({
    queryKey: PIPELINE_STAGES_QUERY_KEY,
    queryFn: listPipelineStages,
    staleTime: 5 * 60 * 1000,
  });

  const stages: PipelineStageResponse[] = stagesData?.stages ?? [];

  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; probability: string }>({
    name: '',
    probability: '',
  });
  const [editRowError, setEditRowError] = useState<string | null>(null);

  const [showAddStage, setShowAddStage] = useState(false);
  const [addStageName, setAddStageName] = useState('');
  const [addStageProbability, setAddStageProbability] = useState('0');
  const [addStageError, setAddStageError] = useState<string | null>(null);

  const [deletingStageId, setDeletingStageId] = useState<string | null>(null);
  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState<string | null>(null);

  const [stagesSectionFeedback, setStagesSectionFeedback] = useState<{
    type: 'success' | 'error';
    key: string;
  } | null>(null);

  const stagesFeedbackRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (stagesSectionFeedback) stagesFeedbackRef.current?.focus();
  }, [stagesSectionFeedback]);

  const addStageInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (showAddStage) addStageInputRef.current?.focus();
  }, [showAddStage]);

  const createStageMutation = useMutation({
    mutationFn: (params: { name: string; probability: number }) => createPipelineStage(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIPELINE_STAGES_QUERY_KEY });
      setShowAddStage(false);
      setAddStageName('');
      setAddStageProbability('0');
      setAddStageError(null);
      setStagesSectionFeedback({ type: 'success', key: 'settings.pipelineStages.saveSuccess' });
    },
    onError: (err: { response?: { data?: { error?: { code?: string; message?: string } } } }) => {
      const code = err.response?.data?.error?.code;
      if (code === 'STAGE_NAME_CONFLICT') {
        setAddStageError(t('settings.pipelineStages.nameConflictError'));
      } else {
        setAddStageError(t('settings.pipelineStages.saveError'));
      }
    },
  });

  const updateStageMutation = useMutation({
    mutationFn: ({ id, name, probability }: { id: string; name?: string; probability?: number }) =>
      updatePipelineStage(id, { name, probability }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIPELINE_STAGES_QUERY_KEY });
      setEditingStageId(null);
      setEditRowError(null);
      setStagesSectionFeedback({ type: 'success', key: 'settings.pipelineStages.saveSuccess' });
    },
    onError: (err: { response?: { data?: { error?: { code?: string; message?: string } } } }) => {
      const code = err.response?.data?.error?.code;
      if (code === 'STAGE_NAME_CONFLICT') {
        setEditRowError(t('settings.pipelineStages.nameConflictError'));
      } else if (code === 'STAGE_FIXED') {
        setEditRowError(t('settings.pipelineStages.fixedBadge'));
      } else {
        setEditRowError(t('settings.pipelineStages.saveError'));
      }
    },
  });

  const reorderStageMutation = useMutation({
    mutationFn: ({ id, sort_order }: { id: string; sort_order: number }) =>
      updatePipelineStage(id, { sort_order }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIPELINE_STAGES_QUERY_KEY });
    },
    onError: () => {
      setStagesSectionFeedback({ type: 'error', key: 'settings.pipelineStages.reorderError' });
    },
  });

  const deleteStageMutation = useMutation({
    mutationFn: (id: string) => deletePipelineStage(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIPELINE_STAGES_QUERY_KEY });
      setDeletingStageId(null);
      setDeleteBlockedMessage(null);
      setStagesSectionFeedback({ type: 'success', key: 'settings.pipelineStages.deleteSuccess' });
    },
    onError: (err: {
      response?: { data?: { error?: { code?: string; message?: string; dealCount?: number } } };
    }) => {
      const code = err.response?.data?.error?.code;
      const dealCount = err.response?.data?.error?.dealCount ?? 0;
      if (code === 'STAGE_HAS_OPEN_DEALS') {
        setDeleteBlockedMessage(t('settings.pipelineStages.deleteBlocked', { count: dealCount }));
      } else {
        setStagesSectionFeedback({ type: 'error', key: 'settings.pipelineStages.deleteError' });
        setDeletingStageId(null);
      }
    },
  });

  function handleMoveUp(index: number): void {
    if (index === 0) return;
    const current = stages[index];
    const above = stages[index - 1];
    void (async () => {
      await reorderStageMutation.mutateAsync({ id: current.id, sort_order: above.sort_order });
      await reorderStageMutation.mutateAsync({ id: above.id, sort_order: current.sort_order });
    })();
  }

  function handleMoveDown(index: number): void {
    if (index === stages.length - 1) return;
    const current = stages[index];
    const below = stages[index + 1];
    void (async () => {
      await reorderStageMutation.mutateAsync({ id: current.id, sort_order: below.sort_order });
      await reorderStageMutation.mutateAsync({ id: below.id, sort_order: current.sort_order });
    })();
  }

  function startEditing(stage: PipelineStageResponse): void {
    setEditingStageId(stage.id);
    setEditDraft({ name: stage.name, probability: String(stage.probability) });
    setEditRowError(null);
  }

  function saveEdit(stage: PipelineStageResponse): void {
    const trimmedName = editDraft.name.trim();
    if (!trimmedName) {
      setEditRowError(t('settings.pipelineStages.nameRequiredError'));
      return;
    }
    if (trimmedName.length > 100) {
      setEditRowError(t('settings.pipelineStages.nameTooLongError'));
      return;
    }
    const probability = parseInt(editDraft.probability, 10);
    updateStageMutation.mutate({
      id: stage.id,
      name: stage.is_fixed ? undefined : trimmedName,
      probability: isNaN(probability) ? stage.probability : probability,
    });
  }

  function handleAddStage(): void {
    const trimmedName = addStageName.trim();
    if (!trimmedName) {
      setAddStageError(t('settings.pipelineStages.nameRequiredError'));
      return;
    }
    if (trimmedName.length > 100) {
      setAddStageError(t('settings.pipelineStages.nameTooLongError'));
      return;
    }
    const probability = parseInt(addStageProbability, 10);
    createStageMutation.mutate({
      name: trimmedName,
      probability: isNaN(probability) ? 0 : probability,
    });
  }

  const addStageFormId = useId();

  return (
    <>
      {/* ── Pipeline Stages section (MINCRM-180) ─────────────────────────── */}
      <div
        className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
        data-testid="pipeline-stages-section"
      >
        <h2
          className="text-lg font-semibold text-gray-900 mb-1"
          data-testid="pipeline-stages-section-title"
        >
          {t('settings.pipelineStages.sectionTitle')}
        </h2>
        <p className="text-xs text-gray-500 mb-4">{t('settings.pipelineStages.sectionHint')}</p>

        {stagesSectionFeedback && (
          <p
            ref={stagesFeedbackRef}
            tabIndex={-1}
            role="status"
            data-testid="pipeline-stages-feedback"
            className={`mb-3 text-sm rounded px-3 py-2 ${stagesSectionFeedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
          >
            {t(stagesSectionFeedback.key)}
          </p>
        )}

        {stagesLoading && (
          <p className="text-sm text-gray-400" data-testid="pipeline-stages-loading">
            {t('settings.loading')}
          </p>
        )}

        {stagesError && (
          <p role="alert" className="text-sm text-red-600" data-testid="pipeline-stages-error">
            {t('errors.generic')}
          </p>
        )}

        {!stagesLoading && !stagesError && (
          <>
            <table className="w-full text-sm mb-4" data-testid="pipeline-stages-table">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="pb-2 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide w-8">
                    {/* reorder buttons */}
                  </th>
                  <th className="pb-2 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('deals.stageLabel')}
                  </th>
                  <th className="pb-2 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">
                    {t('settings.pipelineStages.probabilityLabel')}
                  </th>
                  <th className="pb-2 text-end text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">
                    {/* actions */}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stages.map((stage, index) => (
                  <tr key={stage.id} data-testid={`pipeline-stage-row-${stage.id}`}>
                    <td className="py-2 pe-2">
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          aria-label={`Move ${stage.name} up`}
                          data-testid={`pipeline-stage-move-up-${stage.id}`}
                          disabled={index === 0 || reorderStageMutation.isPending}
                          onClick={() => handleMoveUp(index)}
                          className="p-0.5 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${stage.name} down`}
                          data-testid={`pipeline-stage-move-down-${stage.id}`}
                          disabled={index === stages.length - 1 || reorderStageMutation.isPending}
                          onClick={() => handleMoveDown(index)}
                          className="p-0.5 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>
                    </td>

                    <td className="py-2 pe-3">
                      {editingStageId === stage.id ? (
                        <input
                          type="text"
                          data-testid={`pipeline-stage-name-input-${stage.id}`}
                          value={editDraft.name}
                          disabled={stage.is_fixed || updateStageMutation.isPending}
                          onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                          maxLength={100}
                        />
                      ) : (
                        <span className="font-medium text-gray-800">
                          {stage.name}
                          {stage.is_fixed && (
                            <span className="ms-2 text-xs text-gray-400 font-normal">
                              {t('settings.pipelineStages.fixedBadge')}
                            </span>
                          )}
                        </span>
                      )}
                    </td>

                    <td className="py-2 pe-3">
                      {editingStageId === stage.id ? (
                        <input
                          type="number"
                          data-testid={`pipeline-stage-prob-input-${stage.id}`}
                          value={editDraft.probability}
                          min="0"
                          max="100"
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, probability: e.target.value }))
                          }
                          disabled={updateStageMutation.isPending}
                          className="w-20 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      ) : (
                        <span className="text-gray-600">
                          {t('settings.pipelineStages.probabilityValue', {
                            value: stage.probability,
                          })}
                        </span>
                      )}
                    </td>

                    <td className="py-2 text-end">
                      {editingStageId === stage.id ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            data-testid={`pipeline-stage-save-${stage.id}`}
                            disabled={updateStageMutation.isPending}
                            onClick={() => saveEdit(stage)}
                          >
                            {t('settings.pipelineStages.saveButton')}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            data-testid={`pipeline-stage-cancel-${stage.id}`}
                            onClick={() => {
                              setEditingStageId(null);
                              setEditRowError(null);
                            }}
                          >
                            {t('settings.pipelineStages.cancelButton')}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            data-testid={`pipeline-stage-edit-${stage.id}`}
                            onClick={() => startEditing(stage)}
                          >
                            {t('settings.pipelineStages.editButton')}
                          </Button>
                          {!stage.is_fixed && (
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              data-testid={`pipeline-stage-delete-${stage.id}`}
                              onClick={() => {
                                setDeletingStageId(stage.id);
                                setDeleteBlockedMessage(null);
                              }}
                            >
                              {t('settings.pipelineStages.deleteButton')}
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {editRowError && (
              <p
                role="alert"
                data-testid="pipeline-stage-edit-error"
                className="mb-3 text-sm text-red-600"
              >
                {editRowError}
              </p>
            )}

            {showAddStage ? (
              <div
                className="border border-gray-200 rounded-lg p-4 mt-2"
                data-testid="add-stage-form"
              >
                <div className="flex flex-col sm:flex-row gap-3 mb-3">
                  <div className="flex-1">
                    <label
                      htmlFor={`${addStageFormId}-name`}
                      className="block text-xs font-medium text-gray-700 mb-1"
                    >
                      {t('deals.stageLabel')}
                    </label>
                    <input
                      ref={addStageInputRef}
                      id={`${addStageFormId}-name`}
                      type="text"
                      data-testid="add-stage-name-input"
                      value={addStageName}
                      onChange={(e) => setAddStageName(e.target.value)}
                      placeholder={t('settings.pipelineStages.namePlaceholder')}
                      maxLength={100}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="w-28">
                    <label
                      htmlFor={`${addStageFormId}-prob`}
                      className="block text-xs font-medium text-gray-700 mb-1"
                    >
                      {t('settings.pipelineStages.probabilityLabel')}
                    </label>
                    <input
                      id={`${addStageFormId}-prob`}
                      type="number"
                      data-testid="add-stage-prob-input"
                      value={addStageProbability}
                      min="0"
                      max="100"
                      onChange={(e) => setAddStageProbability(e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
                {addStageError && (
                  <p
                    role="alert"
                    data-testid="add-stage-error"
                    className="mb-2 text-sm text-red-600"
                  >
                    {addStageError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    data-testid="add-stage-submit"
                    disabled={createStageMutation.isPending}
                    onClick={handleAddStage}
                  >
                    {t('settings.pipelineStages.saveButton')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="add-stage-cancel"
                    onClick={() => {
                      setShowAddStage(false);
                      setAddStageName('');
                      setAddStageProbability('0');
                      setAddStageError(null);
                    }}
                  >
                    {t('settings.pipelineStages.cancelButton')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="add-stage-button"
                onClick={() => setShowAddStage(true)}
              >
                {t('settings.pipelineStages.addButton')}
              </Button>
            )}
          </>
        )}
      </div>

      {/* Delete stage confirmation dialog */}
      {deletingStageId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-stage-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-testid="delete-stage-confirm-dialog"
        >
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3
              id="delete-stage-confirm-title"
              className="text-base font-semibold text-gray-900 mb-2"
              data-testid="delete-stage-confirm-title"
            >
              {t('settings.pipelineStages.deleteConfirmTitle')}
            </h3>
            {deleteBlockedMessage ? (
              <p
                role="alert"
                data-testid="delete-stage-blocked-message"
                className="text-sm text-red-600 mb-4"
              >
                {deleteBlockedMessage}
              </p>
            ) : (
              <p className="text-sm text-gray-600 mb-4">
                {stages.find((s) => s.id === deletingStageId)?.name}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                data-testid="delete-stage-cancel"
                onClick={() => {
                  setDeletingStageId(null);
                  setDeleteBlockedMessage(null);
                }}
              >
                {t('settings.pipelineStages.cancelButton')}
              </Button>
              {!deleteBlockedMessage && (
                <Button
                  type="button"
                  variant="danger"
                  size="md"
                  data-testid="delete-stage-confirm"
                  disabled={deleteStageMutation.isPending}
                  onClick={() => deleteStageMutation.mutate(deletingStageId)}
                >
                  {t('settings.pipelineStages.deleteButton')}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
