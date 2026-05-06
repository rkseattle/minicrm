/**
 * Admin Tags page — manage all tags in the system (MINCRM-186).
 * Lists every tag, allows renaming and deleting. Admin only.
 * Includes the restrict-tag-creation toggle (MINCRM-263).
 */

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { Pagination } from '@/components/ui/Pagination.js';
import { listTags, updateTag, deleteTag, TAGS_QUERY_KEY } from '@/api/tags.js';
import { PAGINATION_DEFAULT_LIMIT } from '@shared/schemas/paginationSchema.js';
import {
  getTagsRestrictCreation,
  setTagsRestrictCreation,
  TAGS_RESTRICT_CREATION_QUERY_KEY,
} from '@/api/settings.js';
import type { TagResponse } from '@shared/schemas/tagSchema.js';

/**
 * Admin-only page for listing, renaming, and deleting tags.
 */
export default function AdminTagsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const tagsQueryKey = [...TAGS_QUERY_KEY, { page }] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey: tagsQueryKey,
    queryFn: () => listTags(page, PAGINATION_DEFAULT_LIMIT),
  });

  const tags = data?.data ?? [];

  // ── Restrict-creation toggle (MINCRM-263) ─────────────────────────────────────

  const { data: restrictData } = useQuery({
    queryKey: TAGS_RESTRICT_CREATION_QUERY_KEY,
    queryFn: getTagsRestrictCreation,
  });

  const restricted = restrictData?.restricted ?? false;

  const [restrictSaveSuccess, setRestrictSaveSuccess] = useState(false);
  const [restrictSaveError, setRestrictSaveError] = useState(false);

  const restrictMutation = useMutation({
    mutationFn: (value: boolean) => setTagsRestrictCreation(value),
    onSuccess: (data) => {
      void queryClient.setQueryData(TAGS_RESTRICT_CREATION_QUERY_KEY, data);
      setRestrictSaveSuccess(true);
      setRestrictSaveError(false);
      setTimeout(() => setRestrictSaveSuccess(false), 3000);
    },
    onError: () => {
      setRestrictSaveError(true);
      setRestrictSaveSuccess(false);
    },
  });

  // ── Rename state ──────────────────────────────────────────────────────────────

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateTag(id, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY });
      setEditingId(null);
      setEditName('');
      setRenameError(null);
    },
    onError: () => {
      setRenameError(t('tags.renameError'));
    },
  });

  function startEdit(tag: TagResponse) {
    setEditingId(tag.id);
    setEditName(tag.name);
    setRenameError(null);
    // Focus is set via autoFocus on the rendered input
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
    setRenameError(null);
  }

  function handleRenameSubmit(id: string) {
    const trimmed = editName.trim().toLowerCase();
    if (!trimmed) {
      setRenameError(t('tags.renameRequired'));
      return;
    }
    renameMutation.mutate({ id, name: trimmed });
  }

  // ── Delete state ──────────────────────────────────────────────────────────────

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTag(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY });
      setDeletingId(null);
      setDeleteError(null);
    },
    onError: () => {
      setDeleteError(t('tags.deleteError'));
      setDeletingId(null);
    },
  });

  function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    deleteMutation.mutate(id);
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <NavBar />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden max-w-3xl w-full mx-auto px-4 sm:px-6 pt-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1" data-testid="admin-tags-heading">
          {t('tags.pageTitle')}
        </h1>
        <p className="text-sm text-gray-500 mb-6" data-testid="admin-tags-hint">
          {t('tags.pageHint')}
        </p>

        {/* Restrict-creation toggle */}
        <div
          className="mb-6 rounded-lg border border-gray-200 bg-white p-4"
          data-testid="tags-restrict-toggle-section"
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              role="switch"
              aria-checked={restricted}
              checked={restricted}
              disabled={restrictMutation.isPending}
              onChange={(e) => restrictMutation.mutate(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-60"
              data-testid="tags-restrict-toggle"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">
                {t('tags.restrictToggleLabel')}
              </span>
              {restricted && (
                <span
                  className="mt-0.5 block text-sm text-gray-500"
                  data-testid="tags-restrict-description"
                >
                  {t('tags.restrictToggleDescription')}
                </span>
              )}
            </span>
          </label>
          {restrictSaveSuccess && (
            <p
              role="status"
              className="mt-2 text-sm text-green-700"
              data-testid="tags-restrict-save-success"
            >
              {t('tags.restrictToggleSaveSuccess')}
            </p>
          )}
          {restrictSaveError && (
            <p
              role="alert"
              className="mt-2 text-sm text-red-600"
              data-testid="tags-restrict-save-error"
            >
              {t('tags.restrictToggleSaveError')}
            </p>
          )}
        </div>

        {isLoading && (
          <p className="text-sm text-gray-500" data-testid="admin-tags-loading">
            {t('tags.loading')}
          </p>
        )}

        {isError && (
          <div role="alert" className="text-sm text-red-600" data-testid="admin-tags-error">
            {t('tags.loadError')}
          </div>
        )}

        {deleteError && (
          <div
            role="alert"
            className="mb-4 text-sm text-red-600"
            data-testid="admin-tags-delete-error"
          >
            {deleteError}
          </div>
        )}

        {!isLoading && !isError && tags.length === 0 && (
          <p className="text-sm text-gray-500" data-testid="admin-tags-empty">
            {t('tags.empty')}
          </p>
        )}

        {!isLoading && !isError && (
          <div className="flex-1 flex flex-col min-h-0 mb-8">
            <ul
              className="flex-1 overflow-auto min-h-0 divide-y divide-gray-200 rounded-t-lg border border-gray-200 bg-white"
              data-testid="admin-tags-list"
            >
              {tags.map((tag) => (
                <li
                  key={tag.id}
                  className="flex items-center gap-3 px-4 py-3"
                  data-testid={`admin-tag-row-${tag.id}`}
                >
                  {editingId === tag.id ? (
                    <form
                      className="flex flex-1 items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleRenameSubmit(tag.id);
                      }}
                      data-testid={`rename-form-${tag.id}`}
                    >
                      <Input
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                        ref={editInputRef}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        aria-label={t('tags.renameInputLabel')}
                        data-testid={`rename-input-${tag.id}`}
                      />
                      {renameError && (
                        <span className="text-xs text-red-600" role="alert">
                          {renameError}
                        </span>
                      )}
                      <Button
                        type="submit"
                        size="sm"
                        disabled={renameMutation.isPending}
                        data-testid={`rename-save-${tag.id}`}
                      >
                        {renameMutation.isPending ? t('tags.saving') : t('tags.save')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={cancelEdit}
                        data-testid={`rename-cancel-${tag.id}`}
                      >
                        {t('tags.cancel')}
                      </Button>
                    </form>
                  ) : (
                    <>
                      <span
                        className="flex-1 text-sm font-medium text-gray-900"
                        data-testid={`tag-name-${tag.id}`}
                      >
                        {tag.name}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEdit(tag)}
                        data-testid={`rename-tag-${tag.id}`}
                      >
                        {t('tags.rename')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={deletingId === tag.id}
                        onClick={() => handleDelete(tag.id)}
                        data-testid={`delete-tag-${tag.id}`}
                      >
                        {deletingId === tag.id ? t('tags.deleting') : t('tags.delete')}
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {data && (
              <Pagination
                page={data.page}
                limit={data.limit}
                total={data.total}
                onPageChange={setPage}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
