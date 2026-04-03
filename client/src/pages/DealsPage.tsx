/**
 * DealsPage component.
 * Displays deals as either a Kanban pipeline board (default) or a list/table view.
 * The board view satisfies MINCRM-16 AC: deals as cards organised into stage columns,
 * each column showing deal count and total value.
 * The list view provides the original tabular layout for scanning and bulk review.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import DealForm from '@/components/DealForm.js';
import StageColumn from '@/components/StageColumn.js';
import CloseDealModal, { CLOSED_STAGES } from '@/components/CloseDealModal.js';
import { Button } from '@/components/ui/Button.js';
import { OwnerToggle } from '@/components/ui/OwnerToggle.js';
import type { OwnerFilter } from '@/components/ui/OwnerToggle.js';
import { listDeals, createDeal, updateDeal, DEALS_QUERY_KEY } from '@/api/deals.js';
import { Pagination } from '@/components/ui/Pagination.js';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
} from '@shared/schemas/paginationSchema.js';

/** Max records fetched for the board view — fetches all by capping at the server max */
const PAGINATION_MAX_BOARD_LIMIT = PAGINATION_MAX_LIMIT;
import { listAccounts } from '@/api/accounts.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import { WIN_LOSS_REPORT_QUERY_KEY } from '@/api/reports.js';
import { DASHBOARD_QUERY_KEY } from '@/api/dashboard.js';
import { PIPELINE_STAGES } from '@shared/schemas/dealSchema.js';
import type { ActiveUser } from '@/api/users.js';
import type { DealFormValues } from '@/components/DealForm.js';
import type { DealResponse, PipelineStage } from '@shared/schemas/dealSchema.js';
import { PIPELINE_STAGE_I18N_KEY } from '@/utils/pipelineStageI18nKey.js';
import { formatLocalDate } from '@/utils/formatLocalDate.js';

/** Open pipeline stages shown in the summary bar (excludes terminal stages) */
const OPEN_PIPELINE_STAGES = PIPELINE_STAGES.filter(
  (s) => s !== 'Closed Won' && s !== 'Closed Lost',
);

/** Which view is active on the Deals page */
type ViewMode = 'board' | 'list';

/** State captured while the user has selected a terminal stage but not yet confirmed */
interface PendingClose {
  dealId: string;
  stage: 'Closed Won' | 'Closed Lost';
}

/**
 * Formats a deal value as a USD currency string using the active locale.
 *
 * @param value - Numeric string from the API (pg returns numeric as string)
 * @param locale - BCP 47 locale tag from i18next (e.g. "en", "de", "zh-Hans")
 * @returns Locale-formatted USD currency string, or '—' when value is absent
 */
function formatDealValue(value: string | null, locale: string): string {
  if (!value) return '—';
  const num = parseFloat(value);
  return isNaN(num)
    ? '—'
    : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(num);
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

  // ── View mode ──────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('board');

  // ── Create form ────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const newDealButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocusRef = useRef(false);

  // ── List view state ────────────────────────────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  const ownerFilter: OwnerFilter = searchParams.get('owner') === 'me' ? 'me' : 'all';
  const [listPage, setListPage] = useState(1);

  /**
   * Updates the ?owner query param. Removes it when filter is 'all'. (MINCRM-55)
   *
   * @param value - New owner filter value
   */
  function setOwnerFilter(value: OwnerFilter): void {
    setListPage(1);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'me') {
          next.set('owner', 'me');
        } else {
          next.delete('owner');
        }
        return next;
      },
      { replace: true },
    );
  }

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
    { owner: ownerFilter === 'me' ? 'me' : undefined, sort: sortCol, dir: sortDir, page: listPage },
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
        sort: sortCol,
        dir: sortDir === 'ascending' ? 'asc' : 'desc',
        page: listPage,
        limit: PAGINATION_DEFAULT_LIMIT,
      }),
    enabled: viewMode === 'list',
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
    const grouped = new Map<PipelineStage, DealResponse[]>();
    PIPELINE_STAGES.forEach((stage) => grouped.set(stage, []));
    (boardData?.data ?? []).forEach((deal) => {
      if (!showClosed && (CLOSED_STAGES as PipelineStage[]).includes(deal.stage)) return;
      grouped.get(deal.stage)?.push(deal);
    });
    return grouped;
  }, [boardData?.data, showClosed]);

  /**
   * Per-stage count and total value for the open pipeline stages.
   * Computed from the already-fetched list page — no extra API call needed.
   * Closed Won and Closed Lost are excluded (not part of the active pipeline).
   * Note: summary reflects only the current page's deals when paginated.
   */
  const pipelineSummary = useMemo(() => {
    if (viewMode !== 'list') return [];
    const deals = listData?.data ?? [];
    return OPEN_PIPELINE_STAGES.map((stage) => {
      const stageDeals = deals.filter((d) => d.stage === stage);
      const total = stageDeals.reduce((acc, d) => acc + (d.value ? parseFloat(d.value) : 0), 0);
      return { stage, count: stageDeals.length, total };
    });
  }, [listData?.data, viewMode]);

  // Server handles sorting and pagination — use data as-is
  const sortedDeals: DealResponse[] = listData?.data ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (values: DealFormValues) =>
      createDeal({
        name: values.name,
        stage: values.stage as DealResponse['stage'],
        value: values.value !== '' ? parseFloat(values.value) : undefined,
        close_date: values.close_date || undefined,
        account_id: values.account_id || undefined,
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
      stage: PipelineStage;
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
      if ((CLOSED_STAGES as PipelineStage[]).includes(variables.stage)) {
        setCloseError(t('pipeline.stageUpdateError'));
      } else {
        setStageError(t('pipeline.stageUpdateError'));
      }
    },
    onSuccess: (_data, variables) => {
      if ((CLOSED_STAGES as PipelineStage[]).includes(variables.stage)) {
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
      if ((CLOSED_STAGES as PipelineStage[]).includes(stage)) {
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
  function handleStageChange(dealId: string, stage: PipelineStage): void {
    stageMutation.mutate({ id: dealId, stage });
  }

  /**
   * Opens the close deal modal when a terminal stage is selected on a deal card.
   *
   * @param dealId - UUID of the deal to close
   * @param stage - Terminal stage selected ('Closed Won' | 'Closed Lost')
   */
  function handleCloseRequested(dealId: string, stage: 'Closed Won' | 'Closed Lost'): void {
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
      <main className={viewMode === 'board' ? 'px-6 py-8' : 'max-w-7xl mx-auto px-6 py-8'}>
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('deals.pageTitle')}</h1>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="deals-view-toggle"
              onClick={() => {
                // Reset owner filter when returning to board so the board always shows all deals
                if (viewMode === 'list') {
                  setSearchParams(
                    (prev) => {
                      const next = new URLSearchParams(prev);
                      next.delete('owner');
                      return next;
                    },
                    { replace: true },
                  );
                }
                setViewMode((m) => (m === 'board' ? 'list' : 'board'));
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
            {/* Board toolbar */}
            <div className="flex items-center justify-between mb-4">
              <div>{/* spacer */}</div>
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
              <div data-testid="pipeline-board" className="flex gap-4 overflow-x-auto pb-4">
                {PIPELINE_STAGES.map((stage) => (
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
            )}
          </>
        )}

        {/* ── List view ───────────────────────────────────────────────────── */}
        {viewMode === 'list' && (
          <>
            {/* Owner filter */}
            <div className="mb-4 flex items-center gap-3">
              <OwnerToggle
                value={ownerFilter}
                onChange={setOwnerFilter}
                testIdPrefix="deals-owner-filter"
              />
            </div>

            {/* Pipeline summary bar — shows open-stage deal counts and totals (MINCRM-56) */}
            {!isLoading && !isError && (
              <div
                data-testid="pipeline-summary-bar"
                role="region"
                aria-label={t('deals.pipelineSummaryLabel')}
                className="mb-4 flex flex-wrap gap-2"
              >
                {pipelineSummary.map(({ stage, count, total }) => (
                  <div
                    key={stage}
                    data-testid={`pipeline-summary-${stage.toLowerCase().replace(/\s+/g, '-')}`}
                    className="flex items-center gap-1.5 rounded-full bg-white border border-gray-200 px-3 py-1 text-xs text-gray-700"
                  >
                    <span className="font-semibold">
                      {t(`pipeline.stages.${PIPELINE_STAGE_I18N_KEY[stage]}`)}
                    </span>
                    <span className="text-gray-400">·</span>
                    <span>{count}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-500">
                      {new Intl.NumberFormat(i18n.language, {
                        style: 'currency',
                        currency: 'USD',
                        notation: 'compact',
                        maximumFractionDigits: 1,
                      }).format(total)}
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
                  <table className="w-full text-sm">
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
                            {sortCol === 'name' && (sortDir === 'ascending' ? ' ↑' : ' ↓')}
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
                            {sortCol === 'close_date' && (sortDir === 'ascending' ? ' ↑' : ' ↓')}
                          </button>
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {t('deals.columnAccount')}
                        </th>
                        <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {t('deals.columnOwner')}
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
                            {t(
                              `pipeline.stages.${PIPELINE_STAGE_I18N_KEY[deal.stage as PipelineStage]}`,
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {formatDealValue(deal.value, i18n.language)}
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
