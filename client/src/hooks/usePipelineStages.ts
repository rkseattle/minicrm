/**
 * Hook that returns the live pipeline stages list fetched from the API (MINCRM-180).
 *
 * Stages are cached by React Query and revalidated when the window regains focus.
 * Components that render stage selectors or board columns should use this hook
 * instead of the hardcoded PIPELINE_STAGES constant.
 */

import { useQuery } from '@tanstack/react-query';
import { listPipelineStages, PIPELINE_STAGES_QUERY_KEY } from '@/api/pipelineStages.js';
import { PIPELINE_STAGES } from '@shared/schemas/dealSchema.js';
import type { PipelineStageResponse } from '@shared/schemas/pipelineStageSchema.js';

/** Fallback seed stages used while the API response is loading */
const SEED_STAGES: PipelineStageResponse[] = PIPELINE_STAGES.map((name, index) => ({
  id: `seed-${index}`,
  name,
  sort_order: (index + 1) * 10,
  probability:
    name === 'Closed Won'
      ? 100
      : name === 'Prospecting'
        ? 10
        : name === 'Qualification'
          ? 25
          : name === 'Proposal'
            ? 50
            : name === 'Negotiation'
              ? 75
              : 0, // Closed Lost and any unexpected seed name
  is_terminal: name === 'Closed Won' || name === 'Closed Lost',
  is_fixed: name === 'Closed Won' || name === 'Closed Lost',
}));

/** Result shape returned by usePipelineStages */
export interface UsePipelineStagesResult {
  /** Ordered array of stage objects */
  stages: PipelineStageResponse[];
  /** Stage names in order — convenience alias */
  stageNames: string[];
  /** Terminal stage names (require close date) */
  terminalStageNames: string[];
  /** True while the initial fetch is in flight */
  isLoading: boolean;
  /** True if the fetch failed */
  isError: boolean;
}

/**
 * Returns the live pipeline stages list. Falls back to seed stages while loading.
 */
export function usePipelineStages(): UsePipelineStagesResult {
  const { data, isLoading, isError } = useQuery({
    queryKey: PIPELINE_STAGES_QUERY_KEY,
    queryFn: listPipelineStages,
    staleTime: 5 * 60 * 1000, // Pipeline stages rarely change; cache for 5 min
  });

  const stages = data?.stages ?? SEED_STAGES;
  const stageNames = stages.map((s) => s.name);
  const terminalStageNames = stages.filter((s) => s.is_terminal).map((s) => s.name);

  return { stages, stageNames, terminalStageNames, isLoading, isError };
}
