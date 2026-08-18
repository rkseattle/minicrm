/**
 * Hook that returns the live pipelines list fetched from the API.
 *
 * Pipelines are cached for 5 minutes — they change rarely (admin-only writes).
 * Returns a loading/error state and the resolved pipelines array.
 */

import { useQuery } from '@tanstack/react-query';
import { listPipelines, PIPELINES_QUERY_KEY } from '@/api/pipelines.js';
import type { PipelineResponse } from '@shared/schemas/pipelineSchema.js';

export interface UsePipelinesResult {
  pipelines: PipelineResponse[];
  defaultPipeline: PipelineResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function usePipelines(): UsePipelinesResult {
  const { data, isLoading, isError } = useQuery({
    queryKey: PIPELINES_QUERY_KEY,
    queryFn: listPipelines,
    staleTime: 5 * 60 * 1000,
  });

  const pipelines = data?.pipelines ?? [];
  const defaultPipeline = pipelines.find((p) => p.is_default);

  return { pipelines, defaultPipeline, isLoading, isError };
}
