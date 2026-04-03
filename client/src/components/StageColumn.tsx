/**
 * StageColumn component.
 * Renders a single pipeline stage column containing deal cards.
 * The column header shows the stage name, deal count, and total deal value.
 * Closed Won and Closed Lost columns use distinct colour schemes.
 */

import { useTranslation } from 'react-i18next';
import DealCard from '@/components/DealCard.js';
import { PIPELINE_STAGE_I18N_KEY } from '@/utils/pipelineStageI18nKey.js';
import type { DealResponse, PipelineStage } from '@shared/schemas/dealSchema.js';

interface StageColumnProps {
  /** Pipeline stage this column represents */
  stage: PipelineStage;
  /** Deals assigned to this stage */
  deals: DealResponse[];
  /** Map of account_id → account name for O(1) lookup */
  accountNames: Map<string, string>;
  /** Called when a deal card's stage selector changes to a non-terminal stage */
  onStageChange: (dealId: string, stage: PipelineStage) => void;
  /**
   * Called when the user selects a terminal stage on a deal card.
   * The parent opens the close deal modal.
   */
  onCloseRequested: (dealId: string, stage: 'Closed Won' | 'Closed Lost') => void;
  /** Set of deal IDs whose stage updates are currently in flight */
  updatingDealIds: Set<string>;
}

/** CSS classes for the column border and background */
const COLUMN_WRAPPER_CLASSES: Record<string, string> = {
  'Closed Won': 'border-green-200 bg-green-50',
  'Closed Lost': 'border-red-200 bg-red-50',
};
const COLUMN_WRAPPER_DEFAULT = 'border-gray-200 bg-gray-50';

/** CSS classes for the column header */
const COLUMN_HEADER_CLASSES: Record<string, string> = {
  'Closed Won': 'bg-green-100 text-green-800',
  'Closed Lost': 'bg-red-100 text-red-800',
};
const COLUMN_HEADER_DEFAULT = 'bg-white text-gray-700';

/**
 * Returns wrapper CSS classes for a given stage.
 *
 * @param stage - Pipeline stage name
 */
function columnWrapperClass(stage: PipelineStage): string {
  return COLUMN_WRAPPER_CLASSES[stage] ?? COLUMN_WRAPPER_DEFAULT;
}

/**
 * Returns header CSS classes for a given stage.
 *
 * @param stage - Pipeline stage name
 */
function columnHeaderClass(stage: PipelineStage): string {
  return COLUMN_HEADER_CLASSES[stage] ?? COLUMN_HEADER_DEFAULT;
}

/**
 * Computes the sum of deal values and formats it as a USD currency string
 * using the active locale for number formatting.
 *
 * @param deals - Deals to sum
 * @param locale - BCP 47 locale tag from i18next (e.g. "en", "de", "zh-Hans")
 * @returns Locale-formatted USD currency string
 */
function sumValues(deals: DealResponse[], locale: string): string {
  const total = deals.reduce((acc, d) => acc + (d.value ? parseFloat(d.value) : 0), 0);
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(total);
}

/** Kebab-case version of a stage name used in data-testid attributes */
function stageSlug(stage: PipelineStage): string {
  return stage.toLowerCase().replace(/\s+/g, '-');
}

/**
 * A single stage column on the pipeline board.
 *
 * @param stage - The pipeline stage
 * @param deals - Deals in this stage
 * @param accountNames - Lookup map for account names
 * @param onStageChange - Non-terminal stage change callback
 * @param onCloseRequested - Terminal stage selection callback
 * @param updatingDealIds - Set of deal IDs whose stage updates are in flight
 */
export default function StageColumn({
  stage,
  deals,
  accountNames,
  onStageChange,
  onCloseRequested,
  updatingDealIds,
}: StageColumnProps) {
  const { t, i18n } = useTranslation();
  const slug = stageSlug(stage);

  return (
    <div
      data-testid={`stage-column-${slug}`}
      className={`flex-shrink-0 w-64 rounded-lg border ${columnWrapperClass(stage)} flex flex-col`}
    >
      {/* Column header */}
      <div className={`px-3 py-2 rounded-t-lg ${columnHeaderClass(stage)}`}>
        <div className="flex items-center justify-between">
          <h3
            className="text-sm font-semibold truncate"
            title={t(`pipeline.stages.${PIPELINE_STAGE_I18N_KEY[stage]}`)}
          >
            {t(`pipeline.stages.${PIPELINE_STAGE_I18N_KEY[stage]}`)}
          </h3>
          <span
            data-testid={`stage-column-count-${slug}`}
            className="ms-2 shrink-0 text-xs font-medium"
          >
            {deals.length}
          </span>
        </div>
        <p data-testid={`stage-column-total-${slug}`} className="text-xs opacity-75 mt-0.5">
          {t('pipeline.totalValue', { value: sumValues(deals, i18n.language) })}
        </p>
      </div>

      {/* Deal cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-16">
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            accountName={accountNames.get(deal.account_id ?? '') ?? '—'}
            onStageChange={onStageChange}
            onCloseRequested={onCloseRequested}
            isUpdating={updatingDealIds.has(deal.id)}
          />
        ))}
      </div>
    </div>
  );
}
