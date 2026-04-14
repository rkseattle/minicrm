/**
 * Maps each pipeline stage value (as stored in the database) to its i18n key
 * under the `pipeline.stages` namespace.
 *
 * The built-in stages have dedicated translation keys. Custom stages added by
 * admins (MINCRM-180) are displayed using their raw name — no i18n lookup is
 * performed for them, since translations are not available for user-defined names.
 *
 * Usage:
 *   import { getStagei18nKey, getStageDisplayName } from '@/utils/pipelineStageI18nKey.js';
 *   // For built-in stages: t(`pipeline.stages.${getStagei18nKey(stage)}`)
 *   // For all stages: getStageDisplayName(stage, t)
 */

/** Maps the built-in stage names to their dot-safe i18n keys */
const BUILTIN_STAGE_I18N_KEY: Record<string, string> = {
  Prospecting: 'prospecting',
  Qualification: 'qualification',
  Proposal: 'proposal',
  Negotiation: 'negotiation',
  'Closed Won': 'closedWon',
  'Closed Lost': 'closedLost',
};

/**
 * Returns the i18n key for a built-in stage, or null for custom stages.
 *
 * @param stageName - Pipeline stage name as stored in the database
 */
export function getStagei18nKey(stageName: string): string | null {
  return BUILTIN_STAGE_I18N_KEY[stageName] ?? null;
}

/**
 * Returns the display name for any stage — translated for built-in stages,
 * raw name for custom stages.
 *
 * @param stageName - Pipeline stage name as stored in the database
 * @param t - i18next translate function
 */
export function getStageDisplayName(stageName: string, t: (key: string) => string): string {
  const key = BUILTIN_STAGE_I18N_KEY[stageName];
  return key ? t(`pipeline.stages.${key}`) : stageName;
}

/**
 * @deprecated Use getStageDisplayName or getStagei18nKey instead (MINCRM-180).
 * Kept for backward compatibility with components not yet updated to the dynamic stage list.
 */
export const PIPELINE_STAGE_I18N_KEY: Record<string, string> = BUILTIN_STAGE_I18N_KEY;
