/**
 * Context panel — right sidebar on the /ai page showing the user's saved
 * key/value preferences that the AI applies automatically each session.
 *
 * Supports inline add, inline edit, and delete with a single confirmation.
 * All mutations optimistically update via React Query.
 * (MINCRM-427, MINCRM-428)
 */

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AI_CONTEXT_QUERY_KEY,
  listAiContext,
  createAiContextEntry,
  updateAiContextEntry,
  deleteAiContextEntry,
} from '@/api/aiContext.js';
import type { AiContextEntryResponse } from '@shared/schemas/aiContextSchema.js';

// ── Inline add form ───────────────────────────────────────────────────────────

interface AddFormProps {
  onSave: (key: string, value: string) => void;
  onCancel: () => void;
  isSaving: boolean;
}

function AddForm({ onSave, onCancel, isSaving }: AddFormProps) {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    keyRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();
    if (!trimmedKey || !trimmedValue) return;
    onSave(trimmedKey, trimmedValue);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-1.5" data-testid="ai-context-add-form">
      <input
        ref={keyRef}
        type="text"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={t('ai.context.keyPlaceholder')}
        maxLength={100}
        className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
        data-testid="ai-context-add-key"
        aria-label={t('ai.context.keyPlaceholder')}
        disabled={isSaving}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('ai.context.valuePlaceholder')}
        maxLength={500}
        className="w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
        data-testid="ai-context-add-value"
        aria-label={t('ai.context.valuePlaceholder')}
        disabled={isSaving}
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={isSaving || !key.trim() || !value.trim()}
          className="flex-1 text-xs bg-primary-600 text-white rounded-md px-2 py-1 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="ai-context-add-save"
        >
          {t('ai.context.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="flex-1 text-xs border border-gray-200 text-gray-600 rounded-md px-2 py-1 hover:bg-gray-50"
          data-testid="ai-context-add-cancel"
        >
          {t('ai.context.cancel')}
        </button>
      </div>
    </form>
  );
}

// ── Inline edit form ──────────────────────────────────────────────────────────

interface EditFormProps {
  entry: AiContextEntryResponse;
  onSave: (key: string, value: string) => void;
  onCancel: () => void;
  isSaving: boolean;
}

function EditForm({ entry, onSave, onCancel, isSaving }: EditFormProps) {
  const { t } = useTranslation();
  const [key, setKey] = useState(entry.key);
  const [value, setValue] = useState(entry.value);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    keyRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();
    if (!trimmedKey || !trimmedValue) return;
    onSave(trimmedKey, trimmedValue);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-1.5"
      data-testid={`ai-context-edit-form-${entry.id}`}
    >
      <input
        ref={keyRef}
        type="text"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={t('ai.context.keyPlaceholder')}
        maxLength={100}
        className="w-full text-xs border border-primary-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
        data-testid={`ai-context-edit-key-${entry.id}`}
        aria-label={t('ai.context.keyPlaceholder')}
        disabled={isSaving}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('ai.context.valuePlaceholder')}
        maxLength={500}
        className="w-full text-xs border border-primary-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
        data-testid={`ai-context-edit-value-${entry.id}`}
        aria-label={t('ai.context.valuePlaceholder')}
        disabled={isSaving}
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={isSaving || !key.trim() || !value.trim()}
          className="flex-1 text-xs bg-primary-600 text-white rounded-md px-2 py-1 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid={`ai-context-edit-save-${entry.id}`}
        >
          {t('ai.context.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="flex-1 text-xs border border-gray-200 text-gray-600 rounded-md px-2 py-1 hover:bg-gray-50"
          data-testid={`ai-context-edit-cancel-${entry.id}`}
        >
          {t('ai.context.cancel')}
        </button>
      </div>
    </form>
  );
}

// ── Context entry row ─────────────────────────────────────────────────────────

interface EntryRowProps {
  entry: AiContextEntryResponse;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (key: string, value: string) => void;
  onDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
}

function EntryRow({
  entry,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  isSaving,
  isDeleting,
}: EntryRowProps) {
  const { t } = useTranslation();

  if (isEditing) {
    return (
      <div className="py-2 border-b border-gray-50 last:border-0">
        <EditForm entry={entry} onSave={onSaveEdit} onCancel={onCancelEdit} isSaving={isSaving} />
      </div>
    );
  }

  return (
    <div
      className="group py-2 border-b border-gray-50 last:border-0"
      data-testid={`ai-context-entry-${entry.id}`}
    >
      <div className="flex items-start gap-1 min-w-0">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-gray-800 break-words">{entry.key}</span>
          {/* Decorative separator — not translated */}
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <span className="text-xs text-gray-400 mx-1" aria-hidden="true">
            →
          </span>
          <span className="text-xs text-gray-600 break-words">{entry.value}</span>
        </div>
        <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onStartEdit}
            aria-label={t('ai.context.editEntry')}
            data-testid={`ai-context-edit-button-${entry.id}`}
            className="p-1 text-gray-400 hover:text-primary-600 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            aria-label={t('ai.context.deleteEntry')}
            data-testid={`ai-context-delete-button-${entry.id}`}
            className="p-1 text-gray-400 hover:text-red-500 rounded focus:outline-none focus:ring-2 focus:ring-red-400 disabled:opacity-40"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a1 1 0 011-1h4a1 1 0 011 1m-6 0h6"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export default function ContextPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: AI_CONTEXT_QUERY_KEY,
    queryFn: listAiContext,
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      createAiContextEntry(key, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_CONTEXT_QUERY_KEY });
      setIsAdding(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, key, value }: { id: string; key: string; value: string }) =>
      updateAiContextEntry(id, { key, value }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_CONTEXT_QUERY_KEY });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAiContextEntry(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_CONTEXT_QUERY_KEY });
    },
  });

  const handleDelete = (entry: AiContextEntryResponse) => {
    if (!window.confirm(t('ai.context.deleteConfirm'))) return;
    deleteMutation.mutate(entry.id);
  };

  const isSavingEdit = updateMutation.isPending;
  const isSavingAdd = createMutation.isPending;

  return (
    <aside
      className="hidden lg:flex flex-col w-64 flex-shrink-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
      aria-label={t('ai.context.panelLabel')}
      data-testid="ai-context-panel"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">{t('ai.myContext')}</h2>
        {!isAdding && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setIsAdding(true);
            }}
            data-testid="ai-add-context-button"
            aria-label={t('ai.addContext')}
            className="text-xs text-primary-600 font-medium hover:text-primary-700"
          >
            {t('ai.addContext')}
          </button>
        )}
      </div>

      <div className="flex-1 px-4 py-3 overflow-y-auto">
        {isAdding && (
          <AddForm
            onSave={(key, value) => createMutation.mutate({ key, value })}
            onCancel={() => setIsAdding(false)}
            isSaving={isSavingAdd}
          />
        )}

        {isLoading ? (
          <div className="space-y-2 mt-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : entries.length === 0 && !isAdding ? (
          <p className="text-xs text-gray-400 text-center mt-8" data-testid="ai-context-empty">
            {t('ai.context.emptyState')}
          </p>
        ) : (
          <div className="mt-1" data-testid="ai-context-list">
            {entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                isEditing={editingId === entry.id}
                onStartEdit={() => {
                  setIsAdding(false);
                  setEditingId(entry.id);
                }}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={(key, value) => updateMutation.mutate({ id: entry.id, key, value })}
                onDelete={() => handleDelete(entry)}
                isSaving={isSavingEdit && editingId === entry.id}
                isDeleting={deleteMutation.isPending && deleteMutation.variables === entry.id}
              />
            ))}
          </div>
        )}

        {createMutation.isError && (
          <p className="text-xs text-red-500 mt-2" role="alert" data-testid="ai-context-add-error">
            {(createMutation.error as { response?: { data?: { error?: { code?: string } } } })
              ?.response?.data?.error?.code === 'CONTEXT_ENTRY_LIMIT_REACHED'
              ? t('ai.context.limitReached')
              : (createMutation.error as { response?: { data?: { error?: { code?: string } } } })
                    ?.response?.data?.error?.code === 'CONTEXT_KEY_DUPLICATE'
                ? t('ai.context.keyDuplicate')
                : (createMutation.error as Error).message}
          </p>
        )}
        {updateMutation.isError && (
          <p className="text-xs text-red-500 mt-2" role="alert" data-testid="ai-context-edit-error">
            {(updateMutation.error as { response?: { data?: { error?: { code?: string } } } })
              ?.response?.data?.error?.code === 'CONTEXT_KEY_DUPLICATE'
              ? t('ai.context.keyDuplicate')
              : (updateMutation.error as Error).message}
          </p>
        )}
        {deleteMutation.isError && (
          <p
            className="text-xs text-red-500 mt-2"
            role="alert"
            data-testid="ai-context-delete-error"
          >
            {(deleteMutation.error as Error).message}
          </p>
        )}
      </div>
    </aside>
  );
}
