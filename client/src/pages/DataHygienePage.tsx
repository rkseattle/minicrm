/**
 * DataHygienePage component.
 * Displays the cached data hygiene queue from the most recent nightly scan.
 * Shared between the admin view (/admin/hygiene, scope=all, all records)
 * and the personal view (/hygiene, scope=mine, the caller's own records) —
 * the only difference is the scope prop and page heading.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import EmptyState from '@/components/EmptyState.js';
import { Button } from '@/components/ui/Button.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import {
  listHygieneFindings,
  dismissHygieneFinding,
  clearHygieneFindingsForEntity,
  mergeDuplicateContactFindings,
  hygieneFindingsQueryKey,
} from '@/api/dataHygiene.js';
import type {
  DataHygieneFinding,
  DataHygieneEntityType,
} from '@shared/schemas/dataHygieneSchema.js';
import { recordPath, type RecordLinkType } from '@shared/types/recordPath.js';

const ENTITY_TYPE_FILTERS: Array<DataHygieneEntityType | 'all'> = [
  'all',
  'contact',
  'account',
  'opportunity',
];

/** The hygiene enum says 'opportunity' where the rest of the app says 'deal'. */
const HYGIENE_TYPE_TO_RECORD: Readonly<Record<DataHygieneEntityType, RecordLinkType>> = {
  contact: 'contact',
  account: 'account',
  opportunity: 'deal',
};

function entityLinkPath(finding: DataHygieneFinding): string {
  return recordPath(HYGIENE_TYPE_TO_RECORD[finding.entity_type], finding.entity_id);
}

interface DismissDialogState {
  findingId: string;
  reason: string;
}

interface MergeDialogState {
  contactAId: string;
  contactAName: string;
  contactBId: string;
  contactBName: string;
  /** Which contact the user has selected to keep as the merge winner. */
  winnerId: string;
}

interface DataHygienePageProps {
  scope: 'mine' | 'all';
}

export default function DataHygienePage({ scope }: DataHygienePageProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { enabled: featureEnabled, isLoading: featureFlagLoading } = useFeatureFlag(
    'ai_data_hygiene_assistant',
  );
  const [entityTypeFilter, setEntityTypeFilter] = useState<DataHygieneEntityType | 'all'>('all');
  const [dismissDialog, setDismissDialog] = useState<DismissDialogState | null>(null);
  const [mergeDialog, setMergeDialog] = useState<MergeDialogState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Focus management for the dismiss/merge dialogs, matching ConvertLeadModal's
  // convention: move focus into the dialog's cancel control on open, and let
  // Escape close it — the dialogs are conditionally rendered <div>s rather than
  // native <dialog> elements, so nothing does this automatically.
  const dismissCancelRef = useRef<HTMLButtonElement>(null);
  const mergeCancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dismissDialog) dismissCancelRef.current?.focus();
  }, [dismissDialog]);

  useEffect(() => {
    if (mergeDialog) mergeCancelRef.current?.focus();
  }, [mergeDialog]);

  useEffect(() => {
    if (!dismissDialog && !mergeDialog) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setDismissDialog(null);
      setMergeDialog(null);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dismissDialog, mergeDialog]);

  const entityTypeParam = entityTypeFilter === 'all' ? undefined : entityTypeFilter;
  const queryKey = hygieneFindingsQueryKey(scope, entityTypeParam);

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => listHygieneFindings(scope, entityTypeParam),
    enabled: featureEnabled,
  });

  const dismissMutation = useMutation({
    mutationFn: ({ findingId, reason }: DismissDialogState) =>
      dismissHygieneFinding(findingId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hygieneFindingsQueryKey(scope) });
      setDismissDialog(null);
      setActionError(null);
    },
    onError: () => setActionError(t('dataHygiene.actionError')),
  });

  const mergeMutation = useMutation({
    mutationFn: ({ winnerId, loserId }: { winnerId: string; loserId: string }) =>
      mergeDuplicateContactFindings(winnerId, loserId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hygieneFindingsQueryKey(scope) });
      setMergeDialog(null);
      setActionError(null);
    },
    onError: () => setActionError(t('dataHygiene.actionError')),
  });

  const clearMutation = useMutation({
    mutationFn: ({
      entityType,
      entityId,
    }: {
      entityType: DataHygieneEntityType;
      entityId: string;
    }) => clearHygieneFindingsForEntity(entityType, entityId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hygieneFindingsQueryKey(scope) });
      setActionError(null);
    },
    onError: () => setActionError(t('dataHygiene.actionError')),
  });

  if (featureFlagLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400 text-sm">{t('common.loading')}</div>
        </div>
      </div>
    );
  }

  if (!featureEnabled) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500 text-sm">{t('dataHygiene.notAvailable')}</p>
        </div>
      </div>
    );
  }

  const findings = data?.findings ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6" data-testid="data-hygiene-heading">
          {scope === 'all' ? t('dataHygiene.adminHeading') : t('dataHygiene.myHeading')}
        </h1>

        <div className="mb-4 flex gap-2">
          {ENTITY_TYPE_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setEntityTypeFilter(filter)}
              data-testid={`data-hygiene-filter-${filter}`}
              className={`px-3 py-1.5 text-sm rounded-md border ${
                entityTypeFilter === filter
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {t(`dataHygiene.filter.${filter}`)}
            </button>
          ))}
        </div>

        {actionError && (
          <p
            role="alert"
            className="mb-4 text-sm text-red-600"
            data-testid="data-hygiene-action-error"
          >
            {actionError}
          </p>
        )}

        {isLoading && (
          <div className="space-y-2" aria-hidden="true">
            <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />
            <div className="h-24 w-full bg-gray-100 rounded animate-pulse" />
          </div>
        )}

        {isError && (
          <p role="alert" className="text-sm text-red-600" data-testid="data-hygiene-error">
            {t('dataHygiene.loadError')}
          </p>
        )}

        {!isLoading && !isError && findings.length === 0 && (
          <EmptyState
            data-testid="data-hygiene-empty"
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
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            }
            title={t('dataHygiene.emptyTitle')}
            description={t('dataHygiene.emptyDescription')}
          />
        )}

        {!isLoading && !isError && findings.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <ul className="divide-y divide-gray-100" data-testid="data-hygiene-list">
              {findings.map((finding) => (
                <li
                  key={finding.id}
                  className="px-6 py-4 flex flex-col gap-1"
                  data-testid={`data-hygiene-finding-${finding.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        to={entityLinkPath(finding)}
                        className="text-sm font-medium text-primary-600 hover:underline"
                      >
                        {finding.entity_name}
                      </Link>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {t(`dataHygiene.issue.${finding.issue_type}`)}
                        {finding.last_activity_at &&
                          ` — ${t('dataHygiene.lastActivity', { date: new Date(finding.last_activity_at).toLocaleDateString() })}`}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700">{finding.suggested_action}</p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      data-testid={`data-hygiene-update-${finding.id}`}
                      onClick={() => window.location.assign(entityLinkPath(finding))}
                    >
                      {t('dataHygiene.actionUpdate')}
                    </Button>
                    {finding.issue_type === 'contact_duplicate' && finding.related_entity_id && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        data-testid={`data-hygiene-merge-${finding.id}`}
                        onClick={() =>
                          setMergeDialog({
                            contactAId: finding.entity_id,
                            contactAName: finding.entity_name,
                            contactBId: finding.related_entity_id!,
                            contactBName: finding.related_entity_name ?? finding.related_entity_id!,
                            winnerId: finding.entity_id,
                          })
                        }
                      >
                        {t('dataHygiene.actionMerge')}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      data-testid={`data-hygiene-archive-${finding.id}`}
                      disabled={
                        clearMutation.isPending &&
                        clearMutation.variables?.entityId === finding.entity_id
                      }
                      onClick={() =>
                        clearMutation.mutate({
                          entityType: finding.entity_type,
                          entityId: finding.entity_id,
                        })
                      }
                    >
                      {t('dataHygiene.actionArchive')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      data-testid={`data-hygiene-dismiss-${finding.id}`}
                      onClick={() => setDismissDialog({ findingId: finding.id, reason: '' })}
                    >
                      {t('dataHygiene.actionDismiss')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>

      {dismissDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          data-testid="data-hygiene-dismiss-dialog"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              {t('dataHygiene.dismissDialogTitle')}
            </h2>
            <label
              htmlFor="dismiss-reason"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {t('dataHygiene.dismissReasonLabel')}
            </label>
            <textarea
              id="dismiss-reason"
              data-testid="data-hygiene-dismiss-reason-input"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
              rows={3}
              value={dismissDialog.reason}
              onChange={(e) => setDismissDialog({ ...dismissDialog, reason: e.target.value })}
            />
            <div className="mt-4 flex justify-end gap-3">
              <Button
                ref={dismissCancelRef}
                type="button"
                variant="ghost"
                onClick={() => setDismissDialog(null)}
                data-testid="data-hygiene-dismiss-cancel"
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                disabled={dismissDialog.reason.trim().length === 0 || dismissMutation.isPending}
                onClick={() => dismissMutation.mutate(dismissDialog)}
                data-testid="data-hygiene-dismiss-confirm"
              >
                {dismissMutation.isPending ? t('common.saving') : t('dataHygiene.actionDismiss')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {mergeDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          data-testid="data-hygiene-merge-dialog"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              {t('dataHygiene.mergeDialogTitle')}
            </h2>
            <p className="text-sm text-gray-600 mb-4">{t('dataHygiene.mergeDialogBody')}</p>
            <fieldset className="space-y-2 mb-4">
              <legend className="text-sm font-medium text-gray-700 mb-1">
                {t('dataHygiene.mergeDialogKeepLabel')}
              </legend>
              {[
                { id: mergeDialog.contactAId, name: mergeDialog.contactAName },
                { id: mergeDialog.contactBId, name: mergeDialog.contactBName },
              ].map((contact) => (
                <label key={contact.id} className="flex items-center gap-2 text-sm text-gray-900">
                  <input
                    type="radio"
                    name="merge-winner"
                    value={contact.id}
                    checked={mergeDialog.winnerId === contact.id}
                    onChange={() => setMergeDialog({ ...mergeDialog, winnerId: contact.id })}
                    data-testid={`data-hygiene-merge-winner-${contact.id}`}
                  />
                  {contact.name}
                </label>
              ))}
            </fieldset>
            <div className="flex justify-end gap-3">
              <Button
                ref={mergeCancelRef}
                type="button"
                variant="ghost"
                onClick={() => setMergeDialog(null)}
                data-testid="data-hygiene-merge-cancel"
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                disabled={mergeMutation.isPending}
                onClick={() => {
                  const loserId =
                    mergeDialog.winnerId === mergeDialog.contactAId
                      ? mergeDialog.contactBId
                      : mergeDialog.contactAId;
                  mergeMutation.mutate({ winnerId: mergeDialog.winnerId, loserId });
                }}
                data-testid="data-hygiene-merge-confirm"
              >
                {mergeMutation.isPending ? t('common.saving') : t('dataHygiene.actionMerge')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
