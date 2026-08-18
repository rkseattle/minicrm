/**
 * SequencesPage component.
 * Admin-only page for creating, enabling/disabling, and deleting sales sequences.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import NavBar from '@/components/NavBar.js';
import EmptyState from '@/components/EmptyState.js';
import { Pagination } from '@/components/ui/Pagination.js';
import { Button } from '@/components/ui/Button.js';
import { PAGINATION_DEFAULT_LIMIT } from '@shared/schemas/paginationSchema.js';
import {
  SEQUENCES_QUERY_KEY,
  listSequences,
  createSequence,
  updateSequence,
  deleteSequence,
} from '@/api/sequences.js';
import type { SequenceResponse } from '@shared/schemas/sequenceSchema.js';
import type { TFunction } from 'i18next';
import { getApiErrorMessage } from '@/utils/apiError.js';

export default function SequencesPage() {
  const { t } = useTranslation() as { t: TFunction };
  const queryClient = useQueryClient();
  const { enabled, isLoading: flagLoading } = useFeatureFlag('sequencing');
  const [page, setPage] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: [...SEQUENCES_QUERY_KEY, page],
    queryFn: () => listSequences(page, PAGINATION_DEFAULT_LIMIT),
  });

  const createMutation = useMutation({
    mutationFn: createSequence,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SEQUENCES_QUERY_KEY });
      setIsCreating(false);
      setNewName('');
      setNewDescription('');
      setCreateError(null);
    },
    onError: (err) => {
      setCreateError(getApiErrorMessage(err, t('sequences.createError') as string));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateSequence(id, { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SEQUENCES_QUERY_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSequence,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SEQUENCES_QUERY_KEY });
    },
    onError: (err) => {
      const message = getApiErrorMessage(err, t('sequences.deleteError') as string);
      alert(message);
    },
  });

  const sequences = data?.data ?? [];
  const total = data?.total ?? 0;

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    createMutation.mutate({
      name: newName.trim(),
      description: newDescription.trim() || undefined,
      enabled: true,
    });
  }

  function handleDeleteClick(sequence: SequenceResponse) {
    if (!window.confirm(t('sequences.confirmDeleteBody'))) return;
    deleteMutation.mutate(sequence.id);
  }

  if (flagLoading) {
    return (
      <div className="p-8">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-4" aria-hidden="true" />
        <div className="h-64 bg-gray-100 rounded animate-pulse" aria-hidden="true" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="p-8 text-center text-gray-500" data-testid="feature-disabled">
        {t('errors.FEATURE_FLAG_NOT_ENABLED')}
      </div>
    );
  }

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('sequences.pageTitle')}</h1>
            <p className="mt-1 text-sm text-gray-500">{t('sequences.subtitle')}</p>
          </div>
          <Button
            data-testid="new-sequence-button"
            onClick={() => {
              setIsCreating(true);
              setCreateError(null);
            }}
          >
            {t('sequences.newButton')}
          </Button>
        </div>

        {isCreating && (
          <form
            data-testid="create-sequence-form"
            onSubmit={handleCreate}
            className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
          >
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              {t('sequences.createFormTitle')}
            </h2>
            {createError && (
              <p className="mb-3 text-sm text-red-600" role="alert">
                {createError}
              </p>
            )}
            <div className="mb-3">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t('sequences.fieldName')}
              </label>
              <input
                data-testid="sequence-name-input"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('sequences.fieldNamePlaceholder')}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                required
              />
            </div>
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t('sequences.fieldDescription')}
              </label>
              <textarea
                data-testid="sequence-description-input"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={t('sequences.fieldDescriptionPlaceholder')}
                rows={2}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                data-testid="create-sequence-submit"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? t('sequences.saveSubmit') : t('sequences.createSubmit')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setIsCreating(false);
                  setNewName('');
                  setNewDescription('');
                  setCreateError(null);
                }}
              >
                {t('sequences.cancel')}
              </Button>
            </div>
          </form>
        )}

        {isLoading && (
          <p className="text-sm text-gray-500" data-testid="sequences-loading">
            {t('sequences.loading')}
          </p>
        )}

        {isError && !isLoading && (
          <p className="text-sm text-red-600" role="alert" data-testid="sequences-error">
            {t('sequences.errorLoad')}
          </p>
        )}

        {!isLoading && !isError && sequences.length === 0 && (
          <EmptyState
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-12 w-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            }
            title={t('sequences.emptyTitle') as string}
            description={t('sequences.emptyDescription') as string}
            action={{
              label: t('sequences.emptyAction') as string,
              onClick: () => setIsCreating(true),
            }}
          />
        )}

        {!isLoading && !isError && sequences.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase tracking-wider text-gray-500">
                    {t('sequences.fieldName')}
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase tracking-wider text-gray-500">
                    {t('sequences.steps')}
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase tracking-wider text-gray-500">
                    {t('sequences.enrollments')}
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase tracking-wider text-gray-500">
                    {t('sequences.fieldEnabled')}
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sequences.map((seq) => (
                  <tr key={seq.id} data-testid={`sequence-row-${seq.id}`}>
                    <td className="min-w-0 px-4 py-3">
                      <Link
                        to={`/admin/sequences/${seq.id}`}
                        className="font-medium text-blue-600 hover:underline"
                        data-testid={`sequence-link-${seq.id}`}
                      >
                        {seq.name}
                      </Link>
                      {seq.description && (
                        <p className="mt-0.5 text-xs text-gray-500">{seq.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {t('sequences.stepCount', { count: seq.step_count })}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {t('sequences.activeEnrollments', { count: seq.active_enrollment_count })}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        data-testid={`sequence-toggle-${seq.id}`}
                        aria-label={
                          seq.enabled
                            ? t('sequences.disableSequence', { name: seq.name })
                            : t('sequences.enableSequence', { name: seq.name })
                        }
                        onClick={() => toggleMutation.mutate({ id: seq.id, enabled: !seq.enabled })}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          seq.enabled ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            seq.enabled ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <button
                        data-testid={`sequence-delete-${seq.id}`}
                        onClick={() => handleDeleteClick(seq)}
                        className="text-sm text-red-600 hover:underline"
                        aria-label={t('sequences.delete')}
                      >
                        {t('sequences.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGINATION_DEFAULT_LIMIT && (
          <div className="mt-4">
            <Pagination
              page={page}
              total={total}
              limit={PAGINATION_DEFAULT_LIMIT}
              onPageChange={setPage}
            />
          </div>
        )}
      </main>
    </div>
  );
}
