/**
 * DealsPage component.
 * Displays deals as either a Kanban pipeline board (default) or a list/table view.
 * The board view satisfies MINCRM-16 AC: deals as cards organised into stage columns,
 * each column showing deal count and total value.
 * The list view provides the original tabular layout for scanning and bulk review.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { useBreakpoint } from '@/context/BreakpointContext.js';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { resolveApiError } from '@/utils/apiError.js';
import NavBar from '@/components/NavBar.js';
import EmptyState from '@/components/EmptyState.js';
import { PagedListLayout } from '@/components/PagedListLayout.js';
import DealForm from '@/components/DealForm.js';
import StageColumn from '@/components/StageColumn.js';
import CloseDealModal from '@/components/CloseDealModal.js';
import { Button } from '@/components/ui/Button.js';
import { OwnerToggle } from '@/components/ui/OwnerToggle.js';
import type { OwnerFilter } from '@/components/ui/OwnerToggle.js';
import { listDeals, createDeal, updateDeal, exportDealsCsv, DEALS_QUERY_KEY } from '@/api/deals.js';
import { usePipelines } from '@/hooks/usePipelines.js';
import { bulkPatchDeals, bulkDeleteDeals } from '@/api/bulk.js';
import type { BulkFailure } from '@/api/bulk.js';
import BulkActionBar from '@/components/BulkActionBar.js';
import BulkFailedDetailsModal from '@/components/BulkFailedDetailsModal.js';
import BulkReassignModal from '@/components/BulkReassignModal.js';
import BulkChangeStageModal from '@/components/BulkChangeStageModal.js';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.js';
import { listAllTags, ALL_TAGS_QUERY_KEY } from '@/api/tags.js';
import TagBadge from '@/components/TagBadge.js';
import { Pagination } from '@/components/ui/Pagination.js';
import { PAGINATION_MAX_LIMIT } from '@shared/schemas/paginationSchema.js';
import { usePagination } from '@/hooks/usePagination.js';

/** Max records fetched for the board view — fetches all by capping at the server max */
const PAGINATION_MAX_BOARD_LIMIT = PAGINATION_MAX_LIMIT;
import { listAccounts } from '@/api/accounts.js';
import { useAuth } from '@/hooks/useAuth.js';
import { usePermissions } from '@/hooks/usePermissions.js';
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

/** sessionStorage key to persist the selected pipeline across navigation (MINCRM-397) */
const SELECTED_PIPELINE_KEY = 'deals.selectedPipelineId';

/** State captured while the user has selected a terminal stage but not yet confirmed */
interface PendingClose {
  dealId: string;
  stage: string;
  version: number;
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
  const { isDesktop } = useBreakpoint();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // bulk:operations capability is seeded for admin and manager roles (MINCRM-562)
  const canBulkOp = user?.role === 'admin' || user?.role === 'manager';
  const { canWrite } = usePermissions();

  // Pipeline selector — persisted in sessionStorage (MINCRM-397)
  const { pipelines, defaultPipeline } = usePipelines();
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | undefined>(() => {
    return sessionStorage.getItem(SELECTED_PIPELINE_KEY) ?? undefined;
  });

  // Fall back to the default pipeline once loaded if no selection is stored
  const activePipelineId = selectedPipelineId ?? defaultPipeline?.id;

  function handlePipelineChange(pipelineId: string): void {
    sessionStorage.setItem(SELECTED_PIPELINE_KEY, pipelineId);
    setSelectedPipelineId(pipelineId);
  }

  // Live stage list scoped to the active pipeline (MINCRM-180, MINCRM-397)
  const {
    stages: pipelineStages,
    stageNames,
    terminalStageNames,
  } = usePipelineStages(activePipelineId);
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

  // ── Shared filter state (MINCRM-176, MINCRM-545) ─────────────────────────
  // ownerFilter persists in the URL ?owner param so the filter survives navigation.
  // showClosed is lifted to the parent so it persists across Board ↔ List switches.
  const [searchParams, setSearchParams] = useSearchParams();
  const ownerParam = searchParams.get('owner');
  const ownerFilter: OwnerFilter =
    ownerParam === 'me' ? 'me' : ownerParam === 'my_team' ? 'my_team' : 'all';

  /**
   * Updates the ?owner query param and resets list pagination to page 1.
   *
   * @param value - New owner filter value
   */
  function setOwnerFilter(value: OwnerFilter): void {
    setListPage(1);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'me' || value === 'my_team') {
          next.set('owner', value);
        } else {
          next.delete('owner');
        }
        return next;
      },
      { replace: true },
    );
  }

  const ownerApiParam = ownerFilter === 'all' ? undefined : ownerFilter;

  // ── List view state ────────────────────────────────────────────────────────
  const {
    page: listPage,
    limit: listLimit,
    setPage: setListPage,
    handleLimitChange,
  } = usePagination();
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
  const boardQueryKey = [
    ...DEALS_QUERY_KEY,
    'board',
    { owner: ownerApiParam, pipeline: activePipelineId },
  ] as const;

  const listQueryKey = [
    ...DEALS_QUERY_KEY,
    'list',
    {
      owner: ownerApiParam,
      pipeline: activePipelineId,
      hideClosed: !showClosed,
      sort: sortCol,
      dir: sortDir,
      tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      page: listPage,
      limit: listLimit,
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
        owner: ownerApiParam,
        pipelineId: activePipelineId,
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
        owner: ownerApiParam,
        pipelineId: activePipelineId,
        hideClosed: !showClosed || undefined,
        sort: sortCol,
        dir: sortDir === 'ascending' ? 'asc' : 'desc',
        tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        page: listPage,
        limit: listLimit,
      }),
    enabled: viewMode === 'list',
  });

  const { data: tagsData } = useQuery({
    queryKey: ALL_TAGS_QUERY_KEY,
    queryFn: listAllTags,
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

  const hasActiveListFilters = ownerFilter !== 'all' || !showClosed || selectedTagIds.length > 0;

  function clearListFilters(): void {
    setOwnerFilter('all');
    setShowClosed(true);
    setSelectedTagIds([]);
    setListPage(1);
  }

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
        // Associate the deal with the currently selected pipeline (MINCRM-397)
        pipeline_id: activePipelineId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
      shouldRestoreFocusRef.current = true;
      setShowForm(false);
      setCreateError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setCreateError(resolveApiError(error, t));
    },
  });

  const stageMutation = useMutation({
    mutationFn: ({
      id,
      stage,
      close_date,
      loss_reason,
      version,
    }: {
      id: string;
      stage: string;
      version: number;
      close_date?: string;
      loss_reason?: string;
    }) =>
      updateDeal(id, {
        stage,
        close_date: close_date ?? null,
        loss_reason: loss_reason ?? null,
        version,
      }),
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
  function handleStageChange(dealId: string, stage: string, version?: number): void {
    // version is provided by card selector; on cross-column drag-drop, look up from boardData
    const resolvedVersion =
      version ?? (boardData?.data ?? []).find((d) => d.id === dealId)?.version ?? 1;
    stageMutation.mutate({ id: dealId, stage, version: resolvedVersion });
  }

  /**
   * Opens the close deal modal when a terminal stage is selected on a deal card.
   *
   * @param dealId - UUID of the deal to close
   * @param stage - Terminal stage selected by the user
   */
  function handleCloseRequested(dealId: string, stage: string, version?: number): void {
    const resolvedVersion =
      version ?? (boardData?.data ?? []).find((d) => d.id === dealId)?.version ?? 1;
    setCloseError(null);
    setPendingClose({ dealId, stage, version: resolvedVersion });
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
      version: pendingClose.version,
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

  // ── Bulk selection state (MINCRM-188, MINCRM-562) — only available in list view ──────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkReassign, setShowBulkReassign] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showBulkChangeStage, setShowBulkChangeStage] = useState(false);
  const [bulkPartialFailures, setBulkPartialFailures] = useState<BulkFailure[]>([]);
  const [showBulkFailedDetails, setShowBulkFailedDetails] = useState(false);
  const [bulkSuccessMessage, setBulkSuccessMessage] = useState<string | null>(null);

  const selectedTagKey = selectedTagIds.join(',');
  useEffect(() => {
    setSelectedIds(new Set());
  }, [ownerFilter, showClosed, sortCol, sortDir, listPage, listLimit, selectedTagKey, viewMode]);

  const allVisibleDealIds = sortedDeals.map((d) => d.id);
  const allVisibleSelected =
    allVisibleDealIds.length > 0 && allVisibleDealIds.every((id) => selectedIds.has(id));

  function toggleSelectAll(): void {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allVisibleDealIds));
    }
  }

  function toggleRow(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const [bulkError, setBulkError] = useState<string | null>(null);

  const bulkMutation = useMutation({
    mutationFn: (
      args:
        | { type: 'patch'; owner_id: string }
        | { type: 'change_stage'; stage: string }
        | { type: 'delete' },
    ) => {
      const ids = Array.from(selectedIds);
      if (args.type === 'delete') {
        return bulkDeleteDeals({ ids });
      }
      if (args.type === 'change_stage') {
        return bulkPatchDeals({ ids, patch: { stage: args.stage } });
      }
      return bulkPatchDeals({ ids, patch: { owner_id: args.owner_id } });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
      setShowBulkReassign(false);
      setShowBulkDelete(false);
      setShowBulkChangeStage(false);
      setBulkError(null);
      if (result.failed.length > 0 && result.succeeded.length > 0) {
        // Partial success — keep selection on failed IDs so admin can retry
        setBulkPartialFailures(result.failed);
        setBulkSuccessMessage(
          t('bulk.partialSuccess', {
            succeeded: result.succeeded.length,
            failed: result.failed.length,
          }),
        );
        setSelectedIds(new Set(result.failed.map((f) => f.id)));
      } else if (result.failed.length === 0) {
        setBulkPartialFailures([]);
        setBulkSuccessMessage(t('bulk.successCount', { count: result.succeeded.length }));
        setSelectedIds(new Set());
      }
      // Total failure: do not clear selection so user can retry
    },
    onError: () => {
      setBulkError(t('bulk.errorGeneric'));
    },
  });

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <NavBar />
      <main className="flex-1 flex flex-col min-h-0 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-8">
        {/* Page header — sticky so title and controls stay visible while board scrolls (MINCRM-346) */}
        <div className="flex items-center justify-between mb-6 sticky top-0 z-20 bg-gray-50 py-4 -mt-4">
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
            {/* New Deal button — only shown when form is not open and user can write */}
            {canWrite && !showForm && (
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
              pipelineId={activePipelineId}
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

        {/* ── Pipeline selector — shown above both board and list views (MINCRM-397) */}
        {pipelines.length > 1 && (
          <div className="mb-4 flex items-center gap-2">
            <label
              htmlFor="pipeline-selector"
              className="text-sm font-medium text-gray-700 shrink-0"
            >
              {t('deals.pipelineSelector')}
            </label>
            <select
              id="pipeline-selector"
              data-testid="pipeline-selector"
              value={activePipelineId ?? ''}
              onChange={(e) => handlePipelineChange(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* ── Board view ──────────────────────────────────────────────────── */}
        {viewMode === 'board' && (
          <>
            {/* Board toolbar — sticky below the page header so filters stay visible while board scrolls (MINCRM-346) */}
            <div className="flex items-center gap-3 mb-4 sticky top-[72px] z-10 bg-gray-50 py-2">
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
                <p aria-busy="true" className="text-sm text-gray-500">
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
              <div data-testid="pipeline-board" className="flex-1 flex flex-col min-h-0">
                {isDesktop ? (
                  /* Desktop multi-column Kanban — flex-1 + overflow-auto so columns scroll within the remaining viewport height (MINCRM-346) */
                  <div className="flex gap-4 overflow-auto flex-1 min-h-0 pb-4">
                    {stageNames.map((stage) => (
                      <StageColumn
                        key={stage}
                        stage={stage}
                        deals={dealsByStage.get(stage) ?? []}
                        accountNames={accountNames}
                        onStageChange={handleStageChange}
                        onCloseRequested={handleCloseRequested}
                        updatingDealIds={updatingDealIds}
                        onAddDeal={() => setShowForm(true)}
                      />
                    ))}
                  </div>
                ) : (
                  /* Mobile single-stage view — flex col so nav bar can be sticky and card list scrolls below (MINCRM-346) */
                  <div className="flex flex-col flex-1 min-h-0">
                    {/* Stage navigation — sticky so prev/next/stage-name stay pinned while cards scroll */}
                    <div className="flex items-center justify-between mb-3 gap-2 sticky top-[120px] z-10 bg-gray-50 py-2">
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
                        <p className="text-xs text-gray-500">
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
                      onAddDeal={() => setShowForm(true)}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── List view ───────────────────────────────────────────────────── */}
        {viewMode === 'list' && (
          <>
            {isLoading && (
              <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
                <p aria-busy="true" className="text-sm text-gray-500">
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

            {/* Bulk success message (MINCRM-562) */}
            {bulkSuccessMessage && (
              <p
                role="status"
                className="mb-2 text-sm text-green-700"
                data-testid="bulk-success-message"
              >
                {bulkSuccessMessage}
              </p>
            )}

            {/* Bulk error message (MINCRM-188) */}
            {bulkError && (
              <p
                role="alert"
                className="mb-2 text-sm text-red-600"
                data-testid="bulk-error-message"
              >
                {bulkError}
              </p>
            )}

            {/* Bulk action bar (MINCRM-188, MINCRM-562) */}
            {canBulkOp && selectedIds.size > 0 && (
              <BulkActionBar
                selectedCount={selectedIds.size}
                isPending={bulkMutation.isPending}
                onSeeDetails={
                  bulkPartialFailures.length > 0 ? () => setShowBulkFailedDetails(true) : undefined
                }
                actions={[
                  {
                    key: 'reassign',
                    labelKey: 'bulk.reassignButton',
                    testId: 'bulk-reassign-button',
                    variant: 'secondary',
                  },
                  {
                    key: 'change_stage',
                    labelKey: 'bulk.changeStageButton',
                    testId: 'bulk-change-stage-button',
                    variant: 'secondary',
                  },
                  {
                    key: 'delete',
                    labelKey: 'bulk.deleteButton',
                    testId: 'bulk-delete-button',
                    variant: 'danger',
                  },
                ]}
                onAction={(key) => {
                  if (key === 'reassign') setShowBulkReassign(true);
                  if (key === 'change_stage') setShowBulkChangeStage(true);
                  if (key === 'delete') setShowBulkDelete(true);
                }}
                onClearSelection={() => setSelectedIds(new Set())}
              />
            )}

            {/* Bulk reassign modal */}
            <BulkReassignModal
              isOpen={showBulkReassign}
              selectedCount={selectedIds.size}
              users={activeUsers}
              isPending={bulkMutation.isPending}
              onConfirm={(ownerId) => {
                bulkMutation.mutate({ type: 'patch', owner_id: ownerId });
              }}
              onCancel={() => setShowBulkReassign(false)}
            />

            {/* Bulk change stage modal */}
            <BulkChangeStageModal
              isOpen={showBulkChangeStage}
              selectedCount={selectedIds.size}
              stages={pipelineStages}
              isPending={bulkMutation.isPending}
              onConfirm={(stage) => {
                bulkMutation.mutate({ type: 'change_stage', stage });
              }}
              onCancel={() => setShowBulkChangeStage(false)}
            />

            {/* Bulk delete confirmation modal */}
            <ConfirmDeleteModal
              isOpen={showBulkDelete}
              message={t('bulk.deleteMessage', { count: selectedIds.size })}
              isDeleting={bulkMutation.isPending}
              onConfirm={() => {
                bulkMutation.mutate({ type: 'delete' });
              }}
              onCancel={() => setShowBulkDelete(false)}
            />

            {/* Bulk failed details modal (MINCRM-562) */}
            <BulkFailedDetailsModal
              isOpen={showBulkFailedDetails}
              failures={bulkPartialFailures}
              onClose={() => setShowBulkFailedDetails(false)}
            />

            {!isLoading && !isError && (
              <PagedListLayout
                toolbar={
                  <>
                    <div className="flex flex-wrap items-center gap-3">
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
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
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
                        <div
                          className="flex flex-wrap gap-1"
                          data-testid="deals-active-tag-filters"
                        >
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

                    {/* Pipeline summary bar — below filter controls, matching pre-refactor order (MINCRM-56) */}
                    {pipelineSummary.length > 0 && (
                      <div
                        data-testid="pipeline-summary-bar"
                        role="region"
                        aria-label={t('deals.pipelineSummaryLabel')}
                        className="flex flex-wrap gap-2"
                      >
                        {pipelineSummary.map(({ stage, count, total, currency, mixedCurrency }) => (
                          <div
                            key={stage}
                            data-testid={`pipeline-summary-${stage.toLowerCase().replace(/\s+/g, '-')}`}
                            className="flex items-center gap-1.5 rounded-full bg-white border border-gray-200 px-3 py-1 text-xs text-gray-700"
                          >
                            <span className="font-semibold">{getStageDisplayName(stage, t)}</span>
                            <span className="text-gray-500">·</span>
                            <span>{count}</span>
                            <span className="text-gray-500">·</span>
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
                  </>
                }
                isEmpty={sortedDeals.length === 0}
                emptyState={
                  <EmptyState
                    data-testid="deals-list-empty-state"
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
                          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                        />
                      </svg>
                    }
                    title={
                      hasActiveListFilters ? t('deals.filteredEmptyTitle') : t('deals.emptyTitle')
                    }
                    description={
                      hasActiveListFilters
                        ? t('common.filteredEmptyDescription')
                        : t('deals.emptyDescription')
                    }
                    action={
                      hasActiveListFilters
                        ? { label: t('common.clearFilters'), onClick: clearListFilters }
                        : { label: t('deals.emptyAction'), onClick: () => setShowForm(true) }
                    }
                  />
                }
                pagination={
                  listData && (
                    <Pagination
                      page={listData.page}
                      limit={listData.limit}
                      total={listData.total}
                      onPageChange={setListPage}
                      onLimitChange={handleLimitChange}
                    />
                  )
                }
              >
                {isDesktop ? (
                  /* Desktop table */
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-gray-50">
                      <tr className="border-b border-gray-200">
                        {/* Bulk select-all checkbox — admins only (MINCRM-188, MINCRM-562) */}
                        {canBulkOp && (
                          <th className="w-10 ps-4 py-3">
                            <input
                              type="checkbox"
                              data-testid="bulk-select-all"
                              checked={allVisibleSelected}
                              onChange={toggleSelectAll}
                              aria-label={t('bulk.selectedCount', {
                                count: allVisibleDealIds.length,
                              })}
                              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                          </th>
                        )}
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
                        <tr
                          key={deal.id}
                          className={`hover:bg-gray-50 transition-colors${selectedIds.has(deal.id) ? ' bg-primary-50' : ''}`}
                        >
                          {/* Row checkbox — admins only (MINCRM-188, MINCRM-562) */}
                          {canBulkOp && (
                            <td className="w-10 ps-4 py-3">
                              <input
                                type="checkbox"
                                data-testid={`bulk-select-${deal.id}`}
                                checked={selectedIds.has(deal.id)}
                                onChange={() => toggleRow(deal.id)}
                                aria-label={deal.name}
                                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                              />
                            </td>
                          )}
                          <td className="px-4 py-3 font-medium text-primary-600">
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
                            {resolveOwnerName(deal.owner_id, activeUsers, t('deals.ownerUnknown'))}
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
                ) : (
                  /* Mobile card view */
                  <>
                    {/* Select-all bar — admins only (MINCRM-562) */}
                    {canBulkOp && (
                      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50">
                        <input
                          type="checkbox"
                          data-testid="bulk-select-all"
                          checked={allVisibleSelected}
                          onChange={toggleSelectAll}
                          aria-label={t('bulk.selectAll')}
                          className="h-5 w-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="text-xs text-gray-500">
                          {t('bulk.selectedCount', { count: selectedIds.size })}
                        </span>
                      </div>
                    )}
                    <ul className="divide-y divide-gray-100">
                      {sortedDeals.map((deal) => (
                        <li
                          key={deal.id}
                          className={`px-4 py-3 flex items-start gap-3${selectedIds.has(deal.id) ? ' bg-primary-50' : ''}`}
                          data-testid={`deal-list-card-${deal.id}`}
                        >
                          {/* Row checkbox — admins only (MINCRM-562) */}
                          {canBulkOp && (
                            <input
                              type="checkbox"
                              data-testid={`bulk-select-${deal.id}`}
                              checked={selectedIds.has(deal.id)}
                              onChange={() => toggleRow(deal.id)}
                              aria-label={deal.name}
                              className="mt-1 h-5 w-5 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <Link
                              to={`/deals/${deal.id}`}
                              data-testid={`deal-list-card-link-${deal.id}`}
                              className="block font-medium text-primary-600 hover:underline mb-1"
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
                              className="text-xs text-gray-500 mt-1"
                              data-testid={`deal-list-card-owner-${deal.id}`}
                            >
                              {t('deals.columnOwner')}:{' '}
                              {resolveOwnerName(
                                deal.owner_id,
                                activeUsers,
                                t('deals.ownerUnknown'),
                              )}
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
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </PagedListLayout>
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
