/**
 * StageColumn component.
 * Renders a single pipeline stage column containing deal cards.
 * The column header shows the stage name, deal count, and total deal value.
 * Closed Won and Closed Lost columns use distinct colour schemes.
 */

import { useTranslation } from 'react-i18next';
import DealCard from '@/components/DealCard.js';
import EmptyState from '@/components/EmptyState.js';
import { getStageDisplayName } from '@/utils/pipelineStageI18nKey.js';
import type { DealResponse } from '@shared/schemas/dealSchema.js';

interface StageColumnProps {
  /** Pipeline stage this column represents (may be a custom stage name) */
  stage: string;
  /** Deals assigned to this stage */
  deals: DealResponse[];
  /** Map of account_id → account name for O(1) lookup */
  accountNames: Map<string, string>;
  /**
   * Called when a deal's stage changes (from card selector or drag-and-drop).
   * `version` is provided when the deal object is available (card selector); `undefined` when
   * the source deal is in another column and must be looked up by the parent (drag-and-drop).
   */
  onStageChange: (dealId: string, stage: string, version?: number) => void;
  /**
   * Called when a terminal stage is selected.
   * `version` is provided when the deal object is available (card selector); `undefined` when
   * triggered by a cross-column drag-and-drop.
   */
  onCloseRequested: (dealId: string, stage: string, version?: number) => void;
  /** Set of deal IDs whose stage updates are currently in flight */
  updatingDealIds: Set<string>;
  /** When true, the column expands to full width (used in mobile single-stage view) */
  fullWidth?: boolean;
  /** Called when the user clicks "Add deal" in the column's empty state */
  onAddDeal?: () => void;
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
function columnWrapperClass(stage: string): string {
  return COLUMN_WRAPPER_CLASSES[stage] ?? COLUMN_WRAPPER_DEFAULT;
}

/**
 * Returns header CSS classes for a given stage.
 *
 * @param stage - Pipeline stage name
 */
function columnHeaderClass(stage: string): string {
  return COLUMN_HEADER_CLASSES[stage] ?? COLUMN_HEADER_DEFAULT;
}

/**
 * Returns true when the deals in a column have more than one distinct currency. (MINCRM-189)
 *
 * @param deals - Deals to check
 */
function hasMixedCurrencies(deals: DealResponse[]): boolean {
  const dealsWithValue = deals.filter((d) => d.value);
  if (dealsWithValue.length === 0) return false;
  const currencies = new Set(dealsWithValue.map((d) => d.currency));
  return currencies.size > 1;
}

/**
 * Returns the single currency used by all deals, or null when mixed. (MINCRM-189)
 *
 * @param deals - Deals to inspect
 */
function singleCurrency(deals: DealResponse[]): string | null {
  const dealsWithValue = deals.filter((d) => d.value);
  if (dealsWithValue.length === 0) return null;
  const currencies = new Set(dealsWithValue.map((d) => d.currency));
  return currencies.size === 1 ? [...currencies][0] : null;
}

/**
 * Computes the sum of deal values and formats it using the deals' shared currency. (MINCRM-189)
 *
 * @param deals - Deals to sum (caller must ensure all share the same currency)
 * @param locale - BCP 47 locale tag from i18next (e.g. "en", "de", "zh-Hans")
 * @returns Locale-formatted currency string
 */
function sumValues(deals: DealResponse[], locale: string): string {
  const currency = singleCurrency(deals) ?? 'USD';
  const total = deals.reduce((acc, d) => acc + (d.value ? parseFloat(d.value) : 0), 0);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(total);
}

/**
 * Computes the weighted pipeline value (sum of value × probability / 100) for a set of deals
 * and formats it using the deals' shared currency. (MINCRM-189)
 *
 * @param deals - Deals to sum (caller must ensure all share the same currency)
 * @param locale - BCP 47 locale tag from i18next
 * @returns Locale-formatted currency string
 */
function sumWeightedValues(deals: DealResponse[], locale: string): string {
  const currency = singleCurrency(deals) ?? 'USD';
  const total = deals.reduce((acc, d) => {
    const value = d.value ? parseFloat(d.value) : 0;
    return acc + (value * (d.effective_probability ?? 0)) / 100;
  }, 0);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(total);
}

/** Kebab-case version of a stage name used in data-testid attributes */
function stageSlug(stage: string): string {
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
  fullWidth = false,
  onAddDeal,
}: StageColumnProps) {
  const { t, i18n } = useTranslation();
  const slug = stageSlug(stage);

  const isTerminal = stage === 'Closed Won' || stage === 'Closed Lost';

  function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    const dealId = e.dataTransfer.getData('text/plain');
    if (!dealId) return;
    // Don't trigger a no-op if the card is already in this column.
    if (deals.some((d) => d.id === dealId)) return;
    if (isTerminal) {
      onCloseRequested(dealId, stage);
    } else {
      onStageChange(dealId, stage);
    }
  }

  return (
    <div
      data-testid={`stage-column-${slug}`}
      className={`${fullWidth ? 'w-full' : 'flex-shrink-0 w-64'} rounded-lg border ${columnWrapperClass(stage)} flex flex-col`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Column header — sticky so stage name/count stay visible as cards scroll within the column (MINCRM-346).
          Explicit onDragOver/onDrop so drop events targeting this element are handled directly
          rather than relying on parent bubbling (MINCRM-300). */}
      <div
        data-testid={`stage-column-header-${slug}`}
        className={`sticky top-0 z-10 px-3 py-2 rounded-t-lg ${columnHeaderClass(stage)}`}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold truncate" title={getStageDisplayName(stage, t)}>
            {getStageDisplayName(stage, t)}
          </h3>
          <span
            data-testid={`stage-column-count-${slug}`}
            className="ms-2 shrink-0 text-xs font-medium"
          >
            {deals.length}
          </span>
        </div>
        {hasMixedCurrencies(deals) ? (
          <p data-testid={`stage-column-total-${slug}`} className="text-xs mt-0.5">
            {t('pipeline.mixedCurrency')}
          </p>
        ) : (
          <>
            <p data-testid={`stage-column-total-${slug}`} className="text-xs mt-0.5">
              {t('pipeline.totalValue', { value: sumValues(deals, i18n.language) })}
            </p>
            <p
              data-testid={`stage-column-weighted-${slug}`}
              className="text-xs text-gray-600 mt-0.5"
            >
              {t('pipeline.weightedValue', { value: sumWeightedValues(deals, i18n.language) })}
            </p>
          </>
        )}
      </div>

      {/* Deal cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-16">
        {deals.length === 0 ? (
          <EmptyState
            data-testid={`stage-column-empty-${slug}`}
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            }
            title={t('deals.emptyTitle')}
            description={t('deals.emptyDescription')}
            action={onAddDeal ? { label: t('deals.emptyAction'), onClick: onAddDeal } : undefined}
          />
        ) : (
          deals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              accountName={accountNames.get(deal.account_id ?? '') ?? '—'}
              onStageChange={onStageChange}
              onCloseRequested={onCloseRequested}
              isUpdating={updatingDealIds.has(deal.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
