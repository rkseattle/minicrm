/**
 * CustomisationSettings — Pipeline stage configuration and custom fields.
 * Extracted from AdminSettingsPage.tsx.
 */

import { useState, useEffect, useRef, useId, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listPipelineStages,
  createPipelineStage,
  updatePipelineStage,
  deletePipelineStage,
  reorderPipelineStages,
  pipelineStagesQueryKey,
} from '@/api/pipelineStages.js';
import {
  listPipelines,
  createPipeline,
  updatePipeline,
  deletePipeline,
  PIPELINES_QUERY_KEY,
} from '@/api/pipelines.js';
import type { PipelineResponse } from '@shared/schemas/pipelineSchema.js';
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

  // ── Pipeline management ──────────────────────────────────────
  const { data: pipelinesData, isLoading: pipelinesLoading } = useQuery({
    queryKey: PIPELINES_QUERY_KEY,
    queryFn: listPipelines,
    staleTime: 5 * 60 * 1000,
  });

  const pipelines: PipelineResponse[] = pipelinesData?.pipelines ?? [];
  const defaultPipeline = pipelines.find((p) => p.is_default);

  const [selectedPipelineId, setSelectedPipelineId] = useState<string | undefined>(undefined);

  // selectedPipelineId is set only when the user explicitly picks a pipeline;
  // falls back to the default pipeline once query data arrives.
  const activePipelineId = selectedPipelineId ?? defaultPipeline?.id;

  const [showAddPipeline, setShowAddPipeline] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [addPipelineError, setAddPipelineError] = useState<string | null>(null);
  const [editingPipelineId, setEditingPipelineId] = useState<string | null>(null);
  const [editPipelineName, setEditPipelineName] = useState('');
  const [editPipelineError, setEditPipelineError] = useState<string | null>(null);
  const [deletingPipelineId, setDeletingPipelineId] = useState<string | null>(null);
  const [deletePipelineBlockedMessage, setDeletePipelineBlockedMessage] = useState<string | null>(
    null,
  );
  const [pipelinesFeedback, setPipelinesFeedback] = useState<{
    type: 'success' | 'error';
    key: string;
  } | null>(null);

  const pipelinesFeedbackRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (pipelinesFeedback) pipelinesFeedbackRef.current?.focus();
  }, [pipelinesFeedback]);

  const addPipelineInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (showAddPipeline) addPipelineInputRef.current?.focus();
  }, [showAddPipeline]);

  const createPipelineMutation = useMutation({
    mutationFn: (name: string) => createPipeline({ name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIPELINES_QUERY_KEY });
      setShowAddPipeline(false);
      setNewPipelineName('');
      setAddPipelineError(null);
      setPipelinesFeedback({ type: 'success', key: 'settings.pipelines.saveSuccess' });
    },
    onError: (err: { response?: { data?: { error?: { code?: string } } } }) => {
      const code = err.response?.data?.error?.code;
      if (code === 'PIPELINE_NAME_CONFLICT') {
        setAddPipelineError(t('settings.pipelines.nameConflictError'));
      } else {
        setAddPipelineError(t('settings.pipelines.saveError'));
      }
    },
  });

  const updatePipelineMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updatePipeline(id, { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIPELINES_QUERY_KEY });
      setEditingPipelineId(null);
      setEditPipelineName('');
      setEditPipelineError(null);
      setPipelinesFeedback({ type: 'success', key: 'settings.pipelines.saveSuccess' });
    },
    onError: (err: { response?: { data?: { error?: { code?: string } } } }) => {
      const code = err.response?.data?.error?.code;
      if (code === 'PIPELINE_NAME_CONFLICT') {
        setEditPipelineError(t('settings.pipelines.nameConflictError'));
      } else {
        setEditPipelineError(t('settings.pipelines.saveError'));
      }
    },
  });

  const deletePipelineMutation = useMutation({
    mutationFn: (id: string) => deletePipeline(id),
    onSuccess: (_, deletedId) => {
      void queryClient.invalidateQueries({ queryKey: PIPELINES_QUERY_KEY });
      setDeletingPipelineId(null);
      setDeletePipelineBlockedMessage(null);
      if (selectedPipelineId === deletedId) {
        setSelectedPipelineId(defaultPipeline?.id);
      }
      setPipelinesFeedback({ type: 'success', key: 'settings.pipelines.deleteSuccess' });
    },
    onError: (err: { response?: { data?: { error?: { code?: string; dealCount?: number } } } }) => {
      const code = err.response?.data?.error?.code;
      const dealCount = err.response?.data?.error?.dealCount ?? 0;
      if (code === 'PIPELINE_DEFAULT') {
        setDeletePipelineBlockedMessage(t('settings.pipelines.defaultDeleteBlocked'));
      } else if (code === 'PIPELINE_HAS_DEALS') {
        setDeletePipelineBlockedMessage(
          t('settings.pipelines.deleteBlocked', { count: dealCount }),
        );
      } else {
        setDeletePipelineBlockedMessage(t('settings.pipelines.deleteError'));
      }
    },
  });

  // ── Per-pipeline stage list ────────────────────────────────────────────────
  const {
    data: stagesData,
    isLoading: stagesLoading,
    isError: stagesError,
  } = useQuery({
    queryKey: pipelineStagesQueryKey(activePipelineId),
    queryFn: () => listPipelineStages(activePipelineId),
    enabled: !!activePipelineId,
  });

  const stages: PipelineStageResponse[] = stagesData?.stages ?? [];

  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    probability: string;
    /** Comma-separated required field names for stage_exit_requirements */
    exitRequiredFields: string;
    /** Comma-separated warning field names for stage_exit_requirements */
    exitWarningFields: string;
  }>({
    name: '',
    probability: '',
    exitRequiredFields: '',
    exitWarningFields: '',
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
    mutationFn: (params: { name: string; probability: number }) =>
      createPipelineStage({ ...params, pipeline_id: activePipelineId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pipelineStagesQueryKey(activePipelineId) });
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
    mutationFn: ({
      id,
      name,
      probability,
      stage_exit_requirements,
    }: {
      id: string;
      name?: string;
      probability?: number;
      stage_exit_requirements?: { required_fields: string[]; warning_fields: string[] };
    }) => updatePipelineStage(id, { name, probability, stage_exit_requirements }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pipelineStagesQueryKey(activePipelineId) });
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
      // stale GET cannot overwrite the authoritative reorder result.
      const qk = pipelineStagesQueryKey(activePipelineId);
      await queryClient.cancelQueries({ queryKey: qk });
      queryClient.setQueryData(qk, data);
    },
    onError: () => {
      setStagesSectionFeedback({ type: 'error', key: 'settings.pipelineStages.reorderError' });
    },
  });

  const deleteStageMutation = useMutation({
    mutationFn: (id: string) => deletePipelineStage(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pipelineStagesQueryKey(activePipelineId) });
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
    setEditDraft({
      name: stage.name,
      probability: String(stage.probability),
      exitRequiredFields: stage.stage_exit_requirements.required_fields.join(', '),
      exitWarningFields: stage.stage_exit_requirements.warning_fields.join(', '),
    });
    setEditRowError(null);
  }

  function parseFieldList(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
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
      stage_exit_requirements: {
        required_fields: parseFieldList(editDraft.exitRequiredFields),
        warning_fields: parseFieldList(editDraft.exitWarningFields),
      },
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
  const [editFieldDraft, setEditFieldDraft] = useState<{
    name: string;
    options: string;
    piiExcluded: boolean;
  }>({
    name: '',
    options: '',
    piiExcluded: false,
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
    mutationFn: ({
      id,
      name,
      options,
      piiExcluded,
    }: {
      id: string;
      name: string;
      options?: string[] | null;
      piiExcluded: boolean;
    }) => updateCustomFieldDefinition(id, { name, options, pii_excluded: piiExcluded }),
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
      piiExcluded: field.pii_excluded,
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
    updateFieldMutation.mutate({
      id: field.id,
      name: trimmedName,
      options,
      piiExcluded: editFieldDraft.piiExcluded,
    });
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
      {/* ── Pipelines section ───────────────────────────────── */}
      <div
        className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl mb-6"
        data-testid="pipelines-section"
      >
        <h2
          className="text-lg font-semibold text-gray-900 mb-1"
          data-testid="pipelines-section-title"
        >
          {t('settings.pipelines.sectionTitle')}
        </h2>

        {pipelinesFeedback && (
          <p
            ref={pipelinesFeedbackRef}
            tabIndex={-1}
            role="status"
            data-testid="pipelines-feedback"
            className={`mb-3 text-sm rounded px-3 py-2 ${pipelinesFeedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
          >
            {t(pipelinesFeedback.key)}
          </p>
        )}

        {!pipelinesLoading && (
          <ul className="divide-y divide-gray-100 mb-4" data-testid="pipelines-list">
            {pipelines.map((pipeline) => (
              <li
                key={pipeline.id}
                className="py-3 flex items-center gap-3"
                data-testid={`pipeline-row-${pipeline.id}`}
              >
                {editingPipelineId === pipeline.id ? (
                  <>
                    <input
                      type="text"
                      className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      value={editPipelineName}
                      onChange={(e) => setEditPipelineName(e.target.value)}
                      data-testid={`pipeline-edit-input-${pipeline.id}`}
                      aria-label={t('settings.pipelines.namePlaceholder')}
                    />
                    {editPipelineError && (
                      <span className="text-xs text-red-600">{editPipelineError}</span>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      data-testid={`pipeline-save-button-${pipeline.id}`}
                      onClick={() => {
                        const trimmed = editPipelineName.trim();
                        if (!trimmed) {
                          setEditPipelineError(t('settings.pipelines.nameRequiredError'));
                          return;
                        }
                        if (trimmed.length > 100) {
                          setEditPipelineError(t('settings.pipelines.nameTooLongError'));
                          return;
                        }
                        updatePipelineMutation.mutate({ id: pipeline.id, name: trimmed });
                      }}
                      disabled={updatePipelineMutation.isPending}
                    >
                      {t('settings.pipelines.saveButton')}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      data-testid={`pipeline-cancel-button-${pipeline.id}`}
                      onClick={() => {
                        setEditingPipelineId(null);
                        setEditPipelineError(null);
                      }}
                    >
                      {t('settings.pipelines.cancelButton')}
                    </Button>
                  </>
                ) : (
                  <>
                    <span
                      className="flex-1 text-sm text-gray-900"
                      data-testid={`pipeline-name-${pipeline.id}`}
                    >
                      {pipeline.name}
                    </span>
                    {pipeline.is_default && (
                      <span
                        className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-0.5"
                        data-testid={`pipeline-default-badge-${pipeline.id}`}
                      >
                        {t('settings.pipelines.defaultBadge')}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      data-testid={`pipeline-edit-button-${pipeline.id}`}
                      onClick={() => {
                        setEditingPipelineId(pipeline.id);
                        setEditPipelineName(pipeline.name);
                        setEditPipelineError(null);
                      }}
                    >
                      {t('settings.pipelines.editButton')}
                    </Button>
                    {!pipeline.is_default && (
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        data-testid={`pipeline-delete-button-${pipeline.id}`}
                        onClick={() => {
                          setDeletingPipelineId(pipeline.id);
                          setDeletePipelineBlockedMessage(null);
                        }}
                      >
                        {t('settings.pipelines.deleteButton')}
                      </Button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {showAddPipeline ? (
          <div className="flex items-center gap-2 mt-2">
            <input
              ref={addPipelineInputRef}
              type="text"
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder={t('settings.pipelines.namePlaceholder')}
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              data-testid="new-pipeline-name-input"
            />
            {addPipelineError && <span className="text-xs text-red-600">{addPipelineError}</span>}
            <Button
              type="button"
              size="sm"
              data-testid="create-pipeline-submit-button"
              onClick={() => {
                const trimmed = newPipelineName.trim();
                if (!trimmed) {
                  setAddPipelineError(t('settings.pipelines.nameRequiredError'));
                  return;
                }
                if (trimmed.length > 100) {
                  setAddPipelineError(t('settings.pipelines.nameTooLongError'));
                  return;
                }
                createPipelineMutation.mutate(trimmed);
              }}
              disabled={createPipelineMutation.isPending}
            >
              {t('settings.pipelines.saveButton')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="create-pipeline-cancel-button"
              onClick={() => {
                setShowAddPipeline(false);
                setNewPipelineName('');
                setAddPipelineError(null);
              }}
            >
              {t('settings.pipelines.cancelButton')}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="add-pipeline-button"
            onClick={() => {
              setShowAddPipeline(true);
              setPipelinesFeedback(null);
            }}
          >
            {t('settings.pipelines.addButton')}
          </Button>
        )}

        {/* Delete pipeline confirmation */}
        {deletingPipelineId && (
          <div
            className="mt-4 rounded-md bg-red-50 border border-red-200 p-4"
            data-testid="pipeline-delete-confirm"
          >
            <p className="text-sm font-medium text-red-900 mb-3">
              {t('settings.pipelines.deleteConfirmTitle')}
            </p>
            {deletePipelineBlockedMessage && (
              <p className="text-sm text-red-700 mb-2">{deletePipelineBlockedMessage}</p>
            )}
            <div className="flex gap-2">
              {!deletePipelineBlockedMessage && (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  data-testid="pipeline-delete-confirm-button"
                  disabled={deletePipelineMutation.isPending}
                  onClick={() => deletePipelineMutation.mutate(deletingPipelineId)}
                >
                  {t('settings.pipelines.deleteButton')}
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="pipeline-delete-cancel-button"
                onClick={() => {
                  setDeletingPipelineId(null);
                  setDeletePipelineBlockedMessage(null);
                }}
              >
                {t('settings.pipelines.cancelButton')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Pipeline Stages section ─────────────────────────── */}
      <div
        className="bg-white shadow-sm rounded-lg border border-gray-200 p-6 max-w-2xl"
        data-testid="pipeline-stages-section"
      >
        <div className="flex items-center gap-3 mb-1">
          <h2
            className="text-lg font-semibold text-gray-900"
            data-testid="pipeline-stages-section-title"
          >
            {t('settings.pipelineStages.sectionTitle')}
          </h2>
          {/* Pipeline selector for stage management */}
          {pipelines.length > 1 && (
            <select
              aria-label={t('settings.pipelines.sectionTitle')}
              data-testid="pipeline-stages-pipeline-selector"
              value={activePipelineId ?? ''}
              onChange={(e) => setSelectedPipelineId(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
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
                  // Fragment needed to emit two <tr> elements per stage row when editing
                  <Fragment key={stage.id}>
                    <tr data-testid={`pipeline-stage-row-${stage.id}`}>
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
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 15l7-7 7 7"
                              />
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
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19 9l-7 7-7-7"
                              />
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
                    {editingStageId === stage.id && (
                      <tr data-testid={`pipeline-stage-exit-requirements-${stage.id}`}>
                        <td />
                        <td colSpan={3} className="pb-3 pt-1">
                          <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs space-y-3">
                            <p className="font-medium text-gray-700">
                              {t('settings.pipelineStages.exitRequirementsLabel')}
                            </p>
                            <p className="text-gray-500">
                              {t('settings.pipelineStages.exitRequirementsHint')}
                            </p>
                            <div className="space-y-2">
                              <label
                                htmlFor={`exit-required-${stage.id}`}
                                className="block font-medium text-gray-600"
                              >
                                {t('settings.pipelineStages.exitRequiredFieldsLabel')}
                              </label>
                              <input
                                id={`exit-required-${stage.id}`}
                                type="text"
                                data-testid={`pipeline-stage-exit-required-${stage.id}`}
                                value={editDraft.exitRequiredFields}
                                onChange={(e) =>
                                  setEditDraft((d) => ({
                                    ...d,
                                    exitRequiredFields: e.target.value,
                                  }))
                                }
                                disabled={updateStageMutation.isPending}
                                placeholder={t('settings.pipelineStages.exitFieldsPlaceholder')}
                                className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                              />
                            </div>
                            <div className="space-y-2">
                              <label
                                htmlFor={`exit-warning-${stage.id}`}
                                className="block font-medium text-gray-600"
                              >
                                {t('settings.pipelineStages.exitWarningFieldsLabel')}
                              </label>
                              <input
                                id={`exit-warning-${stage.id}`}
                                type="text"
                                data-testid={`pipeline-stage-exit-warning-${stage.id}`}
                                value={editDraft.exitWarningFields}
                                onChange={(e) =>
                                  setEditDraft((d) => ({
                                    ...d,
                                    exitWarningFields: e.target.value,
                                  }))
                                }
                                disabled={updateStageMutation.isPending}
                                placeholder={t('settings.pipelineStages.exitFieldsPlaceholder')}
                                className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
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

      {/* ── Custom Fields section ──────────────────────────── */}
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
                    <th className="pb-2 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">
                      {t('settings.customFields.aiExcludedLabel')}
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
                      <td className="py-2 pe-3 text-sm">
                        {editingFieldId === field.id ? (
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              data-testid={`custom-field-pii-excluded-toggle-${field.id}`}
                              checked={editFieldDraft.piiExcluded}
                              disabled={updateFieldMutation.isPending}
                              onChange={(e) =>
                                setEditFieldDraft((d) => ({ ...d, piiExcluded: e.target.checked }))
                              }
                            />
                            <span className="text-xs text-gray-600">
                              {t('settings.customFields.aiExcludedLabel')}
                            </span>
                          </label>
                        ) : field.pii_excluded ? (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200"
                            data-testid={`custom-field-pii-excluded-badge-${field.id}`}
                          >
                            {t('settings.customFields.aiExcludedYes')}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">
                            {t('settings.customFields.aiExcludedNo')}
                          </span>
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
