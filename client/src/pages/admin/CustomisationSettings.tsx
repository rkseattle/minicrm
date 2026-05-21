/**
 * CustomisationSettings — Pipeline stage configuration and custom fields. (MINCRM-259, MINCRM-276)
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
  reorderPipelineStages,
  PIPELINE_STAGES_QUERY_KEY,
} from '@/api/pipelineStages.js';
import {
  listCustomFieldDefinitions,
  createCustomFieldDefinition,
  updateCustomFieldDefinition,
  deleteCustomFieldDefinition,
  CUSTOM_FIELD_DEFINITIONS_QUERY_KEY,
} from '@/api/customFields.js';
import type { PipelineStageResponse } from '@shared/schemas/pipelineStageSchema.js';
import type {
  CustomFieldDefinitionResponse,
  FieldType,
} from '@shared/schemas/customFieldSchema.js';
import { Button } from '@/components/ui/Button.js';

type EntityType = 'contact' | 'account' | 'deal';

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
    mutationFn: (orderedIds: string[]) => reorderPipelineStages({ stages: orderedIds }),
    onSuccess: async (data) => {
      // Cancel any in-flight background refetch before seeding the cache so a
      // stale GET cannot overwrite the authoritative reorder result (MINCRM-387).
      await queryClient.cancelQueries({ queryKey: PIPELINE_STAGES_QUERY_KEY });
      queryClient.setQueryData(PIPELINE_STAGES_QUERY_KEY, data);
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

  function buildReorderedIds(fromIndex: number, toIndex: number): string[] {
    const ids = stages.map((s) => s.id);
    const moved = ids[fromIndex];
    const without = ids.filter((_, i) => i !== fromIndex);
    without.splice(toIndex, 0, moved);
    return without;
  }

  function handleMoveUp(index: number): void {
    if (index === 0) return;
    reorderStageMutation.mutate(buildReorderedIds(index, index - 1));
  }

  function handleMoveDown(index: number): void {
    if (index === stages.length - 1) return;
    reorderStageMutation.mutate(buildReorderedIds(index, index + 1));
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

  // ── Custom Fields state ────────────────────────────────────────────────
  const [selectedEntityType, setSelectedEntityType] = useState<EntityType>('contact');

  const customFieldsQueryKey = [...CUSTOM_FIELD_DEFINITIONS_QUERY_KEY, selectedEntityType] as const;

  const {
    data: customFieldsData,
    isLoading: customFieldsLoading,
    isError: customFieldsError,
  } = useQuery({
    queryKey: customFieldsQueryKey,
    queryFn: () => listCustomFieldDefinitions(selectedEntityType),
  });

  const customFields: CustomFieldDefinitionResponse[] = customFieldsData?.definitions ?? [];

  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editFieldDraft, setEditFieldDraft] = useState<{ name: string; options: string }>({
    name: '',
    options: '',
  });
  const [editFieldError, setEditFieldError] = useState<string | null>(null);

  const [showAddField, setShowAddField] = useState(false);
  const [addFieldName, setAddFieldName] = useState('');
  const [addFieldType, setAddFieldType] = useState<FieldType>('text');
  const [addFieldOptions, setAddFieldOptions] = useState('');
  const [addFieldError, setAddFieldError] = useState<string | null>(null);

  const [deletingFieldId, setDeletingFieldId] = useState<string | null>(null);
  const [fieldsSectionFeedback, setFieldsSectionFeedback] = useState<{
    type: 'success' | 'error';
    key: string;
  } | null>(null);

  const fieldsFeedbackRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (fieldsSectionFeedback) fieldsFeedbackRef.current?.focus();
  }, [fieldsSectionFeedback]);

  const addFieldInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (showAddField) addFieldInputRef.current?.focus();
  }, [showAddField]);

  const createFieldMutation = useMutation({
    mutationFn: (params: {
      entity_type: EntityType;
      name: string;
      field_type: FieldType;
      options?: string[] | null;
    }) => createCustomFieldDefinition(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customFieldsQueryKey });
      setShowAddField(false);
      setAddFieldName('');
      setAddFieldType('text');
      setAddFieldOptions('');
      setAddFieldError(null);
      setFieldsSectionFeedback({ type: 'success', key: 'settings.customFields.saveSuccess' });
    },
    onError: (err: { response?: { data?: { error?: { code?: string } } } }) => {
      const code = err.response?.data?.error?.code;
      if (code === 'CUSTOM_FIELD_NAME_CONFLICT') {
        setAddFieldError(t('settings.customFields.nameConflictError'));
      } else {
        setAddFieldError(t('settings.customFields.saveError'));
      }
    },
  });

  const updateFieldMutation = useMutation({
    mutationFn: ({ id, name, options }: { id: string; name: string; options?: string[] | null }) =>
      updateCustomFieldDefinition(id, { name, options }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customFieldsQueryKey });
      setEditingFieldId(null);
      setEditFieldError(null);
      setFieldsSectionFeedback({ type: 'success', key: 'settings.customFields.saveSuccess' });
    },
    onError: (err: { response?: { data?: { error?: { code?: string } } } }) => {
      const code = err.response?.data?.error?.code;
      if (code === 'CUSTOM_FIELD_NAME_CONFLICT') {
        setEditFieldError(t('settings.customFields.nameConflictError'));
      } else {
        setEditFieldError(t('settings.customFields.saveError'));
      }
    },
  });

  const deleteFieldMutation = useMutation({
    mutationFn: (id: string) => deleteCustomFieldDefinition(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customFieldsQueryKey });
      setDeletingFieldId(null);
      setFieldsSectionFeedback({ type: 'success', key: 'settings.customFields.deleteSuccess' });
    },
    onError: () => {
      setFieldsSectionFeedback({ type: 'error', key: 'settings.customFields.deleteError' });
      setDeletingFieldId(null);
    },
  });

  function startEditingField(field: CustomFieldDefinitionResponse): void {
    setEditingFieldId(field.id);
    setEditFieldDraft({
      name: field.name,
      options: field.options ? field.options.join(', ') : '',
    });
    setEditFieldError(null);
  }

  function saveFieldEdit(field: CustomFieldDefinitionResponse): void {
    const trimmedName = editFieldDraft.name.trim();
    if (!trimmedName) {
      setEditFieldError(t('settings.customFields.nameRequiredError'));
      return;
    }
    if (trimmedName.length > 100) {
      setEditFieldError(t('settings.customFields.nameTooLongError'));
      return;
    }
    const options =
      field.field_type === 'select'
        ? editFieldDraft.options
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : null;
    updateFieldMutation.mutate({ id: field.id, name: trimmedName, options });
  }

  function handleAddField(): void {
    const trimmedName = addFieldName.trim();
    if (!trimmedName) {
      setAddFieldError(t('settings.customFields.nameRequiredError'));
      return;
    }
    if (trimmedName.length > 100) {
      setAddFieldError(t('settings.customFields.nameTooLongError'));
      return;
    }
    const options =
      addFieldType === 'select'
        ? addFieldOptions
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : null;
    createFieldMutation.mutate({
      entity_type: selectedEntityType,
      name: trimmedName,
      field_type: addFieldType,
      options,
    });
  }

  const addFieldFormId = useId();

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
          <p className="text-sm text-gray-500" data-testid="pipeline-stages-loading">
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
                          className="p-0.5 rounded text-gray-500 hover:text-gray-600 disabled:opacity-30"
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
                          className="p-0.5 rounded text-gray-500 hover:text-gray-600 disabled:opacity-30"
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
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50"
                          maxLength={100}
                        />
                      ) : (
                        <span className="font-medium text-gray-800">
                          {stage.name}
                          {stage.is_fixed && (
                            <span className="ms-2 text-xs text-gray-500 font-normal">
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
                          className="w-20 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
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

      {/* ── Custom Fields section (MINCRM-276) ──────────────────────────── */}
      <div
        className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl mt-6"
        data-testid="custom-fields-section"
      >
        <h2
          className="text-lg font-semibold text-gray-900 mb-1"
          data-testid="custom-fields-section-title"
        >
          {t('settings.customFields.sectionTitle')}
        </h2>
        <p className="text-xs text-gray-500 mb-4">{t('settings.customFields.sectionHint')}</p>

        {/* Entity type selector */}
        <div className="mb-4">
          <label
            htmlFor="custom-fields-entity-select"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            {t('settings.customFields.entityTypeLabel')}
          </label>
          <select
            id="custom-fields-entity-select"
            data-testid="custom-fields-entity-select"
            value={selectedEntityType}
            onChange={(e) => setSelectedEntityType(e.target.value as EntityType)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="contact">{t('settings.customFields.entityContact')}</option>
            <option value="account">{t('settings.customFields.entityAccount')}</option>
            <option value="deal">{t('settings.customFields.entityDeal')}</option>
          </select>
        </div>

        {fieldsSectionFeedback && (
          <p
            ref={fieldsFeedbackRef}
            tabIndex={-1}
            role="status"
            data-testid="custom-fields-feedback"
            className={`mb-3 text-sm rounded px-3 py-2 ${fieldsSectionFeedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
          >
            {t(fieldsSectionFeedback.key)}
          </p>
        )}

        {customFieldsLoading && (
          <p className="text-sm text-gray-500" data-testid="custom-fields-loading">
            {t('settings.loading')}
          </p>
        )}

        {customFieldsError && (
          <p role="alert" className="text-sm text-red-600" data-testid="custom-fields-error">
            {t('errors.generic')}
          </p>
        )}

        {!customFieldsLoading && !customFieldsError && (
          <>
            {customFields.length > 0 && (
              <table className="w-full text-sm mb-4" data-testid="custom-fields-table">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="pb-2 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('settings.customFields.nameLabel')}
                    </th>
                    <th className="pb-2 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">
                      {t('settings.customFields.fieldTypeLabel')}
                    </th>
                    <th className="pb-2 text-end text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">
                      {/* actions */}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {customFields.map((field) => (
                    <tr key={field.id} data-testid={`custom-field-row-${field.id}`}>
                      <td className="py-2 pe-3">
                        {editingFieldId === field.id ? (
                          <input
                            type="text"
                            data-testid={`custom-field-name-input-${field.id}`}
                            value={editFieldDraft.name}
                            disabled={updateFieldMutation.isPending}
                            onChange={(e) =>
                              setEditFieldDraft((d) => ({ ...d, name: e.target.value }))
                            }
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50"
                            maxLength={100}
                          />
                        ) : (
                          <span className="font-medium text-gray-800">{field.name}</span>
                        )}
                        {editingFieldId === field.id && field.field_type === 'select' && (
                          <textarea
                            data-testid={`custom-field-options-input-${field.id}`}
                            value={editFieldDraft.options}
                            disabled={updateFieldMutation.isPending}
                            onChange={(e) =>
                              setEditFieldDraft((d) => ({ ...d, options: e.target.value }))
                            }
                            placeholder={t('settings.customFields.optionsPlaceholder')}
                            rows={2}
                            className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50"
                          />
                        )}
                      </td>
                      <td className="py-2 pe-3 text-gray-600 text-sm">
                        {t(
                          `settings.customFields.fieldType${field.field_type.charAt(0).toUpperCase()}${field.field_type.slice(1)}`,
                        )}
                      </td>
                      <td className="py-2 text-end">
                        {editingFieldId === field.id ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              data-testid={`custom-field-save-${field.id}`}
                              disabled={updateFieldMutation.isPending}
                              onClick={() => saveFieldEdit(field)}
                            >
                              {t('settings.customFields.saveButton')}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              data-testid={`custom-field-cancel-${field.id}`}
                              onClick={() => {
                                setEditingFieldId(null);
                                setEditFieldError(null);
                              }}
                            >
                              {t('settings.customFields.cancelButton')}
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              data-testid={`custom-field-edit-${field.id}`}
                              onClick={() => startEditingField(field)}
                            >
                              {t('settings.customFields.editButton')}
                            </Button>
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              data-testid={`custom-field-delete-${field.id}`}
                              onClick={() => setDeletingFieldId(field.id)}
                            >
                              {t('settings.customFields.deleteButton')}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {editFieldError && (
              <p
                role="alert"
                data-testid="custom-field-edit-error"
                className="mb-3 text-sm text-red-600"
              >
                {editFieldError}
              </p>
            )}

            {showAddField ? (
              <div
                className="border border-gray-200 rounded-lg p-4 mt-2"
                data-testid="add-field-form"
              >
                <div className="flex flex-col sm:flex-row gap-3 mb-3">
                  <div className="flex-1">
                    <label
                      htmlFor={`${addFieldFormId}-name`}
                      className="block text-xs font-medium text-gray-700 mb-1"
                    >
                      {t('settings.customFields.nameLabel')}
                    </label>
                    <input
                      ref={addFieldInputRef}
                      id={`${addFieldFormId}-name`}
                      type="text"
                      data-testid="add-field-name-input"
                      value={addFieldName}
                      onChange={(e) => setAddFieldName(e.target.value)}
                      placeholder={t('settings.customFields.namePlaceholder')}
                      maxLength={100}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div className="w-36">
                    <label
                      htmlFor={`${addFieldFormId}-type`}
                      className="block text-xs font-medium text-gray-700 mb-1"
                    >
                      {t('settings.customFields.fieldTypeLabel')}
                    </label>
                    <select
                      id={`${addFieldFormId}-type`}
                      data-testid="add-field-type-select"
                      value={addFieldType}
                      onChange={(e) => setAddFieldType(e.target.value as FieldType)}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="text">{t('settings.customFields.fieldTypeText')}</option>
                      <option value="number">{t('settings.customFields.fieldTypeNumber')}</option>
                      <option value="date">{t('settings.customFields.fieldTypeDate')}</option>
                      <option value="boolean">{t('settings.customFields.fieldTypeBoolean')}</option>
                      <option value="select">{t('settings.customFields.fieldTypeSelect')}</option>
                    </select>
                  </div>
                </div>
                {addFieldType === 'select' && (
                  <div className="mb-3">
                    <label
                      htmlFor={`${addFieldFormId}-options`}
                      className="block text-xs font-medium text-gray-700 mb-1"
                    >
                      {t('settings.customFields.optionsLabel')}
                    </label>
                    <textarea
                      id={`${addFieldFormId}-options`}
                      data-testid="add-field-options-input"
                      value={addFieldOptions}
                      onChange={(e) => setAddFieldOptions(e.target.value)}
                      placeholder={t('settings.customFields.optionsPlaceholder')}
                      rows={2}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                )}
                {addFieldError && (
                  <p
                    role="alert"
                    data-testid="add-field-error"
                    className="mb-2 text-sm text-red-600"
                  >
                    {addFieldError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    data-testid="add-field-submit"
                    disabled={createFieldMutation.isPending}
                    onClick={handleAddField}
                  >
                    {t('settings.customFields.saveButton')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="add-field-cancel"
                    onClick={() => {
                      setShowAddField(false);
                      setAddFieldName('');
                      setAddFieldType('text');
                      setAddFieldOptions('');
                      setAddFieldError(null);
                    }}
                  >
                    {t('settings.customFields.cancelButton')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="add-field-button"
                onClick={() => setShowAddField(true)}
              >
                {t('settings.customFields.addButton')}
              </Button>
            )}
          </>
        )}
      </div>

      {/* Delete custom field confirmation dialog */}
      {deletingFieldId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-field-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-testid="delete-field-confirm-dialog"
        >
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3
              id="delete-field-confirm-title"
              className="text-base font-semibold text-gray-900 mb-2"
            >
              {t('settings.customFields.deleteConfirmTitle')}
            </h3>
            <p className="text-sm text-gray-600 mb-1">
              {customFields.find((f) => f.id === deletingFieldId)?.name}
            </p>
            <p className="text-sm text-gray-500 mb-4">
              {t('settings.customFields.deleteConfirmBody')}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                data-testid="delete-field-cancel"
                onClick={() => setDeletingFieldId(null)}
              >
                {t('settings.customFields.cancelButton')}
              </Button>
              <Button
                type="button"
                variant="danger"
                size="md"
                data-testid="delete-field-confirm"
                disabled={deleteFieldMutation.isPending}
                onClick={() => deleteFieldMutation.mutate(deletingFieldId)}
              >
                {t('settings.customFields.deleteButton')}
              </Button>
            </div>
          </div>
        </div>
      )}

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
