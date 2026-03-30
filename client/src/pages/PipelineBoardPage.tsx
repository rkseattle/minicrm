/**
 * PipelineBoardPage component.
 * Displays all deals as a Kanban-style pipeline board.
 * Deals are grouped into columns by stage; each column shows the deal count
 * and total value. Users can move a deal to a different stage via the inline
 * stage selector on each deal card.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import StageColumn from '@/components/StageColumn.js';
import { listDeals, updateDeal, DEALS_QUERY_KEY } from '@/api/deals.js';
import { listAccounts } from '@/api/accounts.js';
import { PIPELINE_STAGES } from '@shared/schemas/dealSchema.js';
import type { DealResponse, PipelineStage } from '@shared/schemas/dealSchema.js';
import type { AccountResponse } from '@shared/schemas/accountSchema.js';

/** React Query cache key for the pipeline board — shares the deals list cache */
export const PIPELINE_QUERY_KEY = DEALS_QUERY_KEY;

/**
 * Pipeline board page.
 * Fetches all deals and renders them in stage columns.
 */
export default function PipelineBoardPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  /** Set of deal IDs whose stage updates are currently in flight */
  const [updatingDealIds, setUpdatingDealIds] = useState<Set<string>>(new Set());

  const {
    data: dealsData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: PIPELINE_QUERY_KEY,
    queryFn: () => listDeals(),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => listAccounts(),
  });

  const deals: DealResponse[] = dealsData?.deals ?? [];
  const accounts: AccountResponse[] = accountsData?.accounts ?? [];

  /** Map of account_id → name for O(1) lookup in deal cards */
  const accountNames = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach((a) => map.set(a.id, a.name));
    return map;
  }, [accounts]);

  /** Deals grouped by stage, preserving PIPELINE_STAGES order */
  const dealsByStage = useMemo(() => {
    const grouped = new Map<PipelineStage, DealResponse[]>();
    PIPELINE_STAGES.forEach((stage) => grouped.set(stage, []));
    deals.forEach((deal) => {
      grouped.get(deal.stage)?.push(deal);
    });
    return grouped;
  }, [deals]);

  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: PipelineStage }) => updateDeal(id, { stage }),
    onMutate: ({ id }) =>
      setUpdatingDealIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      }),
    onSettled: (_data, _error, { id }) => {
      setUpdatingDealIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: PIPELINE_QUERY_KEY });
    },
  });

  /**
   * Handles a stage change request from a deal card.
   *
   * @param dealId - UUID of the deal to update
   * @param stage - Target pipeline stage
   */
  function handleStageChange(dealId: string, stage: PipelineStage) {
    stageMutation.mutate({ id: dealId, stage });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('pipeline.pageTitle')}</h1>

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
                updatingDealIds={updatingDealIds}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
