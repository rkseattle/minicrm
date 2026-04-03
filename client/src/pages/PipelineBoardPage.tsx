/**
 * PipelineBoardPage component.
 * Displays all deals as a Kanban-style pipeline board.
 * Deals are grouped into columns by stage; each column shows the deal count
 * and total value. Users can move a deal to a different stage via the inline
 * stage selector on each deal card.
 * Selecting a terminal stage (Closed Won / Closed Lost) opens the CloseDealModal
 * to capture an optional close date and loss reason before submitting.
 * A header toggle allows filtering out closed deals from the active view.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import StageColumn from '@/components/StageColumn.js';
import CloseDealModal, { CLOSED_STAGES } from '@/components/CloseDealModal.js';
import { Button } from '@/components/ui/Button.js';
import { listDeals, updateDeal, DEALS_QUERY_KEY } from '@/api/deals.js';
import { listAccounts } from '@/api/accounts.js';
import { PAGINATION_MAX_LIMIT } from '@shared/schemas/paginationSchema.js';
import { WIN_LOSS_REPORT_QUERY_KEY } from '@/api/reports.js';
import { DASHBOARD_QUERY_KEY } from '@/api/dashboard.js';
import { PIPELINE_STAGES } from '@shared/schemas/dealSchema.js';
import type { DealResponse, PipelineStage } from '@shared/schemas/dealSchema.js';

/** React Query cache key for the pipeline board — shares the deals list cache */
export const PIPELINE_QUERY_KEY = DEALS_QUERY_KEY;

/** Today's date in YYYY-MM-DD format, used as default close date */
function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

/** State captured while the user has selected a terminal stage but not yet confirmed */
interface PendingClose {
  dealId: string;
  stage: 'Closed Won' | 'Closed Lost';
}

/**
 * Pipeline board page.
 * Fetches all deals and renders them in stage columns.
 */
export default function PipelineBoardPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  /** Set of deal IDs whose stage updates are currently in flight */
  const [updatingDealIds, setUpdatingDealIds] = useState<Set<string>>(new Set());

  /** Error message from the most recent failed stage change, or null */
  const [stageError, setStageError] = useState<string | null>(null);

  /** Close deal modal state — null when the modal is closed */
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);

  /** Error from a failed close-deal attempt, shown inside the modal */
  const [closeError, setCloseError] = useState<string | null>(null);

  /** Whether to show Closed Won / Closed Lost deals in the board */
  const [showClosed, setShowClosed] = useState(true);

  const {
    data: dealsData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: PIPELINE_QUERY_KEY,
    queryFn: () => listDeals({ limit: PAGINATION_MAX_LIMIT }),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => listAccounts(),
  });

  /** Map of account_id → name for O(1) lookup in deal cards */
  const accountNames = useMemo(() => {
    const map = new Map<string, string>();
    (accountsData?.data ?? []).forEach((a) => map.set(a.id, a.name));
    return map;
  }, [accountsData?.data]);

  /**
   * Deals grouped by stage, preserving PIPELINE_STAGES order.
   * When showClosed is false, terminal-stage deals are omitted from their columns.
   */
  const dealsByStage = useMemo(() => {
    const grouped = new Map<PipelineStage, DealResponse[]>();
    PIPELINE_STAGES.forEach((stage) => grouped.set(stage, []));
    (dealsData?.data ?? []).forEach((deal) => {
      if (!showClosed && (CLOSED_STAGES as PipelineStage[]).includes(deal.stage)) return;
      grouped.get(deal.stage)?.push(deal);
    });
    return grouped;
  }, [dealsData?.data, showClosed]);

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
      queryClient.invalidateQueries({ queryKey: PIPELINE_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY });
      if ((CLOSED_STAGES as PipelineStage[]).includes(stage)) {
        queryClient.invalidateQueries({ queryKey: WIN_LOSS_REPORT_QUERY_KEY });
      }
    },
  });

  /**
   * Handles a non-terminal stage change request from a deal card.
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

  const isClosing = stageMutation.isPending && pendingClose !== null;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('pipeline.pageTitle')}</h1>
          <Button
            variant="secondary"
            size="sm"
            data-testid="toggle-closed-deals"
            onClick={() => setShowClosed((prev) => !prev)}
          >
            {showClosed ? t('pipeline.closeDeal.hideClosed') : t('pipeline.closeDeal.showClosed')}
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
      </main>

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
