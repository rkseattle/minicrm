/**
 * Hook that returns the live pipeline stages list for a specific pipeline (MINCRM-180, MINCRM-397).
 *
 * Stages are cached by React Query and revalidated when the window regains focus.
 * When pipelineId is omitted the default pipeline's stages are returned.
 * Components that render stage selectors or board columns should use this hook
 * instead of the hardcoded PIPELINE_STAGES constant.
 */

import { useQuery } from '@tanstack/react-query';
import { listPipelineStages, pipelineStagesQueryKey } from '@/api/pipelineStages.js';
import { PIPELINE_STAGES } from '@shared/schemas/dealSchema.js';
import type { PipelineStageResponse } from '@shared/schemas/pipelineStageSchema.js';

/** Fallback seed stages used while the API response is loading */
const SEED_STAGES: PipelineStageResponse[] = PIPELINE_STAGES.map((name, index) => ({
  id: `seed-${index}`,
  pipeline_id: 'seed',
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
              : 0,
  is_terminal: name === 'Closed Won' || name === 'Closed Lost',
  is_fixed: name === 'Closed Won' || name === 'Closed Lost',
  // Seed fallback — real requirements come from the API response. (MINCRM-527)
  stage_exit_requirements:
    name === 'Closed Won' || name === 'Closed Lost'
      ? { required_fields: ['close_date'], warning_fields: [] }
      : { required_fields: [], warning_fields: [] },
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
 * Returns the live pipeline stages for the given pipeline.
 * Falls back to seed stages while loading.
 *
 * @param pipelineId - UUID of the pipeline to fetch stages for; defaults to the default pipeline
 */
export function usePipelineStages(pipelineId?: string): UsePipelineStagesResult {
  const { data, isLoading, isError } = useQuery({
    queryKey: pipelineStagesQueryKey(pipelineId),
    queryFn: () => listPipelineStages(pipelineId),
    // Override global staleTime: 0 — pipeline stage definitions change rarely (admin-only). (MINCRM-348)
    staleTime: 5 * 60 * 1000,
  });

  const stages = data?.stages ?? SEED_STAGES;
  const stageNames = stages.map((s) => s.name);
  const terminalStageNames = stages.filter((s) => s.is_terminal).map((s) => s.name);

  return { stages, stageNames, terminalStageNames, isLoading, isError };
}
