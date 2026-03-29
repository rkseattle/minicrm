/**
 * StageColumn component.
 * Renders a single pipeline stage column containing deal cards.
 * The column header shows the stage name, deal count, and total deal value.
 * Closed Won and Closed Lost columns use distinct colour schemes.
 */

import { useTranslation } from 'react-i18next';
import DealCard from '@/components/DealCard.js';
import type { DealResponse, PipelineStage } from '@shared/schemas/dealSchema.js';

interface StageColumnProps {
  /** Pipeline stage this column represents */
  stage: PipelineStage;
  /** Deals assigned to this stage */
  deals: DealResponse[];
  /** Map of account_id → account name for O(1) lookup */
  accountNames: Map<string, string>;
  /** Called when a deal card's stage selector changes */
  onStageChange: (dealId: string, stage: PipelineStage) => void;
  /** ID of the deal currently being updated, or null */
  updatingDealId: string | null;
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
 * Computes the sum of deal values for a list of deals.
 *
 * @param deals - Deals to sum
 * @returns Total as a formatted locale string
 */
function sumValues(deals: DealResponse[]): string {
  const total = deals.reduce((acc, d) => acc + (d.value ? parseFloat(d.value) : 0), 0);
  return total.toLocaleString();
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
 * @param onStageChange - Stage change callback
 * @param updatingDealId - Deal whose stage update is in flight
 */
export default function StageColumn({
  stage,
  deals,
  accountNames,
  onStageChange,
  updatingDealId,
}: StageColumnProps) {
  const { t } = useTranslation();
  const slug = stageSlug(stage);

  return (
    <div
      data-testid={`stage-column-${slug}`}
      className={`flex-shrink-0 w-64 rounded-lg border ${columnWrapperClass(stage)} flex flex-col`}
    >
      {/* Column header */}
      <div className={`px-3 py-2 rounded-t-lg ${columnHeaderClass(stage)}`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold truncate">{stage}</h3>
          <span
            data-testid={`stage-column-count-${slug}`}
            className="ml-2 shrink-0 text-xs font-medium"
          >
            {deals.length}
          </span>
        </div>
        <p data-testid={`stage-column-total-${slug}`} className="text-xs opacity-75 mt-0.5">
          {t('pipeline.totalValue', { value: sumValues(deals) })}
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
            isUpdating={updatingDealId === deal.id}
          />
        ))}
      </div>
    </div>
  );
}
