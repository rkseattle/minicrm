/**
 * DealDetailPage component.
 * Displays all fields and metadata for a single deal.
 * Shows linked contacts and the associated account.
 * Supports toggling to an edit form (including owner reassignment) and deleting the deal.
 * Supports linking and unlinking contacts from the deal.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { resolveApiError } from '@/utils/apiError.js';
import NavBar from '@/components/NavBar.js';
import FieldMergeModal from '@/components/FieldMergeModal.js';
import DealForm from '@/components/DealForm.js';
import EntityDetailSidebar from '@/components/EntityDetailSidebar.js';
import CloseDealModal from '@/components/CloseDealModal.js';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.js';
import CustomFieldsSection from '@/components/CustomFieldsSection.js';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';
import { Badge } from '@/components/ui/Badge.js';
import {
  getDeal,
  updateDeal,
  deleteDeal,
  linkContactToDeal,
  unlinkContactFromDeal,
  exportDealPdf,
  DEALS_QUERY_KEY,
} from '@/api/deals.js';
import { WIN_LOSS_REPORT_QUERY_KEY } from '@/api/reports.js';
import { listAccounts } from '@/api/accounts.js';
import { listContacts } from '@/api/contacts.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import { putCustomFieldValues, customFieldValuesQueryKey } from '@/api/customFields.js';
import { runDealHealthCheck } from '@/api/dealHealth.js';
import { getStageAdvancement, stageAdvancementQueryKey } from '@/api/stageAdvancement.js';
import {
  getDealStakeholderMap,
  dealStakeholderMapQueryKey,
  dismissContactChampionBlocker,
} from '@/api/championBlocker.js';
import ChampionBlockerBadge from '@/components/ChampionBlockerBadge.js';
import { generateProposalDraft } from '@/api/proposalDraft.js';
import ProposalDraftEditor from '@/components/ProposalDraftEditor.js';
import { PAGINATION_MAX_LIMIT } from '@shared/schemas/paginationSchema.js';
import type { ActiveUser } from '@/api/users.js';
import type { CustomFieldValueInput } from '@shared/schemas/customFieldSchema.js';
import type { DealFormValues } from '@/components/DealForm.js';
import type { ProposalDraft } from '@shared/schemas/proposalDraftSchema.js';
import type { DealResponse } from '@shared/schemas/dealSchema.js';
import type { SupportedCurrency } from '@shared/schemas/settingsSchema.js';
import type { AccountResponse } from '@shared/schemas/accountSchema.js';
import type { DealContact } from '@/api/deals.js';
import type {
  DealHealthCheckResponse,
  DealHealthStatus,
} from '@shared/schemas/dealHealthSchema.js';
import { getStageDisplayName } from '@/utils/pipelineStageI18nKey.js';
import { formatLocalDate } from '@/utils/formatLocalDate.js';
import { useEntityConflictHandler } from '@/hooks/useEntityConflictHandler.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';

/** Maps a deal health status to the Badge color variant. */
const HEALTH_STATUS_VARIANT: Record<DealHealthStatus, 'success' | 'warning' | 'error'> = {
  on_track: 'success',
  at_risk: 'warning',
  stalled: 'error',
};

/**
 * Formats a deal value using the deal's own currency and the active locale. (MINCRM-189)
 *
 * @param value - Numeric string from the API, or null
 * @param currency - ISO 4217 currency code stored on the deal
 * @param locale - BCP 47 locale tag from i18next (e.g. "en", "de", "zh-Hans")
 * @returns Locale-formatted currency string, or '—' when value is absent
 */
function formatDealValue(value: string | null, currency: string, locale: string): string {
  if (!value) return '—';
  const num = parseFloat(value);
  return isNaN(num)
    ? '—'
    : new Intl.NumberFormat(locale, { style: 'currency', currency }).format(num);
}

/**
 * Single deal detail page with view/edit/delete and contact link/unlink.
 */
export default function DealDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportPdfError, setExportPdfError] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueInput[]>([]);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState('');
  // Not persisted, on-demand AI results. Each is tagged with the deal id it was generated
  // for and only rendered when that id still matches the current :id param — otherwise a
  // client-side navigation to a different deal (React Router does not remount on :id param
  // change alone) would keep showing deal A's health check / proposal draft under deal B.
  const [dealHealthResult, setDealHealthResult] = useState<{
    dealId: string;
    data: DealHealthCheckResponse;
  } | null>(null);
  const [dealHealthError, setDealHealthError] = useState<string | null>(null);
  const [proposalDraftResult, setProposalDraftResult] = useState<{
    dealId: string;
    data: ProposalDraft;
  } | null>(null);
  const [proposalDraftError, setProposalDraftError] = useState<string | null>(null);
  const dealHealth =
    dealHealthResult !== null && dealHealthResult.dealId === id ? dealHealthResult.data : null;
  const generatedProposalDraft =
    proposalDraftResult !== null && proposalDraftResult.dealId === id
      ? proposalDraftResult.data
      : null;
  // isLoading is consumed, not discarded — see AccountDetailPage for the full
  // reasoning. In short: useFeatureFlag fails closed, so a gated control is
  // absent from the DOM until the flags request resolves, and under load that
  // has been measured at ~3s against the E2E healing locator's 2s probe budget.
  // (MINCRM-703)
  const { enabled: dealHealthCheckEnabled, isLoading: dealHealthFlagLoading } =
    useFeatureFlag('ai_deal_health_check');
  const { enabled: stageAdvancementEnabled } = useFeatureFlag('ai_stage_advancement');
  const { enabled: championBlockerEnabled } = useFeatureFlag('ai_champion_blocker_detection');
  const { enabled: proposalDraftEnabled } = useFeatureFlag('ai_proposal_draft_generation');
  const { enabled: csvExportEnabled } = useFeatureFlag('csv_export');
  /** Suggested next stage pre-set into DealForm when the advancement indicator is clicked */
  const [suggestedStage, setSuggestedStage] = useState<string | null>(null);

  /** Close deal modal state — null when closed */
  const [pendingClose, setPendingClose] = useState<{
    stage: string;
    /** Form values captured at the moment the terminal stage was selected */
    formValues: DealFormValues;
  } | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const dealQueryKey = ['deals', id] as const;

  // Three-way merge conflict state (MINCRM-351, MINCRM-406)
  const { conflictBase, conflictTheirs, conflictPendingValues, handleConflict, clearConflict } =
    useEntityConflictHandler<DealFormValues>({
      entityCacheKey: 'deal',
      entityQueryKey: dealQueryKey,
    });

  const { data, isLoading, isError } = useQuery({
    queryKey: dealQueryKey,
    queryFn: () => getDeal(id!),
    enabled: Boolean(id),
  });

  // Passive, page-load stage advancement check (MINCRM-443). The service itself
  // returns { ready: false } for terminal-stage or no-next-stage deals, so no
  // client-side stage filtering is needed beyond waiting for the deal to load.
  const { data: stageAdvancement } = useQuery({
    queryKey: stageAdvancementQueryKey(id ?? ''),
    queryFn: () => getStageAdvancement(id!),
    enabled: Boolean(id) && stageAdvancementEnabled && Boolean(data?.deal),
  });

  // AI champion/blocker stakeholder map (MINCRM-466) — one query serves both the per-contact
  // badges in the linked-contacts list and the stakeholder map panel below.
  const { data: stakeholderMap } = useQuery({
    queryKey: dealStakeholderMapQueryKey(id ?? ''),
    queryFn: () => getDealStakeholderMap(id!),
    enabled: Boolean(id) && championBlockerEnabled && Boolean(data?.deal),
  });

  // Tracks which contact's badge is currently being dismissed, since one mutation
  // is shared across every badge in the linked-contacts list.
  const [dismissingContactId, setDismissingContactId] = useState<string | null>(null);
  const dismissChampionBlockerMutation = useMutation({
    mutationFn: (contactId: string) => dismissContactChampionBlocker(contactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dealStakeholderMapQueryKey(id ?? '') });
    },
    onSettled: () => setDismissingContactId(null),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => listAccounts(),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
  });

  const { data: allContactsData, isError: isContactsError } = useQuery({
    queryKey: ['contacts'],
    queryFn: () => listContacts({ limit: PAGINATION_MAX_LIMIT }),
  });

  const accounts: AccountResponse[] = accountsData?.data ?? [];
  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];

  const updateMutation = useMutation({
    mutationFn: ({ values, version }: { values: DealFormValues; version?: number }) =>
      updateDeal(id!, {
        name: values.name,
        stage: values.stage as DealResponse['stage'],
        // Include pipeline_id only when it differs from the current deal's pipeline (MINCRM-408)
        pipeline_id:
          values.pipeline_id && values.pipeline_id !== deal?.pipeline_id
            ? values.pipeline_id
            : undefined,
        value: values.value !== '' ? parseFloat(values.value) : null,
        currency: values.currency ? (values.currency as SupportedCurrency) : undefined,
        close_date: values.close_date || null,
        account_id: values.account_id || null,
        owner_id: values.owner_id || undefined,
        // null clears the override; undefined leaves it unchanged
        probability: values.probability !== '' ? parseInt(values.probability, 10) : null,
        // Prefer explicit version (from conflict resolution); fall back to cache for normal edits (MINCRM-349)
        version:
          version ??
          queryClient.getQueryData<{ deal: { version: number } }>(dealQueryKey)?.deal.version ??
          1,
      }),
    onSuccess: async (data) => {
      // Seed the cache immediately so the version is correct before any subsequent edit (MINCRM-351)
      queryClient.setQueryData(dealQueryKey, data);
      if (customFieldValues.length > 0) {
        await putCustomFieldValues('deal', id!, customFieldValues);
        queryClient.invalidateQueries({ queryKey: customFieldValuesQueryKey('deal', id!) });
      }
      queryClient.invalidateQueries({ queryKey: dealQueryKey });
      queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: WIN_LOSS_REPORT_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: stageAdvancementQueryKey(id ?? '') });
      setIsEditing(false);
      setUpdateError(null);
      setSuggestedStage(null);
      clearConflict();
    },
    onError: (error: unknown, variables) => {
      if (handleConflict(error, variables)) return;
      setUpdateError(resolveApiError(error as Parameters<typeof resolveApiError>[0], t));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDeal(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: WIN_LOSS_REPORT_QUERY_KEY });
      navigate('/deals', { replace: true });
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setDeleteError(resolveApiError(error, t));
    },
  });

  const linkMutation = useMutation({
    mutationFn: (contactId: string) => linkContactToDeal(id!, contactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dealQueryKey });
      setSelectedContactId('');
      setLinkError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setLinkError(resolveApiError(error, t));
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (contactId: string) => unlinkContactFromDeal(id!, contactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dealQueryKey });
      setUnlinkError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setUnlinkError(resolveApiError(error, t));
    },
  });

  const closeMutation = useMutation({
    mutationFn: ({
      stage,
      close_date,
      loss_reason,
      formValues,
      version,
    }: {
      stage: string;
      close_date: string | null;
      loss_reason: string | null;
      formValues: DealFormValues;
      version?: number;
    }) =>
      updateDeal(id!, {
        name: formValues.name,
        stage,
        value: formValues.value !== '' ? parseFloat(formValues.value) : null,
        close_date,
        loss_reason,
        account_id: formValues.account_id || null,
        owner_id: formValues.owner_id || undefined,
        probability: formValues.probability !== '' ? parseInt(formValues.probability, 10) : null,
        // Prefer explicit version (from conflict resolution); fall back to cache for normal edits (MINCRM-349)
        version:
          version ??
          queryClient.getQueryData<{ deal: { version: number } }>(dealQueryKey)?.deal.version ??
          1,
      }),
    onSuccess: (data) => {
      // Seed the cache immediately so the version is correct before any subsequent edit (MINCRM-351)
      queryClient.setQueryData(dealQueryKey, data);
      queryClient.invalidateQueries({ queryKey: dealQueryKey });
      queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: WIN_LOSS_REPORT_QUERY_KEY });
      setPendingClose(null);
      setCloseError(null);
      setIsEditing(false);
      clearConflict();
    },
    onError: (error: unknown, variables) => {
      if (handleConflict(error, { values: variables.formValues })) {
        setPendingClose(null);
        return;
      }
      setCloseError(resolveApiError(error as Parameters<typeof resolveApiError>[0], t));
    },
  });

  const dealHealthMutation = useMutation({
    mutationFn: () => runDealHealthCheck(id!),
    onSuccess: (result) => {
      setDealHealthResult({ dealId: id!, data: result });
      setDealHealthError(null);
    },
    onError: (error: unknown) => {
      setDealHealthError(resolveApiError(error as Parameters<typeof resolveApiError>[0], t));
    },
  });

  const proposalDraftMutation = useMutation({
    mutationFn: () => generateProposalDraft(id!),
    onSuccess: (result) => {
      setProposalDraftResult({ dealId: id!, data: result.draft });
      setProposalDraftError(null);
    },
    onError: (error: unknown) => {
      setProposalDraftError(resolveApiError(error as Parameters<typeof resolveApiError>[0], t));
    },
  });

  const handleDelete = (): void => {
    setIsConfirmDeleteOpen(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <p aria-busy="true" className="text-sm text-gray-500">
            {t('deals.loading')}
          </p>
        </main>
      </div>
    );
  }

  if (isError || !data?.deal) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <p role="alert" className="text-sm text-red-600">
            {t('deals.notFound')}
          </p>
          <Link to="/deals" className="mt-4 inline-block text-sm text-primary-600 hover:underline">
            {t('deals.backToDeals')}
          </Link>
        </main>
      </div>
    );
  }

  const deal = data.deal;
  const linkedContacts: DealContact[] = data.contacts ?? [];

  /** Set of contact IDs already linked to this deal */
  const linkedContactIds = new Set(linkedContacts.map((c) => c.id));

  /** Contacts available to link (exclude already-linked ones) */
  const linkableContacts = (allContactsData?.data ?? []).filter((c) => !linkedContactIds.has(c.id));

  /** Resolves an account_id to its display name */
  function resolveAccountName(accountId: string | null): string {
    if (!accountId) return '—';
    return accounts.find((a) => a.id === accountId)?.name ?? '—';
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Back link — MINCRM-113, MINCRM-115 */}
        <Link
          to="/deals"
          data-testid="back-to-deals"
          aria-label={t('common.backToDeals')}
          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline mb-6"
        >
          <svg
            aria-hidden="true"
            className="w-4 h-4 rtl:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('common.backToDeals')}
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="deal-name">
            {deal.name}
          </h1>

          {!isEditing && (
            <div className="flex flex-col items-start sm:items-end gap-2 sm:shrink-0">
              <div className="flex items-center gap-2" data-testid="deal-detail-actions">
                {csvExportEnabled && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="deal-detail-export-pdf-button"
                    disabled={isExportingPdf}
                    onClick={async () => {
                      setIsExportingPdf(true);
                      setExportPdfError(null);
                      try {
                        await exportDealPdf(deal.id);
                      } catch {
                        setExportPdfError(t('deals.exportPdfError'));
                      } finally {
                        setIsExportingPdf(false);
                      }
                    }}
                  >
                    {isExportingPdf ? t('deals.exporting') : t('deals.exportPdf')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="edit-deal-button"
                  onClick={() => setIsEditing(true)}
                >
                  {t('deals.edit')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  data-testid="delete-deal-button"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? t('deals.deleting') : t('deals.delete')}
                </Button>
              </div>
              {exportPdfError && (
                <p role="alert" className="text-xs text-red-600" data-testid="export-pdf-error">
                  {exportPdfError}
                </p>
              )}
              {deleteError && (
                <p role="alert" className="text-xs text-red-600" data-testid="delete-error">
                  {deleteError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Converted from lead banner (MINCRM-175) */}
        {!isEditing && deal.source_lead_id && (
          <div
            className="mb-4 rounded border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800"
            data-testid="converted-from-lead-banner"
          >
            <Link to={`/leads/${deal.source_lead_id}`} className="font-medium underline">
              {t('deals.convertedFromLead')}
            </Link>
          </div>
        )}

        {/* AI stage advancement suggestion (MINCRM-443) — passive, page-load indicator.
            No indicator is rendered for { ready: false } (terminal stage, no next stage,
            or the AI was not confident) per the ticket's AC. */}
        {!isEditing && stageAdvancementEnabled && stageAdvancement?.ready && (
          <button
            type="button"
            data-testid="stage-advancement-indicator"
            onClick={() => {
              setSuggestedStage(stageAdvancement.next_stage_name);
              setIsEditing(true);
            }}
            className="mb-4 w-full text-start rounded border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800 hover:bg-primary-100"
          >
            <span className="font-medium">
              {t('deals.stageAdvancementReadyLabel', { stage: stageAdvancement.next_stage_name })}
            </span>
            <p className="mt-1 text-primary-700" data-testid="stage-advancement-rationale">
              {stageAdvancement.rationale}
            </p>
          </button>
        )}

        {isEditing ? (
          <>
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('deals.saveChanges')}</h2>
              <DealForm
                initialValues={deal}
                accounts={accounts}
                users={activeUsers}
                showPipelineSelector
                initialStageOverride={suggestedStage ?? undefined}
                onCloseRequested={(stage, formValues) => {
                  setCloseError(null);
                  setPendingClose({ stage, formValues });
                }}
                onSubmit={(values) => {
                  setUpdateError(null);
                  updateMutation.mutate({ values });
                }}
                onCancel={() => {
                  setIsEditing(false);
                  setUpdateError(null);
                  setSuggestedStage(null);
                  clearConflict();
                }}
                isSubmitting={updateMutation.isPending}
                submitLabel={t('deals.saveChanges')}
                error={updateError ?? undefined}
              />
              <FieldMergeModal
                isOpen={Boolean(conflictPendingValues && conflictBase && conflictTheirs)}
                onClose={() => {
                  clearConflict();
                  setIsEditing(false);
                }}
                entityType="deal"
                base={conflictBase ?? {}}
                theirs={conflictTheirs ?? {}}
                mine={(conflictPendingValues as unknown as Record<string, unknown>) ?? {}}
                fieldLabels={{
                  name: t('deals.nameLabel'),
                  stage: t('deals.stageLabel'),
                  value: t('deals.valueLabel'),
                  currency: t('deals.currencyLabel'),
                  close_date: t('deals.closeDateLabel'),
                  probability: t('deals.probabilityLabel'),
                  owner_id: t('deals.ownerLabel'),
                }}
                onResolve={(resolved) => {
                  updateMutation.mutate({
                    values: {
                      ...(conflictPendingValues as DealFormValues),
                      ...(resolved as Partial<DealFormValues>),
                    },
                    version: conflictTheirs?.version as number | undefined,
                  });
                  clearConflict();
                }}
              />
            </div>
            {id && (
              <CustomFieldsSection
                entityType="deal"
                recordId={id}
                isEditing={true}
                onValuesChange={setCustomFieldValues}
              />
            )}
          </>
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
              <DetailRow
                label={t('deals.stageLabel')}
                value={getStageDisplayName(deal.stage, t)}
                testId="detail-stage"
              />
              <DetailRow
                label={t('deals.valueLabel')}
                value={formatDealValue(deal.value, deal.currency, i18n.language)}
                testId="detail-value"
              />
              <DetailRow
                label={t('deals.closeDateLabel')}
                value={formatLocalDate(deal.close_date, i18n.language)}
                testId="detail-close-date"
              />
              <DetailRow
                label={t('deals.accountLabel')}
                value={resolveAccountName(deal.account_id)}
                testId="detail-account"
              />
              {/* Probability — show override indicator when manually set (MINCRM-179) */}
              <DetailRow
                label={t('deals.probabilityLabel')}
                value={
                  deal.probability_is_overridden
                    ? `${deal.effective_probability}% (${t('deals.probabilityOverridden')})`
                    : `${deal.effective_probability}%`
                }
                testId="detail-probability"
                nowrap
              />
              {deal.loss_reason && (
                <DetailRow
                  label={t('deals.lossReasonLabel')}
                  value={deal.loss_reason}
                  testId="detail-loss-reason"
                />
              )}
              <DetailRow
                label={t('deals.createdLabel')}
                value={formatLocalDate(deal.created_at, i18n.language)}
                testId="detail-created"
              />
              <DetailRow
                label={t('deals.ownerLabel')}
                value={resolveOwnerName(deal.owner_id, activeUsers, t('deals.ownerUnknown'))}
                testId="detail-owner"
              />
            </div>

            {id && <CustomFieldsSection entityType="deal" recordId={id} isEditing={false} />}

            {/* AI deal health check (MINCRM-442) */}
            {id && (dealHealthCheckEnabled || dealHealthFlagLoading) && (
              <section className="mt-8" aria-labelledby="deal-health-heading">
                <h2
                  id="deal-health-heading"
                  className="text-sm font-semibold text-gray-900 mb-3"
                  data-testid="deal-health-heading"
                >
                  {t('deals.dealHealthHeading')}
                </h2>
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="run-deal-health-check-button"
                    disabled={dealHealthMutation.isPending || dealHealthFlagLoading}
                    onClick={() => {
                      setDealHealthError(null);
                      dealHealthMutation.mutate();
                    }}
                  >
                    {dealHealthMutation.isPending
                      ? t('deals.dealHealthRunning')
                      : t('deals.dealHealthRunCheck')}
                  </Button>

                  {dealHealthMutation.isPending && (
                    <div className="mt-4 space-y-2" aria-hidden="true">
                      <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
                      <div className="h-3 w-full bg-gray-100 rounded animate-pulse" />
                      <div className="h-3 w-5/6 bg-gray-100 rounded animate-pulse" />
                    </div>
                  )}

                  {dealHealthError && (
                    <p
                      role="alert"
                      className="mt-3 text-xs text-red-600"
                      data-testid="deal-health-error"
                    >
                      {dealHealthError}
                    </p>
                  )}

                  {!dealHealthMutation.isPending && dealHealth && (
                    <div className="mt-4" data-testid="deal-health-result">
                      <Badge variant={HEALTH_STATUS_VARIANT[dealHealth.status]}>
                        {t(`deals.dealHealthStatus.${dealHealth.status}`)}
                      </Badge>
                      <p className="mt-3 text-sm text-gray-700" data-testid="deal-health-narrative">
                        {dealHealth.narrative}
                      </p>
                      <ul
                        className="mt-3 list-disc ps-5 space-y-1 text-sm text-gray-700"
                        data-testid="deal-health-next-actions"
                      >
                        {dealHealth.next_actions.map((action, index) => (
                          <li key={index}>{action}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!dealHealthMutation.isPending && !dealHealth && !dealHealthError && (
                    <p className="mt-3 text-sm text-gray-500" data-testid="deal-health-empty">
                      {t('deals.dealHealthEmpty')}
                    </p>
                  )}
                </div>
              </section>
            )}

            {/* AI proposal draft generation (MINCRM-473) */}
            {id && proposalDraftEnabled && (
              <section className="mt-8" aria-labelledby="proposal-draft-heading">
                <h2
                  id="proposal-draft-heading"
                  className="text-sm font-semibold text-gray-900 mb-3"
                  data-testid="proposal-draft-heading"
                >
                  {t('proposalDraft.sectionHeading')}
                </h2>
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="generate-proposal-draft-button"
                    disabled={proposalDraftMutation.isPending}
                    onClick={() => {
                      setProposalDraftError(null);
                      proposalDraftMutation.mutate();
                    }}
                  >
                    {proposalDraftMutation.isPending
                      ? t('proposalDraft.generating')
                      : t('proposalDraft.generateButton')}
                  </Button>
                  {proposalDraftError && (
                    <p
                      role="alert"
                      className="mt-2 text-sm text-red-600"
                      data-testid="proposal-draft-error"
                    >
                      {proposalDraftError}
                    </p>
                  )}
                </div>
              </section>
            )}

            {generatedProposalDraft && id && (
              <ProposalDraftEditor
                dealId={id}
                dealName={deal.name}
                initialDraft={generatedProposalDraft}
                onDismiss={() => setProposalDraftResult(null)}
              />
            )}

            {id && (
              <EntityDetailSidebar
                entityType="deal"
                entityId={id}
                entityQueryKey={DEALS_QUERY_KEY}
                isEditing={isEditing}
              >
                {/* AI stakeholder map (MINCRM-466) */}
                {championBlockerEnabled && stakeholderMap && stakeholderMap.contacts.length > 0 && (
                  <section className="mt-8" aria-labelledby="stakeholder-map-heading">
                    <h2
                      id="stakeholder-map-heading"
                      className="text-sm font-semibold text-gray-900 mb-3"
                      data-testid="stakeholder-map-heading"
                    >
                      {t('championBlocker.stakeholderMapHeading')}
                    </h2>
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      {stakeholderMap.single_threaded_risk && (
                        <p
                          role="alert"
                          className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                          data-testid="single-threaded-risk-warning"
                        >
                          {t('championBlocker.singleThreadedRiskWarning')}
                        </p>
                      )}
                      <p className="text-xs text-gray-500" data-testid="stakeholder-map-summary">
                        {t('championBlocker.stakeholderMapSummary', {
                          engaged: stakeholderMap.contacts.length,
                          champions: stakeholderMap.champion_count,
                          blockers: stakeholderMap.blocker_count,
                        })}
                      </p>
                    </div>
                  </section>
                )}

                {/* Linked contacts */}
                <section className="mt-8" aria-labelledby="linked-contacts-heading">
                  <h2
                    id="linked-contacts-heading"
                    className="text-sm font-semibold text-gray-900 mb-3"
                    data-testid="linked-contacts-heading"
                  >
                    {t('deals.linkedContactsHeading')}
                  </h2>
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    {linkedContacts.length === 0 ? (
                      <p
                        className="px-6 py-4 text-sm text-gray-500"
                        data-testid="linked-contacts-empty"
                        role="status"
                      >
                        {t('deals.linkedContactsEmpty')}
                      </p>
                    ) : (
                      <ul className="divide-y divide-gray-100" data-testid="linked-contacts-list">
                        {linkedContacts.map((contact) => {
                          const stakeholder = stakeholderMap?.contacts.find(
                            (c) => c.contact_id === contact.id,
                          );
                          return (
                            <li
                              key={contact.id}
                              className="px-6 py-3 flex items-center justify-between gap-3"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <Link
                                  to={`/contacts/${contact.id}`}
                                  data-testid={`linked-contact-${contact.id}`}
                                  className="text-sm font-medium text-primary-600 hover:underline"
                                >
                                  {contact.first_name} {contact.last_name}
                                </Link>
                                {contact.title && (
                                  <span className="text-sm text-gray-500">{contact.title}</span>
                                )}
                                {championBlockerEnabled &&
                                  stakeholder &&
                                  !stakeholder.dismissed && (
                                    <ChampionBlockerBadge
                                      contactId={contact.id}
                                      status={stakeholder.status}
                                      isOverridden={stakeholder.is_overridden}
                                      onDismiss={() => {
                                        setDismissingContactId(contact.id);
                                        dismissChampionBlockerMutation.mutate(contact.id);
                                      }}
                                      isDismissing={dismissingContactId === contact.id}
                                    />
                                  )}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                data-testid={`unlink-contact-${contact.id}`}
                                onClick={() => unlinkMutation.mutate(contact.id)}
                                disabled={unlinkMutation.isPending}
                              >
                                {unlinkMutation.isPending
                                  ? t('deals.unlinking')
                                  : t('deals.unlink')}
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  {unlinkError && (
                    <p
                      role="alert"
                      className="mt-2 text-xs text-red-600"
                      data-testid="unlink-contact-error"
                    >
                      {unlinkError}
                    </p>
                  )}

                  {/* Contacts fetch error — MINCRM-117 */}
                  {isContactsError && (
                    <p
                      role="alert"
                      className="mt-3 text-sm text-red-600"
                      data-testid="contacts-fetch-error"
                    >
                      {t('errors.loadContactsFailed')}
                    </p>
                  )}

                  {/* Link contact form */}
                  {!isContactsError && linkableContacts.length > 0 && (
                    <div className="mt-3 flex items-center gap-2" data-testid="link-contact-form">
                      <Select
                        id="link-contact-select"
                        data-testid="link-contact-select"
                        value={selectedContactId}
                        onChange={(e) => setSelectedContactId(e.target.value)}
                        className="flex-1"
                      >
                        <option value="">{t('deals.selectContactToLink')}</option>
                        {linkableContacts.map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.first_name} {contact.last_name}
                          </option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        data-testid="link-contact-button"
                        disabled={!selectedContactId || linkMutation.isPending}
                        onClick={() => {
                          if (selectedContactId) linkMutation.mutate(selectedContactId);
                        }}
                      >
                        {linkMutation.isPending ? t('deals.linking') : t('deals.linkContact')}
                      </Button>
                    </div>
                  )}

                  {linkError && (
                    <p
                      role="alert"
                      className="mt-2 text-xs text-red-600"
                      data-testid="link-contact-error"
                    >
                      {linkError}
                    </p>
                  )}
                </section>
              </EntityDetailSidebar>
            )}
          </>
        )}
      </main>

      {/* Delete confirmation modal — MINCRM-107 */}
      <ConfirmDeleteModal
        isOpen={isConfirmDeleteOpen}
        message={t('deals.confirmDelete')}
        isDeleting={deleteMutation.isPending}
        onConfirm={() => {
          setDeleteError(null);
          deleteMutation.mutate();
        }}
        onCancel={() => setIsConfirmDeleteOpen(false)}
      />

      {pendingClose && (
        <CloseDealModal
          isOpen={true}
          targetStage={pendingClose.stage}
          initialCloseDate={new Date().toISOString().split('T')[0]}
          isSubmitting={closeMutation.isPending}
          error={closeError ?? undefined}
          onConfirm={(closeDate, lossReason) => {
            closeMutation.mutate({
              stage: pendingClose.stage,
              close_date: closeDate || null,
              loss_reason: lossReason || null,
              formValues: pendingClose.formValues,
            });
          }}
          onCancel={() => {
            setPendingClose(null);
            setCloseError(null);
          }}
        />
      )}
    </div>
  );
}

/** Renders a labelled read-only row in the detail card, stacked on mobile. */
function DetailRow({
  label,
  value,
  testId,
  nowrap = false,
}: {
  label: string;
  value: string;
  testId: string;
  nowrap?: boolean;
}) {
  return (
    <div className="px-6 py-4 flex flex-col md:flex-row md:items-start md:gap-4">
      <span className="w-full md:w-36 md:shrink-0 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 md:mb-0 md:pt-0.5">
        {label}
      </span>
      {/* break-words: long currency strings (e.g. ¥1,234,567,890) have no natural break point */}
      <span
        className={`text-sm text-gray-900 break-words${nowrap ? ' whitespace-nowrap' : ''}`}
        data-testid={testId}
      >
        {value}
      </span>
    </div>
  );
}
