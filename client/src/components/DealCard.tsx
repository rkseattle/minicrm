/**
 * DealCard component.
 * Displays a single deal on the pipeline board.
 * Shows the deal name (as a link), account name, value, close date,
 * and an inline stage selector for moving the deal between stages.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select.js';
import { getStageDisplayName } from '@/utils/pipelineStageI18nKey.js';
import { usePipelineStages } from '@/hooks/usePipelineStages.js';
import type { DealResponse } from '@shared/schemas/dealSchema.js';

interface DealCardProps {
  /** The deal record to display */
  deal: DealResponse;
  /** Resolved account display name, or '—' when no account is linked */
  accountName: string;
  /** Called when the user selects a non-terminal stage */
  onStageChange: (dealId: string, stage: string) => void;
  /**
   * Called when the user selects a terminal stage.
   * The parent is responsible for opening the close deal modal.
   */
  onCloseRequested: (dealId: string, stage: string) => void;
  /** When true, the stage selector is disabled */
  isUpdating: boolean;
  /**
   * Optional prefix for data-testid attributes.
   * Used to disambiguate cards rendered in multiple views (e.g. "mobile-").
   */
  testIdPrefix?: string;
}

/**
 * Formats a deal value using the deal's own currency and the active locale. (MINCRM-189)
 *
 * @param value - Numeric string from the API (pg returns numeric as string)
 * @param currency - ISO 4217 currency code stored on the deal
 * @param locale - BCP 47 locale tag from i18next (e.g. "en", "de", "zh-Hans")
 * @returns Locale-formatted currency string, or '—' when value is absent
 */
function formatValue(value: string | null, currency: string, locale: string): string {
  if (!value) return '—';
  const num = parseFloat(value);
  return isNaN(num)
    ? '—'
    : new Intl.NumberFormat(locale, { style: 'currency', currency }).format(num);
}

/**
 * Card representing a single deal on the pipeline board.
 *
 * @param deal - Deal record
 * @param accountName - Resolved account name
 * @param onStageChange - Handler for non-terminal stage changes
 * @param onCloseRequested - Handler for terminal stage selections (opens close modal)
 * @param isUpdating - Whether a stage update is in flight for this card
 */
export default function DealCard({
  deal,
  accountName,
  onStageChange,
  onCloseRequested,
  isUpdating,
  testIdPrefix = '',
}: DealCardProps) {
  const { t, i18n } = useTranslation();
  const { stageNames, terminalStageNames } = usePipelineStages();
  return (
    <div
      data-testid={`${testIdPrefix}deal-card-${deal.id}`}
      className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm"
    >
      <Link
        to={`/deals/${deal.id}`}
        data-testid={`${testIdPrefix}deal-card-link-${deal.id}`}
        className="font-medium text-sm text-indigo-600 hover:underline block mb-1 truncate"
        title={deal.name}
      >
        {deal.name}
      </Link>

      {accountName !== '—' && (
        <p
          data-testid={`${testIdPrefix}deal-card-account-${deal.id}`}
          className="text-xs text-gray-500 truncate mb-2"
          title={accountName}
        >
          {accountName}
        </p>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
        <span data-testid={`${testIdPrefix}deal-card-value-${deal.id}`}>
          {formatValue(deal.value, deal.currency, i18n.language)}
        </span>
        <span data-testid={`${testIdPrefix}deal-card-close-date-${deal.id}`}>
          {deal.close_date ?? '—'}
        </span>
      </div>

      {/* Probability badge — italic when using stage default, plain when overridden (MINCRM-179) */}
      <div className="flex items-center gap-1 mb-2">
        <span
          data-testid={`${testIdPrefix}deal-card-probability-${deal.id}`}
          className={`text-xs px-1.5 py-0.5 rounded ${
            deal.probability_is_overridden
              ? 'bg-indigo-100 text-indigo-700 font-medium'
              : 'bg-gray-100 text-gray-500 italic'
          }`}
          title={
            deal.probability_is_overridden
              ? t('deals.probabilityOverridden')
              : t('deals.probabilityDefault')
          }
        >
          {t('deals.probabilityPct', { pct: deal.effective_probability })}
        </span>
      </div>

      <Select
        id={`deal-stage-select-${deal.id}`}
        data-testid={`${testIdPrefix}deal-card-stage-select-${deal.id}`}
        value={deal.stage}
        onChange={(e) => {
          const selected = e.target.value;
          if (terminalStageNames.includes(selected)) {
            onCloseRequested(deal.id, selected);
          } else {
            onStageChange(deal.id, selected);
          }
        }}
        disabled={isUpdating}
        className="text-xs"
      >
        {stageNames.map((stage) => (
          <option key={stage} value={stage}>
            {getStageDisplayName(stage, t)}
          </option>
        ))}
      </Select>
    </div>
  );
}
