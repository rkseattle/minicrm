/**
 * Maps each pipeline stage value (as stored in the database) to its i18n key
 * under the `pipeline.stages` namespace.
 *
 * Using camelCase keys avoids spaces in i18n key paths, which break static
 * key-extraction tools used by translation management systems (TMS).
 *
 * Usage:
 *   import { PIPELINE_STAGE_I18N_KEY } from '@/utils/pipelineStageI18nKey.js';
 *   t(`pipeline.stages.${PIPELINE_STAGE_I18N_KEY[stage]}`)
 */

import type { PipelineStage } from '@shared/schemas/dealSchema.js';

/** Maps a database stage value to its dot-safe i18n key */
export const PIPELINE_STAGE_I18N_KEY: Record<PipelineStage, string> = {
  Prospecting: 'prospecting',
  Qualification: 'qualification',
  Proposal: 'proposal',
  Negotiation: 'negotiation',
  'Closed Won': 'closedWon',
  'Closed Lost': 'closedLost',
};
