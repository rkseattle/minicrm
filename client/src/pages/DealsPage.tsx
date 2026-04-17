/**
 * DealsPage component.
 * Displays deals as either a Kanban pipeline board (default) or a list/table view.
 * The board view satisfies MINCRM-16 AC: deals as cards organised into stage columns,
 * each column showing deal count and total value.
 * The list view provides the original tabular layout for scanning and bulk review.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import DealForm from '@/components/DealForm.js';
import StageColumn from '@/components/StageColumn.js';
import CloseDealModal from '@/components/CloseDealModal.js';
import { Button } from '@/components/ui/Button.js';
import { OwnerToggle } from '@/components/ui/OwnerToggle.js';
import type { OwnerFilter } from '@/components/ui/OwnerToggle.js';
import { listDeals, createDeal, updateDeal, exportDealsCsv, DEALS_QUERY_KEY } from '@/api/deals.js';
import { listTags, TAGS_QUERY_KEY } from '@/api/tags.js';
import TagBadge from '@/components/TagBadge.js';
import { Pagination } from '@/components/ui/Pagination.js';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
} from '@shared/schemas/paginationSchema.js';

/** Max records fetched for the board view — fetches all by capping at the server max */
const PAGINATION_MAX_BOARD_LIMIT = PAGINATION_MAX_LIMIT;
import { listAccounts } from '@/api/accounts.js';
import { useAuth } from '@/hooks/useAuth.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import { WIN_LOSS_REPORT_QUERY_KEY } from '@/api/reports.js';
import { DASHBOARD_QUERY_KEY } from '@/api/dashboard.js';
import type { ActiveUser } from '@/api/users.js';
import type { DealFormValues } from '@/components/DealForm.js';
import type { DealResponse } from '@shared/schemas/dealSchema.js';
import type { SupportedCurrency } from '@shared/schemas/settingsSchema.js';
import { getStageDisplayName } from '@/utils/pipelineStageI18nKey.js';
import { formatLocalDate } from '@/utils/formatLocalDate.js';
import { usePipelineStages } from '@/hooks/usePipelineStages.js';

/** Which view is active on the Deals page */
type ViewMode = 'board' | 'list';

/** sessionStorage key used to persist the selected view mode across navigation (MINCRM-146) */
const VIEW_MODE_STORAGE_KEY = 'deals.viewMode';

/** State captured while the user has selected a terminal stage but not yet confirmed */
interface PendingClose {
  dealId: string;
  stage: string;
}

/**
 * Formats a deal value using the deal's own currency and the active locale. (MINCRM-189)
 *
 * @param value - Numeric string from the API (pg returns numeric as string)
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

/** Today's date in YYYY-MM-DD format, used as default close date in the close modal */
function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Deals page with board/list view toggle.
 * Board view (default) renders a Kanban pipeline board satisfying MINCRM-16 AC.
 * List view renders the original sortable table.
 */
export default function DealsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Live stage list — replaces hardcoded PIPELINE_STAGES (MINCRM-180)
  const { stages: pipelineStages, stageNames, terminalStageNames } = usePipelineStages();
  const openStages = pipelineStages.filter((s) => !s.is_terminal);
  const [isExporting, setIsExporting] = useState(false);

  // ── View mode ───────────────��──────────────────────────────────────────────
  // Restore from sessionStorage so the chosen view survives navigation (MINCRM-146)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = sessionStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return stored === 'list' ? 'list' : 'board';
  });

  // ── Create form ────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const newDealButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocusRef = useRef(false);

  // ── Shared filter state (MINCRM-176) ──────────────────────────────────────
  // Both ownerFilter and showClosed are lifted to the parent so they persist
  // across Board ↔ List view switches.
  const [ownerFilter, setOwnerFilterState] = useState<OwnerFilter>('all');

  /**
   * Updates the owner filter. Resets list pagination to page 1. (MINCRM-176)
   *
   * @param value - New owner filter value
   */
  function setOwnerFilter(value: OwnerFilter): void {
    setListPage(1);
    setOwnerFilterState(value);
  }

  // ── List view state ────────────────────────────────────────────────────────
  const [listPage, setListPage] = useState(1);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  type SortColumn = 'name' | 'close_date';
  type SortDir = 'ascending' | 'descending';
  const [sortCol, setSortCol] = useState<SortColumn>('name');
  const [sortDir, setSortDir] = useState<SortDir>('ascending');

  // ── Board view state ───────────────────────────────────────────────────────
  /** Set of deal IDs whose stage updates are currently in flight */
  const [updatingDealIds, setUpdatingDealIds] = useState<Set<string>>(new Set());
  const [stageError, setStageError] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(true);
  /** Index of the currently visible stage in the mobile single-stage board view */
  const [mobileStageIndex, setMobileStageIndex] = useState(0);

  // ── Restore focus after form closes ───────────────────────────────────────
  useEffect(() => {
    if (!showForm && shouldRestoreFocusRef.current) {
      newDealButtonRef.current?.focus();
      shouldRestoreFocusRef.current = false;
    }
  }, [showForm]);

  // ── Data fetching ──────────────────────────────────────────────────────────

  // Board view: fetch ALL deals (no pagination — board needs every deal in every column).
  // List view: fetch one page at a time with server-side sort.
  const boardQueryKey =
    ownerFilter === 'me'
      ? ([...DEALS_QUERY_KEY, 'board', { owner: 'me' }] as const)
      : ([...DEALS_QUERY_KEY, 'board'] as const);

  const listQueryKey = [
    ...DEALS_QUERY_KEY,
    'list',
    {
      owner: ownerFilter === 'me' ? 'me' : undefined,
      hideClosed: !showClosed,
      sort: sortCol,
      dir: sortDir,
      tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      page: listPage,
    },
  ] as const;

  const {
    data: boardData,
    isLoading: boardLoading,
    isError: boardError,
  } = useQuery({
    queryKey: boardQueryKey,
    queryFn: () =>
      listDeals({
        owner: ownerFilter === 'me' ? 'me' : undefined,
        limit: PAGINATION_MAX_BOARD_LIMIT,
      }),
    enabled: viewMode === 'board',
  });

  const {
    data: listData,
    isLoading: listLoading,
    isError: listError,
  } = useQuery({
    queryKey: listQueryKey,
    queryFn: () =>
      listDeals({
        owner: ownerFilter === 'me' ? 'me' : undefined,
        hideClosed: !showClosed || undefined,
        sort: sortCol,
        dir: sortDir === 'ascending' ? 'asc' : 'desc',
        tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        page: listPage,
        limit: PAGINATION_DEFAULT_LIMIT,
      }),
    enabled: viewMode === 'list',
  });

  const { data: tagsData } = useQuery({
    queryKey: TAGS_QUERY_KEY,
    queryFn: listTags,
    staleTime: 60_000,
  });

  // Unified aliases used by shared code below
  const isLoading = viewMode === 'board' ? boardLoading : listLoading;
  const isError = viewMode === 'board' ? boardError : listError;

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => listAccounts(),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
  });

  const accounts = useMemo(() => accountsData?.data ?? [], [accountsData?.data]);
  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];

  /** Map of account_id → name for O(1) lookup in deal cards */
  const accountNames = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach((a) => map.set(a.id, a.name));
    return map;
  }, [accounts]);

  // ── Deals derived state ────────────────────────────────────────────────────

  /**
   * Deals grouped by stage, preserving PIPELINE_STAGES order.
   * When showClosed is false, terminal-stage deals are omitted from their columns.
   * Uses boardData since the board fetches all deals in a single page.
   */
  const dealsByStage = useMemo(() => {
    const grouped = new Map<string, DealResponse[]>();
    stageNames.forEach((stage) => grouped.set(stage, []));
    (boardData?.data ?? []).forEach((deal) => {
      if (!showClosed && terminalStageNames.includes(deal.stage)) return;
      if (!grouped.has(deal.stage)) grouped.set(deal.stage, []);
      grouped.get(deal.stage)!.push(deal);
    });
    return grouped;
  }, [boardData?.data, showClosed, stageNames, terminalStageNames]);

  /**
   * Per-stage count and total value for the open pipeline stages.
   * Computed from the already-fetched list page — no extra API call needed.
   * Closed Won and Closed Lost are excluded (not part of the active pipeline).
   * Note: summary reflects only the current page's deals when paginated.
   */
  const pipelineSummary = useMemo(() => {
    if (viewMode !== 'list') return [];
    const deals = listData?.data ?? [];
    return openStages.map((s) => {
      const stageDeals = deals.filter((d) => d.stage === s.name);
      const currencies = new Set(stageDeals.filter((d) => d.value).map((d) => d.currency));
      const mixedCurrency = currencies.size > 1;
      const total = mixedCurrency
        ? null
        : stageDeals.reduce((acc, d) => acc + (d.value ? parseFloat(d.value) : 0), 0);
      const currency = currencies.size === 1 ? [...currencies][0] : null;
      return { stage: s.name, count: stageDeals.length, total, currency, mixedCurrency };
    });
  }, [listData?.data, viewMode, openStages]);

  // Server handles sorting, pagination, and closed-stage filtering (MINCRM-176)
  const sortedDeals: DealResponse[] = listData?.data ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (values: DealFormValues) =>
      createDeal({
        name: values.name,
        stage: values.stage as DealResponse['stage'],
        value: values.value !== '' ? parseFloat(values.value) : undefined,
        currency: values.currency ? (values.currency as SupportedCurrency) : undefined,
        close_date: values.close_date || undefined,
        account_id: values.account_id || undefined,
        // Pass probability override only when the field is non-empty (MINCRM-179)
        probability: values.probability !== '' ? parseInt(values.probability, 10) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
      shouldRestoreFocusRef.current = true;
      setShowForm(false);
      setCreateError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setCreateError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const stageMutation = useMutation({
    mutationFn: ({
      id,
      stage,
      close_date,
      loss_reason,
    }: {
      id: string;
      stage: string;
      close_date?: string;
      loss_reason?: string;
    }) =>
      updateDeal(id, { stage, close_date: close_date ?? null, loss_reason: loss_reason ?? null }),
    onMutate: ({ id }) => {
      setStageError(null);
      setUpdatingDealIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    },
    onError: (_error, variables) => {
      if (terminalStageNames.includes(variables.stage)) {
        setCloseError(t('pipeline.stageUpdateError'));
      } else {
        setStageError(t('pipeline.stageUpdateError'));
      }
    },
    onSuccess: (_data, variables) => {
      if (terminalStageNames.includes(variables.stage)) {
        setPendingClose(null);
        setCloseError(null);
      }
    },
    onSettled: (_data, _error, { id, stage }) => {
      setUpdatingDealIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      // Invalidate all deals queries (board and list variants)
      queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY });
      if (terminalStageNames.includes(stage)) {
        queryClient.invalidateQueries({ queryKey: WIN_LOSS_REPORT_QUERY_KEY });
      }
    },
  });

  // ── Board event handlers ───────────────────────────────────────────────────

  /**
   * Handles a non-terminal stage change from a deal card.
   *
   * @param dealId - UUID of the deal to update
   * @param stage - Target pipeline stage
   */
  function handleStageChange(dealId: string, stage: string): void {
    stageMutation.mutate({ id: dealId, stage });
  }

  /**
   * Opens the close deal modal when a terminal stage is selected on a deal card.
   *
   * @param dealId - UUID of the deal to close
   * @param stage - Terminal stage selected by the user
   */
  function handleCloseRequested(dealId: string, stage: string): void {
    setCloseError(null);
    setPendingClose({ dealId, stage });
  }

  /**
   * Called when the user confirms the close deal modal.
   *
   * @param closeDate - YYYY-MM-DD close date
   * @param lossReason - Free-text loss reason (empty when not applicable)
   */
  function handleCloseConfirm(closeDate: string, lossReason: string): void {
    if (!pendingClose) return;
    stageMutation.mutate({
      id: pendingClose.dealId,
      stage: pendingClose.stage,
      close_date: closeDate || undefined,
      loss_reason: lossReason || undefined,
    });
  }

  // ── List sort handler ──────────────────────────────────────────────────────

  /**
   * Toggles sort column/direction and resets to page 1.
   *
   * @param col - The column header that was clicked
   */
  function handleSort(col: SortColumn): void {
    if (col === sortCol) {
      setSortDir((d) => (d === 'ascending' ? 'descending' : 'ascending'));
    } else {
      setSortCol(col);
      setSortDir('ascending');
    }
    setListPage(1);
  }

  /** Resolves an account_id to its display name */
  function resolveAccountName(accountId: string | null): string {
    if (!accountId) return '—';
    return accounts.find((a) => a.id === accountId)?.name ?? '—';
  }

  const isClosing = stageMutation.isPending && pendingClose !== null;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main
        className={
          viewMode === 'board' ? 'px-4 sm:px-6 py-8' : 'max-w-7xl mx-auto px-4 sm:px-6 py-8'
        }
      >
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('deals.pageTitle')}</h1>
          <div className="flex items-center gap-2">
            {/* Export filtered view */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="deals-export-csv-button"
              disabled={isExporting}
              onClick={async () => {
                setIsExporting(true);
                try {
                  await exportDealsCsv({
                    all: isAdmin && ownerFilter === 'all' ? true : undefined,
                  });
                } finally {
                  setIsExporting(false);
                }
              }}
            >
              {isExporting ? t('deals.exporting') : t('deals.exportCsv')}
            </Button>
            {/* Export all — admins only */}
            {isAdmin && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="deals-export-all-button"
                disabled={isExporting}
                onClick={async () => {
                  setIsExporting(true);
                  try {
                    await exportDealsCsv({ all: true });
                  } finally {
                    setIsExporting(false);
                  }
                }}
              >
                {isExporting ? t('deals.exporting') : t('deals.exportAll')}
              </Button>
            )}
            {/* View toggle */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="deals-view-toggle"
              onClick={() => {
                const nextMode: ViewMode = viewMode === 'board' ? 'list' : 'board';
                sessionStorage.setItem(VIEW_MODE_STORAGE_KEY, nextMode);
                setViewMode(nextMode);
              }}
            >
              {viewMode === 'board' ? t('deals.viewList') : t('deals.viewBoard')}
            </Button>
            {/* New Deal button — only shown when form is not open */}
            {!showForm && (
              <Button
                ref={newDealButtonRef}
                type="button"
                data-testid="new-deal-button"
                onClick={() => setShowForm(true)}
              >
                {t('deals.newDeal')}
              </Button>
            )}
          </div>
        </div>

        {/* Inline create form */}
        {showForm && (
          <section className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('deals.newDeal')}</h2>
            <DealForm
              triggerRef={newDealButtonRef}
              accounts={accounts}
              accountRequired
              onSubmit={(values) => {
                setCreateError(null);
                createMutation.mutate(values);
              }}
              onCancel={() => {
                shouldRestoreFocusRef.current = true;
                setShowForm(false);
                setCreateError(null);
              }}
              isSubmitting={createMutation.isPending}
              submitLabel={t('deals.save')}
              error={createError ?? undefined}
            />
          </section>
        )}

        {/* ── Board view ──────────────────────────────────────────────────── */}
        {viewMode === 'board' && (
          <>
            {/* Board toolbar — filter controls (MINCRM-176) */}
            <div className="flex items-center gap-3 mb-4">
              <OwnerToggle
                value={ownerFilter}
                onChange={setOwnerFilter}
                testIdPrefix="deals-owner-filter"
              />
              <Button
                variant="secondary"
                size="sm"
                data-testid="toggle-closed-deals"
                onClick={() => setShowClosed((prev) => !prev)}
              >
                {showClosed
                  ? t('pipeline.closeDeal.hideClosed')
                  : t('pipeline.closeDeal.showClosed')}
              </Button>
            </div>

            {stageError && (
              <div
                role="alert"
                data-testid="stage-update-error"
                className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {stageError}
              </div>
            )}

            {isLoading && (
              <div className="text-center py-12">
                <p aria-busy="true" className="text-sm text-gray-400">
                  {t('pipeline.loading')}
                </p>
              </div>
            )}

            {isError && (
              <div
                role="alert"
                className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {t('errors.generic')}
              </div>
            )}

            {!isLoading && !isError && (
              <div data-testid="pipeline-board">
                {/* Mobile single-stage view — visible below md */}
                <div className="md:hidden">
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <button
                      type="button"
                      aria-label={t('pipeline.prevStage')}
                      data-testid="pipeline-mobile-prev"
                      onClick={() => setMobileStageIndex((i) => Math.max(0, i - 1))}
                      disabled={mobileStageIndex === 0}
                      className="flex items-center justify-center w-11 h-11 rounded-md border border-gray-200 bg-white text-gray-600 disabled:opacity-40 hover:bg-gray-50"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <div className="flex-1 text-center">
                      <p
                        className="text-sm font-semibold text-gray-700"
                        data-testid="pipeline-mobile-stage-name"
                      >
                        {getStageDisplayName(stageNames[mobileStageIndex] ?? '', t)}{' '}
                        <span className="font-normal text-gray-500">
                          {`(${(dealsByStage.get(stageNames[mobileStageIndex] ?? '') ?? []).length})`}
                        </span>
                      </p>
                      <p className="text-xs text-gray-400">
                        {t('pipeline.stageOf', {
                          current: mobileStageIndex + 1,
                          total: stageNames.length,
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={t('pipeline.nextStage')}
                      data-testid="pipeline-mobile-next"
                      onClick={() =>
                        setMobileStageIndex((i) => Math.min(stageNames.length - 1, i + 1))
                      }
                      disabled={mobileStageIndex === stageNames.length - 1}
                      className="flex items-center justify-center w-11 h-11 rounded-md border border-gray-200 bg-white text-gray-600 disabled:opacity-40 hover:bg-gray-50"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                  <StageColumn
                    key={stageNames[mobileStageIndex]}
                    stage={stageNames[mobileStageIndex] ?? ''}
                    deals={dealsByStage.get(stageNames[mobileStageIndex] ?? '') ?? []}
                    accountNames={accountNames}
                    onStageChange={handleStageChange}
                    onCloseRequested={handleCloseRequested}
                    updatingDealIds={updatingDealIds}
                    fullWidth
                    testIdPrefix="mobile-"
                  />
                </div>
                {/* Desktop multi-column Kanban — hidden below md */}
                <div className="hidden md:flex gap-4 overflow-x-auto pb-4">
                  {stageNames.map((stage) => (
                    <StageColumn
                      key={stage}
                      stage={stage}
                      deals={dealsByStage.get(stage) ?? []}
                      accountNames={accountNames}
                      onStageChange={handleStageChange}
                      onCloseRequested={handleCloseRequested}
                      updatingDealIds={updatingDealIds}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── List view ───────────────────────────────────────────────────── */}
        {viewMode === 'list' && (
          <>
            {/* List toolbar — filter controls (MINCRM-176) */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <OwnerToggle
                value={ownerFilter}
                onChange={setOwnerFilter}
                testIdPrefix="deals-owner-filter"
              />
              <Button
                variant="secondary"
                size="sm"
                data-testid="toggle-closed-deals"
                onClick={() => {
                  setListPage(1);
                  setShowClosed((prev) => !prev);
                }}
              >
                {showClosed
                  ? t('pipeline.closeDeal.hideClosed')
                  : t('pipeline.closeDeal.showClosed')}
              </Button>
              {/* Tag filter (MINCRM-186) */}
              {tagsData && tagsData.tags.length > 0 && (
                <select
                  aria-label={t('tags.sectionTitle')}
                  data-testid="deals-tag-filter"
                  value=""
                  onChange={(e) => {
                    const tagId = e.target.value;
                    if (tagId && !selectedTagIds.includes(tagId)) {
                      setSelectedTagIds((prev) => [...prev, tagId]);
                      setListPage(1);
                    }
                  }}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">{t('tags.sectionTitle')}</option>
                  {tagsData.tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              )}
              {/* Active tag filter chips */}
              {selectedTagIds.length > 0 && (
                <div className="flex flex-wrap gap-1" data-testid="deals-active-tag-filters">
                  {selectedTagIds.map((tagId) => {
                    const tag = tagsData?.tags.find((tg) => tg.id === tagId);
                    if (!tag) return null;
                    return (
                      <TagBadge
                        key={tag.id}
                        tag={tag}
                        onRemove={(id) => {
                          setSelectedTagIds((prev) => prev.filter((tg) => tg !== id));
                          setListPage(1);
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pipeline summary bar — shows open-stage deal counts and totals (MINCRM-56) */}
            {!isLoading && !isError && (
              <div
                data-testid="pipeline-summary-bar"
                role="region"
                aria-label={t('deals.pipelineSummaryLabel')}
                className="mb-4 flex flex-wrap gap-2"
              >
                {pipelineSummary.map(({ stage, count, total, currency, mixedCurrency }) => (
                  <div
                    key={stage}
                    data-testid={`pipeline-summary-${stage.toLowerCase().replace(/\s+/g, '-')}`}
                    className="flex items-center gap-1.5 rounded-full bg-white border border-gray-200 px-3 py-1 text-xs text-gray-700"
                  >
                    <span className="font-semibold">{getStageDisplayName(stage, t)}</span>
                    <span className="text-gray-400">·</span>
                    <span>{count}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-500">
                      {mixedCurrency
                        ? t('pipeline.mixedCurrency')
                        : new Intl.NumberFormat(i18n.language, {
                            style: 'currency',
                            currency: currency ?? 'USD',
                            notation: 'compact',
                            maximumFractionDigits: 1,
                          }).format(total ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {isLoading && (
              <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
                <p aria-busy="true" className="text-sm text-gray-400">
                  {t('deals.loading')}
                </p>
              </div>
            )}

            {isError && (
              <div
                role="alert"
                className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {t('errors.generic')}
              </div>
            )}

            {!isLoading && !isError && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                {sortedDeals.length === 0 ? (
                  <div className="p-12 text-center">
                    <p className="text-sm text-gray-400">{t('deals.empty')}</p>
                  </div>
                ) : (
                  <>
                    {/* Mobile card view — visible below md */}
                    <ul className="md:hidden divide-y divide-gray-100">
                      {sortedDeals.map((deal) => (
                        <li
                          key={deal.id}
                          className="px-4 py-3"
                          data-testid={`deal-list-card-${deal.id}`}
                        >
                          <Link
                            to={`/deals/${deal.id}`}
                            data-testid={`deal-list-card-link-${deal.id}`}
                            className="block font-medium text-indigo-600 hover:underline mb-1"
                          >
                            {deal.name}
                          </Link>
                          <p className="text-sm text-gray-700">
                            {getStageDisplayName(deal.stage, t)}
                          </p>
                          <p className="text-sm text-gray-500">
                            {formatDealValue(deal.value, deal.currency, i18n.language)}
                          </p>
                          <p
                            className="text-xs text-gray-400 mt-1"
                            data-testid={`deal-list-card-owner-${deal.id}`}
                          >
                            {t('deals.columnOwner')}:{' '}
                            {resolveOwnerName(deal.owner_id, activeUsers, t('deals.ownerUnknown'))}
                          </p>
                          {deal.tags && deal.tags.length > 0 && (
                            <div
                              className="flex flex-wrap gap-1 mt-1"
                              data-testid={`deal-list-card-tags-${deal.id}`}
                            >
                              {deal.tags.map((tag) => (
                                <TagBadge key={tag.id} tag={tag} />
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>

                    {/* Desktop table — hidden below md */}
                    <table className="hidden md:table w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50">
                          <th
                            className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide"
                            aria-sort={sortCol === 'name' ? sortDir : 'none'}
                          >
                            <button
                              type="button"
                              onClick={() => handleSort('name')}
                              className="inline-flex items-center gap-1 hover:text-gray-700"
                              data-testid="deals-sort-name"
                            >
                              {t('deals.columnName')}
                              {sortCol === 'name' && (
                                <svg
                                  aria-label={
                                    sortDir === 'ascending'
                                      ? t('common.sortAsc')
                                      : t('common.sortDesc')
                                  }
                                  className={`w-3 h-3 inline-block ms-1 transition-transform ${sortDir === 'ascending' ? 'rotate-180' : ''}`}
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M19 9l-7 7-7-7"
                                  />
                                </svg>
                              )}
                            </button>
                          </th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            {t('deals.columnStage')}
                          </th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            {t('deals.columnValue')}
                          </th>
                          <th
                            className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide"
                            aria-sort={sortCol === 'close_date' ? sortDir : 'none'}
                          >
                            <button
                              type="button"
                              onClick={() => handleSort('close_date')}
                              className="inline-flex items-center gap-1 hover:text-gray-700"
                              data-testid="deals-sort-close-date"
                            >
                              {t('deals.columnCloseDate')}
                              {sortCol === 'close_date' && (
                                <svg
                                  aria-label={
                                    sortDir === 'ascending'
                                      ? t('common.sortAsc')
                                      : t('common.sortDesc')
                                  }
                                  className={`w-3 h-3 inline-block ms-1 transition-transform ${sortDir === 'ascending' ? 'rotate-180' : ''}`}
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M19 9l-7 7-7-7"
                                  />
                                </svg>
                              )}
                            </button>
                          </th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            {t('deals.columnAccount')}
                          </th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            {t('deals.columnOwner')}
                          </th>
                          <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            {t('tags.sectionTitle')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {sortedDeals.map((deal) => (
                          <tr key={deal.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-indigo-600">
                              <Link
                                to={`/deals/${deal.id}`}
                                data-testid={`deal-link-${deal.id}`}
                                className="hover:underline"
                              >
                                {deal.name}
                              </Link>
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {getStageDisplayName(deal.stage, t)}
                            </td>
                            <td className="px-4 py-3 text-gray-500">
                              {formatDealValue(deal.value, deal.currency, i18n.language)}
                            </td>
                            <td className="px-4 py-3 text-gray-500">
                              {formatLocalDate(deal.close_date, i18n.language)}
                            </td>
                            <td className="px-4 py-3 text-gray-500">
                              {resolveAccountName(deal.account_id)}
                            </td>
                            <td
                              className="px-4 py-3 text-gray-500"
                              data-testid={`deal-owner-${deal.id}`}
                            >
                              {resolveOwnerName(
                                deal.owner_id,
                                activeUsers,
                                t('deals.ownerUnknown'),
                              )}
                            </td>
                            <td className="px-4 py-3" data-testid={`deal-tags-${deal.id}`}>
                              <div className="flex flex-wrap gap-1">
                                {deal.tags?.map((tag) => (
                                  <TagBadge key={tag.id} tag={tag} />
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                {listData && listData.total > listData.limit && (
                  <Pagination
                    page={listData.page}
                    limit={listData.limit}
                    total={listData.total}
                    onPageChange={setListPage}
                  />
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Close deal modal — used by board view */}
      {pendingClose && (
        <CloseDealModal
          isOpen={true}
          targetStage={pendingClose.stage}
          initialCloseDate={todayIso()}
          isSubmitting={isClosing}
          error={closeError ?? undefined}
          onConfirm={handleCloseConfirm}
          onCancel={() => {
            setPendingClose(null);
            setCloseError(null);
          }}
        />
      )}
    </div>
  );
}
